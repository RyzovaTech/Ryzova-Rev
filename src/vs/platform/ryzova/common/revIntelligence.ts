/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const revIntelligenceTasks = [
	'assistant',
	'reasoning',
	'vision',
	'code-helper',
] as const;

export type RevIntelligenceTask = typeof revIntelligenceTasks[number];

export type RevIntelligenceProviderScope = 'rev-assistant' | 'engineering';
export type RevIntelligenceProviderKind = 'built-in-local' | 'built-in-remote' | 'external';
export type RevIntelligenceAvailabilityState = 'unavailable' | 'loading' | 'ready' | 'busy' | 'error';

export interface IRevIntelligenceModelDescriptor {
	readonly id: string;
	readonly providerId: string;
	readonly displayName: string;
	readonly task: RevIntelligenceTask;
	readonly priority?: number;
	readonly contextWindow?: number;
	readonly maxOutputTokens?: number;
	readonly supportsVision?: boolean;
	/** Runtime-specific local alias. Kept out of user-facing IDs so providers can swap variants safely. */
	readonly runtimeModelAlias?: string;
}

export interface IRevIntelligenceProviderDescriptor {
	readonly id: string;
	readonly displayName: string;
	readonly scope: RevIntelligenceProviderScope;
	readonly kind: RevIntelligenceProviderKind;
}

export interface IRevIntelligenceAvailability {
	readonly available: boolean;
	readonly state: RevIntelligenceAvailabilityState;
	readonly reason?: string;
}

export interface IRevIntelligenceMessage {
	readonly role: 'system' | 'user' | 'assistant';
	readonly content: string;
}

export interface IRevIntelligenceRequest {
	readonly requestId: string;
	readonly task: RevIntelligenceTask;
	readonly model: IRevIntelligenceModelDescriptor;
	readonly messages: readonly IRevIntelligenceMessage[];
	readonly imageReferences?: readonly string[];
	readonly allowCodeAuthoring: boolean;
}

export interface IRevIntelligenceResponse {
	readonly requestId: string;
	readonly modelId: string;
	readonly content: string;
}

export type RevIntelligenceStreamEvent =
	| { readonly type: 'started'; readonly requestId: string; readonly modelId: string }
	| { readonly type: 'token'; readonly requestId: string; readonly token: string }
	| { readonly type: 'completed'; readonly requestId: string; readonly response: IRevIntelligenceResponse }
	| { readonly type: 'cancelled'; readonly requestId: string }
	| { readonly type: 'error'; readonly requestId: string; readonly message: string };

export interface IRevIntelligenceProvider {
	readonly descriptor: IRevIntelligenceProviderDescriptor;

	models(): Promise<readonly IRevIntelligenceModelDescriptor[]>;
	availability(): Promise<IRevIntelligenceAvailability>;
	generate(request: IRevIntelligenceRequest, signal?: AbortSignal): Promise<IRevIntelligenceResponse>;
	stream?(
		request: IRevIntelligenceRequest,
		onEvent: (event: RevIntelligenceStreamEvent) => void,
		signal?: AbortSignal,
	): Promise<IRevIntelligenceResponse>;
	cancel?(requestId: string): Promise<void>;
}
