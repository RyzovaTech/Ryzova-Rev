/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech.
 *  SPDX-License-Identifier: GPL-3.0-only
 *  See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import {
	assertRevAssistantRequestAllowed,
	IRevAssistantConversation,
	IRevAssistantMessage,
	IRevAssistantReply,
	IRevAssistantRequest,
	REV_ASSISTANT_SYSTEM_CHARTER,
	RevAssistantStreamEvent,
	revAssistantTaskForIntent,
} from './revAssistant.js';
import { estimateRevContextTokens, IRevAssistantContextService } from './revAssistantContext.js';
import {
	createRevAssistantCancelledError,
	isRevAssistantCancellationError,
	RevAssistantError,
	toRevAssistantError,
} from './revAssistantErrors.js';
import {
	IRevIntelligenceMessage,
	IRevIntelligenceProvider,
	IRevIntelligenceRequest,
	IRevIntelligenceResponse,
} from './revIntelligence.js';
import { IRevIntelligenceRegistryService, IRevIntelligenceRoute } from './revIntelligenceRegistry.js';

export const IRevAssistantService = createDecorator<IRevAssistantService>('revAssistantService');

export interface IRevAssistantService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeConversation: Event<IRevAssistantConversation>;
	readonly onDidStreamEvent: Event<RevAssistantStreamEvent>;

	createConversation(id?: string): IRevAssistantConversation;
	getConversation(id: string): IRevAssistantConversation | undefined;
	deleteConversation(id: string): boolean;
	ask(request: IRevAssistantRequest, signal?: AbortSignal): Promise<IRevAssistantReply>;
	stream(
		request: IRevAssistantRequest,
		onEvent?: (event: RevAssistantStreamEvent) => void,
		signal?: AbortSignal,
	): Promise<IRevAssistantReply>;
	cancel(requestId: string): Promise<boolean>;
	isRunning(requestId: string): boolean;
}

interface IMutableRevAssistantConversation {
	readonly id: string;
	readonly createdAt: number;
	updatedAt: number;
	messages: IRevAssistantMessage[];
}

interface IActiveRevAssistantRequest {
	readonly requestId: string;
	readonly conversationId: string;
	readonly controller: AbortController;
	provider?: IRevIntelligenceProvider;
	providerRequestId?: string;
}

interface IRouteResult {
	readonly route: IRevIntelligenceRoute;
	readonly response: IRevIntelligenceResponse;
}

export class RevAssistantService extends Disposable implements IRevAssistantService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeConversation = this._register(new Emitter<IRevAssistantConversation>());
	readonly onDidChangeConversation = this._onDidChangeConversation.event;

	private readonly _onDidStreamEvent = this._register(new Emitter<RevAssistantStreamEvent>());
	readonly onDidStreamEvent = this._onDidStreamEvent.event;

	private readonly conversations = new Map<string, IMutableRevAssistantConversation>();
	private readonly activeRequests = new Map<string, IActiveRevAssistantRequest>();
	private readonly activeConversationRequests = new Map<string, string>();

	constructor(
		@IRevIntelligenceRegistryService private readonly intelligenceRegistry: IRevIntelligenceRegistryService,
		@IRevAssistantContextService private readonly assistantContextService: IRevAssistantContextService,
	) {
		super();
	}

	createConversation(id = generateUuid()): IRevAssistantConversation {
		if (!id.trim()) {
			throw new Error('Rev Assistant conversation ID must not be empty.');
		}
		if (this.conversations.has(id)) {
			throw new Error(`Rev Assistant conversation already exists: ${id}`);
		}

		const now = Date.now();
		const conversation: IMutableRevAssistantConversation = {
			id,
			createdAt: now,
			updatedAt: now,
			messages: [],
		};
		this.conversations.set(id, conversation);
		return this.snapshot(conversation);
	}

	getConversation(id: string): IRevAssistantConversation | undefined {
		const conversation = this.conversations.get(id);
		return conversation ? this.snapshot(conversation) : undefined;
	}

	deleteConversation(id: string): boolean {
		if (this.activeConversationRequests.has(id)) {
			return false;
		}
		return this.conversations.delete(id);
	}

	ask(request: IRevAssistantRequest, signal?: AbortSignal): Promise<IRevAssistantReply> {
		return this.stream(request, undefined, signal);
	}

	async stream(
		request: IRevAssistantRequest,
		onEvent?: (event: RevAssistantStreamEvent) => void,
		signal?: AbortSignal,
	): Promise<IRevAssistantReply> {
		assertRevAssistantRequestAllowed(request);
		if (signal?.aborted) {
			throw createRevAssistantCancelledError();
		}

		const conversation = this.conversations.get(request.conversationId);
		if (!conversation) {
			throw new Error(`Unknown Rev Assistant conversation: ${request.conversationId}`);
		}

		const requestId = request.requestId?.trim() || generateUuid();
		if (this.activeRequests.has(requestId)) {
			throw new RevAssistantError(`Rev Assistant request is already running: ${requestId}`, 'busy', true);
		}
		const activeConversationRequest = this.activeConversationRequests.get(conversation.id);
		if (activeConversationRequest) {
			throw new RevAssistantError(
				`Rev Assistant conversation already has an active request: ${activeConversationRequest}`,
				'busy',
				true,
			);
		}

		const controller = new AbortController();
		const active: IActiveRevAssistantRequest = {
			requestId,
			conversationId: conversation.id,
			controller,
		};
		this.activeRequests.set(requestId, active);
		this.activeConversationRequests.set(conversation.id, requestId);

		const abortFromCaller = () => controller.abort();
		signal?.addEventListener('abort', abortFromCaller, { once: true });

		const emit = (event: RevAssistantStreamEvent): void => {
			try {
				onEvent?.(event);
			} catch {
				// A UI/event consumer must not be able to break an inference turn.
			}
			this._onDidStreamEvent.fire(event);
		};

		emit({
			type: 'started',
			requestId,
			conversationId: conversation.id,
			intent: request.intent,
		});

		try {
			const userMessage: IRevAssistantMessage = {
				id: generateUuid(),
				role: 'user',
				content: request.content,
				createdAt: Date.now(),
			};
			conversation.messages.push(userMessage);
			conversation.updatedAt = userMessage.createdAt;
			this.fireConversation(conversation);

			const task = revAssistantTaskForIntent(request.intent);
			const conversationMessages: IRevIntelligenceMessage[] = conversation.messages.map(message => ({
				role: message.role,
				content: message.content,
			}));
			const basePromptTokens = estimateRevContextTokens(REV_ASSISTANT_SYSTEM_CHARTER)
				+ conversationMessages.reduce((total, message) => total + estimateRevContextTokens(message.content), 0);
			const routes = await this.intelligenceRegistry.resolveAssistantRoutes(task, {
				requireVision: request.intent === 'visual-analysis',
				minimumContextWindow: basePromptTokens + 1024,
			});
			if (!routes.length) {
				throw new RevAssistantError(`No Rev Assistant model is available for task: ${task}.`, 'no-route', true);
			}

			const { route, response } = await this.runRoutes(
				requestId,
				active,
				routes,
				{
					task,
					allowCodeAuthoring: request.intent === 'code-authoring' && request.allowCodeAuthoring === true,
					...(request.imageReferences === undefined ? {} : { imageReferences: request.imageReferences }),
				},
				async route => {
					if (controller.signal.aborted) {
						throw createRevAssistantCancelledError();
					}
					const context = await this.assistantContextService.buildContext({
						prompt: request.content,
						contextWindow: route.model.contextWindow,
						reservedOutputTokens: route.model.maxOutputTokens,
						basePromptTokens,
						// Until an explicit data-sharing policy exists, automatic project
						// contents stay on-device even when a future remote assistant route
						// participates in fallback.
						includeWorkspaceContents: route.provider.descriptor.kind === 'built-in-local',
					});

					return [
						{ role: 'system', content: REV_ASSISTANT_SYSTEM_CHARTER },
						...(context.message ? [context.message] : []),
						...conversationMessages,
					];
				},
				emit,
				controller.signal,
			);

			if (controller.signal.aborted) {
				throw createRevAssistantCancelledError();
			}

			const assistantMessage: IRevAssistantMessage = {
				id: generateUuid(),
				role: 'assistant',
				content: response.content,
				createdAt: Date.now(),
			};
			conversation.messages.push(assistantMessage);
			conversation.updatedAt = assistantMessage.createdAt;
			const snapshot = this.fireConversation(conversation);

			const reply: IRevAssistantReply = {
				requestId,
				conversation: snapshot,
				message: assistantMessage,
				modelId: response.modelId || route.model.id,
			};
			emit({ type: 'completed', requestId, reply });
			return reply;
		} catch (error) {
			const normalized = toRevAssistantError(error);
			if (normalized.code === 'cancelled' || controller.signal.aborted) {
				emit({ type: 'cancelled', requestId });
				throw createRevAssistantCancelledError(normalized.message);
			}
			emit({
				type: 'error',
				requestId,
				code: normalized.code,
				message: normalized.message,
				retryable: normalized.retryable,
			});
			throw normalized;
		} finally {
			signal?.removeEventListener('abort', abortFromCaller);
			this.activeRequests.delete(requestId);
			if (this.activeConversationRequests.get(conversation.id) === requestId) {
				this.activeConversationRequests.delete(conversation.id);
			}
		}
	}

	async cancel(requestId: string): Promise<boolean> {
		const active = this.activeRequests.get(requestId);
		if (!active) {
			return false;
		}

		active.controller.abort();
		if (active.provider?.cancel && active.providerRequestId) {
			try {
				await active.provider.cancel(active.providerRequestId);
			} catch {
				// Cancellation is best-effort at the provider boundary. The
				// AbortSignal still prevents fallback or message finalization.
			}
		}
		return true;
	}

	isRunning(requestId: string): boolean {
		return this.activeRequests.has(requestId);
	}

	override dispose(): void {
		for (const active of this.activeRequests.values()) {
			active.controller.abort();
			if (active.provider?.cancel && active.providerRequestId) {
				void active.provider.cancel(active.providerRequestId);
			}
		}
		this.activeRequests.clear();
		this.activeConversationRequests.clear();
		super.dispose();
	}

	private async runRoutes(
		assistantRequestId: string,
		active: IActiveRevAssistantRequest,
		routes: readonly IRevIntelligenceRoute[],
		request: Omit<IRevIntelligenceRequest, 'requestId' | 'model' | 'messages'>,
		buildMessages: (route: IRevIntelligenceRoute) => Promise<readonly IRevIntelligenceMessage[]>,
		emit: (event: RevAssistantStreamEvent) => void,
		signal: AbortSignal,
	): Promise<IRouteResult> {
		let lastError: RevAssistantError | undefined;

		for (let index = 0; index < routes.length; index++) {
			if (signal.aborted) {
				throw createRevAssistantCancelledError();
			}

			const route = routes[index];
			const providerRequestId = generateUuid();
			active.provider = route.provider;
			active.providerRequestId = providerRequestId;
			emit({
				type: 'route',
				requestId: assistantRequestId,
				attempt: index + 1,
				providerId: route.provider.descriptor.id,
				modelId: route.model.id,
			});

			let emittedToken = false;
			try {
				const messages = await buildMessages(route);
				if (signal.aborted) {
					throw createRevAssistantCancelledError();
				}

				const modelRequest: IRevIntelligenceRequest = {
					...request,
					requestId: providerRequestId,
					model: route.model,
					messages,
				};

				let response: IRevIntelligenceResponse;
				if (route.provider.stream) {
					response = await route.provider.stream(
						modelRequest,
						event => {
							if (event.type === 'token' && event.token) {
								emittedToken = true;
								emit({
									type: 'token',
									requestId: assistantRequestId,
									token: event.token,
								});
							}
						},
						signal,
					);
				} else {
					response = await route.provider.generate(modelRequest, signal);
					if (response.content) {
						emittedToken = true;
						emit({
							type: 'token',
							requestId: assistantRequestId,
							token: response.content,
						});
					}
				}

				return { route, response };
			} catch (error) {
				if (signal.aborted || isRevAssistantCancellationError(error)) {
					throw createRevAssistantCancelledError(error instanceof Error ? error.message : undefined);
				}

				const normalized = toRevAssistantError(error);
				if (emittedToken) {
					throw new RevAssistantError(
						`Rev Assistant stream failed after output began: ${normalized.message}`,
						'stream-failed',
						normalized.retryable,
						normalized,
					);
				}

				lastError = normalized;
			} finally {
				if (active.provider === route.provider && active.providerRequestId === providerRequestId) {
					active.provider = undefined;
					active.providerRequestId = undefined;
				}
			}
		}

		const detail = lastError ? `: ${lastError.message}` : '';
		throw new RevAssistantError(
			`Every compatible Rev Assistant route failed${detail}`,
			'all-routes-failed',
			lastError?.retryable ?? true,
			lastError,
		);
	}

	private fireConversation(conversation: IMutableRevAssistantConversation): IRevAssistantConversation {
		const snapshot = this.snapshot(conversation);
		this._onDidChangeConversation.fire(snapshot);
		return snapshot;
	}

	private snapshot(conversation: IMutableRevAssistantConversation): IRevAssistantConversation {
		return {
			id: conversation.id,
			createdAt: conversation.createdAt,
			updatedAt: conversation.updatedAt,
			messages: conversation.messages.map(message => ({ ...message })),
		};
	}
}
