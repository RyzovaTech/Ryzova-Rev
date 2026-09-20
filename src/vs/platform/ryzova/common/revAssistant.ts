/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RevIntelligenceTask } from './revIntelligence.js';

export const revAssistantIntents = [
	'guide',
	'explain',
	'plan',
	'diagnose',
	'visual-analysis',
	'code-authoring',
] as const;

export type RevAssistantIntent = typeof revAssistantIntents[number];

export const REV_ASSISTANT_SYSTEM_CHARTER = [
	'You are Rev Assistant, the built-in guide and intelligence layer of Ryzova Rev.',
	'Help the user understand requirements, projects, workflows, errors, and next steps.',
	'You are not the external engineering model and you do not execute project tools directly.',
	'Prefer guidance, explanation, diagnosis, planning, and project understanding.',
	'Only produce code-authoring output when the user explicitly requests code authoring for this turn.',
].join(' ');

export interface IRevAssistantMessage {
	readonly id: string;
	readonly role: 'user' | 'assistant';
	readonly content: string;
	readonly createdAt: number;
}

export interface IRevAssistantConversation {
	readonly id: string;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly messages: readonly IRevAssistantMessage[];
}

export interface IRevAssistantRequest {
	readonly conversationId: string;
	readonly content: string;
	readonly intent: RevAssistantIntent;
	readonly allowCodeAuthoring?: boolean;
	readonly imageReferences?: readonly string[];
}

export interface IRevAssistantReply {
	readonly conversation: IRevAssistantConversation;
	readonly message: IRevAssistantMessage;
	readonly modelId: string;
}

export function revAssistantTaskForIntent(intent: RevAssistantIntent): RevIntelligenceTask {
	switch (intent) {
		case 'guide':
		case 'explain':
			return 'assistant';
		case 'plan':
		case 'diagnose':
			return 'reasoning';
		case 'visual-analysis':
			return 'vision';
		case 'code-authoring':
			return 'code-helper';
	}
}

export function assertRevAssistantRequestAllowed(request: IRevAssistantRequest): void {
	if (!request.content.trim()) {
		throw new Error('Rev Assistant request must not be empty.');
	}
	if (request.intent === 'code-authoring' && request.allowCodeAuthoring !== true) {
		throw new Error('Rev Assistant code authoring requires an explicit per-request opt-in.');
	}
	if (request.intent !== 'visual-analysis' && request.imageReferences?.length) {
		throw new Error('Image references are only valid for visual-analysis requests.');
	}
}
