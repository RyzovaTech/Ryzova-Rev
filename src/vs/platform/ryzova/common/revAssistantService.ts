/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
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
import { IRevIntelligenceMessage, IRevIntelligenceRequest } from './revIntelligence.js';
import { IRevIntelligenceRegistryService } from './revIntelligenceRegistry.js';

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
		const route = await this.intelligenceRegistry.resolveAssistantRoute(task);
		const modelMessages: IRevIntelligenceMessage[] = [
			{ role: 'system', content: REV_ASSISTANT_SYSTEM_CHARTER },
			...conversation.messages.map(message => ({
				role: message.role,
				content: message.content,
			} satisfies IRevIntelligenceMessage)),
		];

		const modelRequest: IRevIntelligenceRequest = {
			requestId: generateUuid(),
			task,
			model: route.model,
			messages: modelMessages,
			allowCodeAuthoring: request.intent === 'code-authoring' && request.allowCodeAuthoring === true,
			...(request.imageReferences === undefined ? {} : { imageReferences: request.imageReferences }),
		};

		const response = await route.provider.generate(modelRequest, signal);
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
			modelId: response.modelId,
		};
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
