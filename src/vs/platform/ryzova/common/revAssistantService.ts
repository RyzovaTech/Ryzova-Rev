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
	revAssistantTaskForIntent,
} from './revAssistant.js';
import { estimateRevContextTokens, IRevAssistantContextService } from './revAssistantContext.js';
import { IRevIntelligenceMessage, IRevIntelligenceRequest, IRevIntelligenceResponse } from './revIntelligence.js';
import { IRevIntelligenceRegistryService, IRevIntelligenceRoute } from './revIntelligenceRegistry.js';

export const IRevAssistantService = createDecorator<IRevAssistantService>('revAssistantService');

export interface IRevAssistantService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeConversation: Event<IRevAssistantConversation>;

	createConversation(id?: string): IRevAssistantConversation;
	getConversation(id: string): IRevAssistantConversation | undefined;
	deleteConversation(id: string): boolean;
	ask(request: IRevAssistantRequest, signal?: AbortSignal): Promise<IRevAssistantReply>;
}

interface IMutableRevAssistantConversation {
	readonly id: string;
	readonly createdAt: number;
	updatedAt: number;
	messages: IRevAssistantMessage[];
}

export class RevAssistantService extends Disposable implements IRevAssistantService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeConversation = this._register(new Emitter<IRevAssistantConversation>());
	readonly onDidChangeConversation = this._onDidChangeConversation.event;

	private readonly conversations = new Map<string, IMutableRevAssistantConversation>();

	constructor(
		@IRevIntelligenceRegistryService private readonly intelligenceRegistry: IRevIntelligenceRegistryService,
		@IRevAssistantContextService private readonly assistantContextService?: IRevAssistantContextService,
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
		return this.conversations.delete(id);
	}

	async ask(request: IRevAssistantRequest, signal?: AbortSignal): Promise<IRevAssistantReply> {
		assertRevAssistantRequestAllowed(request);

		const conversation = this.conversations.get(request.conversationId);
		if (!conversation) {
			throw new Error(`Unknown Rev Assistant conversation: ${request.conversationId}`);
		}

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
			throw new Error(`No Rev Assistant model is available for task: ${task}.`);
		}

		const { route, response } = await this.generateWithFallback(routes, {
			task,
			allowCodeAuthoring: request.intent === 'code-authoring' && request.allowCodeAuthoring === true,
			...(request.imageReferences === undefined ? {} : { imageReferences: request.imageReferences }),
		}, async route => {
			const context = await this.assistantContextService?.buildContext({
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
				...(context?.message ? [context.message] : []),
				...conversationMessages,
			];
		}, signal);

		const assistantMessage: IRevAssistantMessage = {
			id: generateUuid(),
			role: 'assistant',
			content: response.content,
			createdAt: Date.now(),
		};
		conversation.messages.push(assistantMessage);
		conversation.updatedAt = assistantMessage.createdAt;
		const snapshot = this.fireConversation(conversation);

		return {
			conversation: snapshot,
			message: assistantMessage,
			modelId: response.modelId || route.model.id,
		};
	}

	private async generateWithFallback(
		routes: readonly IRevIntelligenceRoute[],
		request: Omit<IRevIntelligenceRequest, 'requestId' | 'model' | 'messages'>,
		buildMessages: (route: IRevIntelligenceRoute) => Promise<readonly IRevIntelligenceMessage[]>,
		signal?: AbortSignal,
	): Promise<{ readonly route: IRevIntelligenceRoute; readonly response: IRevIntelligenceResponse }> {
		let lastError: unknown;
		for (const route of routes) {
			if (signal?.aborted) {
				throw createRevAssistantCancelledError();
			}

			const modelRequest: IRevIntelligenceRequest = {
				...request,
				requestId: generateUuid(),
				model: route.model,
				messages: await buildMessages(route),
			};
			try {
				const response = await route.provider.generate(modelRequest, signal);
				return { route, response };
			} catch (error) {
				if (signal?.aborted || isCancellationError(error)) {
					throw error;
				}
				lastError = error;
			}
		}

		const detail = lastError instanceof Error ? `: ${lastError.message}` : '';
		throw new Error(`Every compatible Rev Assistant route failed${detail}`);
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

function isCancellationError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	const code = (error as Error & { code?: string }).code;
	return code === 'ERR_REV_CANCELLED' || error.name === 'AbortError' || /cancelled|canceled/i.test(error.message);
}

function createRevAssistantCancelledError(): Error {
	const error = new Error('Rev Assistant request was cancelled.');
	(error as Error & { code?: string }).code = 'ERR_REV_CANCELLED';
	return error;
}
