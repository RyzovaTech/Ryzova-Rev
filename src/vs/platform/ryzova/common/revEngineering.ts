/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech.
 *  SPDX-License-Identifier: GPL-3.0-only
 *  See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const revEngineeringTasks = [
	'plan',
	'execute',
	'diagnose',
] as const;

export type RevEngineeringTask = typeof revEngineeringTasks[number];

export type RevEngineeringProviderKind = 'byok' | 'local' | 'cloud';
export type RevEngineeringAvailabilityState = 'unavailable' | 'loading' | 'ready' | 'busy' | 'error';

export interface IRevEngineeringProviderDescriptor {
	readonly id: string;
	readonly displayName: string;
	readonly kind: RevEngineeringProviderKind;
}

export interface IRevEngineeringAvailability {
	readonly available: boolean;
	readonly state: RevEngineeringAvailabilityState;
	readonly reason?: string;
}

export interface IRevEngineeringModelDescriptor {
	readonly id: string;
	readonly providerId: string;
	readonly displayName: string;
	readonly tasks: readonly RevEngineeringTask[];
	readonly priority?: number;
	readonly contextWindow?: number;
	readonly maxOutputTokens?: number;
	readonly supportsToolCalling?: boolean;
	readonly supportsStreaming?: boolean;
	readonly supportsVision?: boolean;
}

export interface IRevEngineeringMessage {
	readonly role: 'system' | 'user' | 'assistant' | 'tool';
	readonly content: string;
	readonly toolCallId?: string;
}

export interface IRevEngineeringRequest {
	readonly requestId: string;
	readonly task: RevEngineeringTask;
	readonly model: IRevEngineeringModelDescriptor;
	readonly messages: readonly IRevEngineeringMessage[];
}

export interface IRevEngineeringResponse {
	readonly requestId: string;
	readonly modelId: string;
	readonly content: string;
}

export type RevEngineeringStreamEvent =
	| { readonly type: 'started'; readonly requestId: string; readonly modelId: string }
	| { readonly type: 'token'; readonly requestId: string; readonly token: string }
	| { readonly type: 'completed'; readonly requestId: string; readonly response: IRevEngineeringResponse }
	| { readonly type: 'cancelled'; readonly requestId: string }
	| { readonly type: 'error'; readonly requestId: string; readonly message: string };

export interface IRevEngineeringProvider {
	readonly descriptor: IRevEngineeringProviderDescriptor;

	models(): Promise<readonly IRevEngineeringModelDescriptor[]>;
	availability(): Promise<IRevEngineeringAvailability>;
	generate(request: IRevEngineeringRequest, signal?: AbortSignal): Promise<IRevEngineeringResponse>;
	stream?(
		request: IRevEngineeringRequest,
		onEvent: (event: RevEngineeringStreamEvent) => void,
		signal?: AbortSignal,
	): Promise<IRevEngineeringResponse>;
	cancel?(requestId: string): Promise<void>;
}
