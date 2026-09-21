/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech.
 *  SPDX-License-Identifier: GPL-3.0-only
 *  See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import {
	IRevIntelligenceAvailability,
	IRevIntelligenceModelDescriptor,
	IRevIntelligenceProvider,
	IRevIntelligenceProviderDescriptor,
	IRevIntelligenceRequest,
	IRevIntelligenceResponse,
	RevIntelligenceStreamEvent,
	RevIntelligenceTask,
} from './revIntelligence.js';
import { IRevBuiltInModelRuntimeService } from './revBuiltInModelRuntime.js';
import { selectRevBuiltInModel } from './revBuiltInModels.js';

const TEXT_TASKS: readonly RevIntelligenceTask[] = ['assistant', 'reasoning', 'code-helper'];

/**
 * Provider bridge between the generic Rev intelligence registry and the
 * Foundry-backed local runtime.
 *
 * Keeping this class platform-only makes it testable without creating a
 * workbench window. The desktop contribution only owns registration/lifetime.
 */
export class RevBuiltInIntelligenceProvider extends Disposable implements IRevIntelligenceProvider {
	readonly descriptor: IRevIntelligenceProviderDescriptor = {
		id: 'ryzova-rev-built-in',
		displayName: 'Rev Built-in Intelligence',
		scope: 'rev-assistant',
		kind: 'built-in-local',
	};

	constructor(
		private readonly runtime: IRevBuiltInModelRuntimeService,
	) {
		super();
	}

	async models(): Promise<readonly IRevIntelligenceModelDescriptor[]> {
		const catalog = await this.runtime.listModels();
		const descriptors: IRevIntelligenceModelDescriptor[] = [];

		for (const task of TEXT_TASKS) {
			const selected = selectRevBuiltInModel(task, catalog);
			if (!selected) {
				continue;
			}
			descriptors.push({
				id: `rev-local:${task}:${selected.id}`,
				providerId: this.descriptor.id,
				displayName: selected.displayName ?? selected.alias,
				task,
				priority: 100,
				contextWindow: selected.contextLength,
				maxOutputTokens: selected.maxOutputTokens,
				supportsVision: false,
				runtimeModelAlias: selected.alias,
			});
		}

		return descriptors;
	}

	async availability(): Promise<IRevIntelligenceAvailability> {
		try {
			const status = await this.runtime.getStatus();
			if (!status.supported) {
				return {
					available: false,
					state: 'unavailable',
					reason: 'Built-in local intelligence is not supported on this platform.',
				};
			}
			return {
				available: status.state !== 'error',
				state: toAvailabilityState(status.state),
				reason: status.state === 'error' ? status.message : undefined,
			};
		} catch (error) {
			return {
				available: false,
				state: 'error',
				reason: error instanceof Error ? error.message : String(error),
			};
		}
	}

	async generate(request: IRevIntelligenceRequest, signal?: AbortSignal): Promise<IRevIntelligenceResponse> {
		const runtimeRequest = this.toRuntimeRequest(request);
		this.throwIfAlreadyAborted(request.requestId, signal);
		const abort = () => { void this.runtime.cancel(request.requestId); };
		signal?.addEventListener('abort', abort, { once: true });
		try {
			// Use the streaming path internally even for non-streaming callers so
			// cancellation has one consistent implementation in the native host.
			return await this.runtime.stream(runtimeRequest);
		} finally {
			signal?.removeEventListener('abort', abort);
		}
	}

	async stream(
		request: IRevIntelligenceRequest,
		onEvent: (event: RevIntelligenceStreamEvent) => void,
		signal?: AbortSignal,
	): Promise<IRevIntelligenceResponse> {
		const runtimeRequest = this.toRuntimeRequest(request);
		this.throwIfAlreadyAborted(request.requestId, signal);
		const eventListener = this.runtime.onDidStreamEvent(event => {
			if (event.requestId === request.requestId) {
				onEvent(event);
			}
		});
		const abort = () => { void this.runtime.cancel(request.requestId); };
		signal?.addEventListener('abort', abort, { once: true });
		try {
			return await this.runtime.stream(runtimeRequest);
		} finally {
			signal?.removeEventListener('abort', abort);
			eventListener.dispose();
		}
	}

	cancel(requestId: string): Promise<void> {
		return this.runtime.cancel(requestId);
	}

	private throwIfAlreadyAborted(requestId: string, signal?: AbortSignal): void {
		if (!signal?.aborted) {
			return;
		}
		void this.runtime.cancel(requestId);
		const error = new Error(`Rev built-in request was cancelled before it started: ${requestId}`);
		(error as Error & { code?: string }).code = 'ERR_REV_CANCELLED';
		throw error;
	}

	private toRuntimeRequest(request: IRevIntelligenceRequest) {
		const modelAlias = request.model.runtimeModelAlias;
		if (!modelAlias) {
			throw new Error(`Rev built-in model descriptor is missing its runtime alias: ${request.model.id}`);
		}
		return {
			requestId: request.requestId,
			task: request.task,
			modelAlias,
			messages: request.messages,
			allowCodeAuthoring: request.allowCodeAuthoring,
			imageReferences: request.imageReferences,
		};
	}
}

function toAvailabilityState(state: Awaited<ReturnType<IRevBuiltInModelRuntimeService['getStatus']>>['state']): IRevIntelligenceAvailability['state'] {
	switch (state) {
		case 'downloading':
		case 'loading':
		case 'discovering':
			return 'loading';
		case 'generating':
			return 'busy';
		case 'ready':
		case 'idle':
			return 'ready';
		case 'error':
			return 'error';
	}
}
