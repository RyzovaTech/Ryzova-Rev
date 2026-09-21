/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { join } from '../../../base/common/path.js';
import product from '../../product/common/product.js';
import { ensureFoundryLocalRuntime } from '../../localTranscription/node/foundryLocalRuntime.js';
import {
	IRevBuiltInModelRuntimeService,
	IRevBuiltInRuntimeRequest,
	IRevBuiltInRuntimeStatus,
} from '../common/revBuiltInModelRuntime.js';
import { IRevBuiltInCatalogModel } from '../common/revBuiltInModels.js';
import { IRevIntelligenceResponse, RevIntelligenceStreamEvent } from '../common/revIntelligence.js';

const SUPPORTED_TARGETS = new Set([
	'darwin-arm64',
	'linux-x64',
	'linux-arm64',
	'win32-x64',
	'win32-arm64',
]);

type FoundryLocal = typeof import('foundry-local-sdk');
type FoundryLocalManager = import('foundry-local-sdk').FoundryLocalManager;
type FoundryModel = import('foundry-local-sdk').IModel;

interface IActiveStream {
	readonly iterator: AsyncIterator<any>;
	cancelled: boolean;
}

/**
 * Heavy local inference host for Rev Assistant.
 *
 * This service is intentionally executed in a utility process, never the
 * renderer. The Foundry Local SDK loads native ONNX/GenAI libraries and model
 * weights, so isolating it keeps the editor/workbench responsive and gives Rev
 * one lifecycle boundary for discovery, download, load, inference and unload.
 */
export class RevBuiltInModelRuntimeService extends Disposable implements IRevBuiltInModelRuntimeService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeStatus = this._register(new Emitter<IRevBuiltInRuntimeStatus>());
	readonly onDidChangeStatus: Event<IRevBuiltInRuntimeStatus> = this._onDidChangeStatus.event;

	private readonly _onDidStreamEvent = this._register(new Emitter<RevIntelligenceStreamEvent>());
	readonly onDidStreamEvent: Event<RevIntelligenceStreamEvent> = this._onDidStreamEvent.event;

	private _status: IRevBuiltInRuntimeStatus = {
		state: 'idle',
		supported: isSupportedHost(),
	};

	private _sdk: FoundryLocal | undefined;
	private _manager: FoundryLocalManager | undefined;
	private readonly _loadedModels = new Map<string, FoundryModel>();
	private readonly _activeStreams = new Map<string, IActiveStream>();
	private readonly _downloadControllers = new Map<string, AbortController>();
	private _activeRequestId: string | undefined;

	async getStatus(): Promise<IRevBuiltInRuntimeStatus> {
		return { ...this._status };
	}

	async listModels(): Promise<readonly IRevBuiltInCatalogModel[]> {
		this.assertSupported();
		this.setStatus({ state: 'discovering', supported: true, message: 'Discovering local models…' });
		try {
			const manager = await this.getManager();
			const cached = await manager.catalog.getCachedModels();
			let models = cached;
			try {
				const discovered = await manager.catalog.getModels();
				const byId = new Map<string, FoundryModel>();
				for (const model of [...cached, ...discovered]) {
					byId.set(model.id, model);
				}
				models = [...byId.values()];
			} catch (error) {
				if (!cached.length) {
					throw error;
				}
				// Offline after first use is a supported scenario: cached models are
				// enough to keep Rev Assistant available without catalog access.
			}
			const result = await Promise.all(models.map(model => this.toCatalogModel(model)));
			this.setStatus(this._loadedModels.size
				? { state: 'ready', supported: true, activeModelAlias: this._loadedModels.keys().next().value }
				: { state: 'idle', supported: true });
			return result.sort((a, b) => a.alias.localeCompare(b.alias) || a.id.localeCompare(b.id));
		} catch (error) {
			this.fail(error);
			throw error;
		}
	}

	async prepareModel(modelAlias: string): Promise<IRevBuiltInCatalogModel> {
		return this.prepareModelInternal(modelAlias, `prepare:${modelAlias}`);
	}

	private async prepareModelInternal(modelAlias: string, cancellationKey: string): Promise<IRevBuiltInCatalogModel> {
		this.assertSupported();
		const alias = modelAlias.trim();
		if (!alias) {
			throw new Error('Rev built-in model alias must not be empty.');
		}

		try {
			const manager = await this.getManager();
			const existing = this._loadedModels.get(alias);
			if (existing && await existing.isLoaded()) {
				this.setStatus({ state: 'ready', supported: true, activeModelAlias: alias });
				return this.toCatalogModel(existing);
			}

			const model = await manager.catalog.getModel(alias);
			if (!model) {
				throw new Error(`Foundry Local model was not found: ${alias}`);
			}

			if (!model.isCached) {
				const controller = new AbortController();
				this._downloadControllers.set(cancellationKey, controller);
				this.setStatus({ state: 'downloading', supported: true, activeModelAlias: alias, progress: 0, message: `Downloading ${alias}…` });
				try {
					await model.download(progress => {
						const normalized = Math.max(0, Math.min(100, progress));
						this.setStatus({
							state: 'downloading',
							supported: true,
							activeModelAlias: alias,
							progress: normalized,
							message: `Downloading ${alias}… ${normalized.toFixed(0)}%`,
						});
					}, controller.signal);
				} finally {
					this._downloadControllers.delete(cancellationKey);
				}
			}

			this.setStatus({ state: 'loading', supported: true, activeModelAlias: alias, message: `Loading ${alias}…` });
			await this.unloadOtherModels(alias);
			await model.load();
			this._loadedModels.set(alias, model);
			this.setStatus({ state: 'ready', supported: true, activeModelAlias: alias });
			return this.toCatalogModel(model);
		} catch (error) {
			this.fail(error, alias);
			throw error;
		}
	}

	async generate(request: IRevBuiltInRuntimeRequest): Promise<IRevIntelligenceResponse> {
		// One implementation path keeps cancellation and lifecycle behavior
		// identical for streaming and non-streaming assistant callers.
		return this.stream(request);
	}

	async stream(request: IRevBuiltInRuntimeRequest): Promise<IRevIntelligenceResponse> {
		this.validateRequest(request);
		if (this._activeRequestId && this._activeRequestId !== request.requestId) {
			throw new Error('Rev built-in intelligence is busy with another request.');
		}
		this._activeRequestId = request.requestId;

		let model: FoundryModel | undefined;
		try {
			model = await this.ensureLoadedModel(request.modelAlias, request.requestId);
		} catch (error) {
			this._activeRequestId = undefined;
			if (isCancellationError(error)) {
				this._onDidStreamEvent.fire({ type: 'cancelled', requestId: request.requestId });
				this.setStatus({ state: 'ready', supported: true, activeModelAlias: request.modelAlias });
			} else {
				this.fail(error, request.modelAlias);
			}
			throw error;
		}

		const client = model.createChatClient();
		const iterable = client.completeStreamingChat(toFoundryMessages(request));
		const iterator = iterable[Symbol.asyncIterator]();
		const active: IActiveStream = { iterator, cancelled: false };
		this._activeStreams.set(request.requestId, active);
		this.setStatus({ state: 'generating', supported: true, activeModelAlias: request.modelAlias });
		this._onDidStreamEvent.fire({ type: 'started', requestId: request.requestId, modelId: model.id });

		let content = '';
		try {
			while (!active.cancelled) {
				const next = await iterator.next();
				if (next.done) {
					break;
				}
				const token = next.value?.choices?.[0]?.delta?.content;
				if (typeof token === 'string' && token) {
					content += token;
					this._onDidStreamEvent.fire({ type: 'token', requestId: request.requestId, token });
				}
			}

			if (active.cancelled) {
				this._onDidStreamEvent.fire({ type: 'cancelled', requestId: request.requestId });
				this.setStatus({ state: 'ready', supported: true, activeModelAlias: request.modelAlias });
				throw createCancelledError(request.requestId);
			}

			const response: IRevIntelligenceResponse = {
				requestId: request.requestId,
				modelId: model.id,
				content,
			};
			this._onDidStreamEvent.fire({ type: 'completed', requestId: request.requestId, response });
			this.setStatus({ state: 'ready', supported: true, activeModelAlias: request.modelAlias });
			return response;
		} catch (error) {
			if (!active.cancelled) {
				this._onDidStreamEvent.fire({
					type: 'error',
					requestId: request.requestId,
					message: error instanceof Error ? error.message : String(error),
				});
				this.fail(error, request.modelAlias);
			}
			throw error;
		} finally {
			this._activeStreams.delete(request.requestId);
			this._activeRequestId = undefined;
			if (active.cancelled && iterator.return) {
				await iterator.return().catch(() => { /* best effort */ });
			}
		}
	}

	async cancel(requestId: string): Promise<void> {
		const controller = this._downloadControllers.get(requestId);
		controller?.abort();

		const active = this._activeStreams.get(requestId);
		if (active) {
			active.cancelled = true;
			if (active.iterator.return) {
				await active.iterator.return().catch(() => { /* best effort */ });
			}
		}
	}

	async unload(modelAlias?: string): Promise<void> {
		if (this._activeRequestId) {
			throw new Error('Cannot unload Rev built-in models while inference is active.');
		}
		const targets = modelAlias
			? [[modelAlias, this._loadedModels.get(modelAlias)] as const]
			: [...this._loadedModels.entries()];

		for (const [alias, model] of targets) {
			if (!model) {
				continue;
			}
			await model.unload();
			this._loadedModels.delete(alias);
		}

		this.setStatus({ state: 'idle', supported: isSupportedHost() });
	}

	override dispose(): void {
		for (const controller of this._downloadControllers.values()) {
			controller.abort();
		}
		for (const active of this._activeStreams.values()) {
			active.cancelled = true;
			void active.iterator.return?.();
		}
		this._activeStreams.clear();
		for (const model of this._loadedModels.values()) {
			void model.unload();
		}
		this._loadedModels.clear();
		super.dispose();
	}

	private async ensureLoadedModel(alias: string, cancellationKey: string): Promise<FoundryModel> {
		const existing = this._loadedModels.get(alias);
		if (existing && await existing.isLoaded()) {
			return existing;
		}
		await this.prepareModelInternal(alias, cancellationKey);
		const loaded = this._loadedModels.get(alias);
		if (!loaded) {
			throw new Error(`Rev built-in model failed to load: ${alias}`);
		}
		return loaded;
	}

	private async unloadOtherModels(aliasToKeep: string): Promise<void> {
		for (const [alias, model] of [...this._loadedModels.entries()]) {
			if (alias === aliasToKeep) {
				continue;
			}
			await model.unload();
			this._loadedModels.delete(alias);
		}
	}

	private async getManager(): Promise<FoundryLocalManager> {
		if (this._manager) {
			return this._manager;
		}

		const revDataRoot = join(os.homedir(), product.dataFolderName, 'rev-intelligence');
		const runtime = product.dictationRuntime;
		if (runtime) {
			this.setStatus({
				state: 'loading',
				supported: true,
				message: 'Preparing Rev local intelligence runtime…',
			});
			const overrideDir = await ensureFoundryLocalRuntime(
				join(revDataRoot, 'runtime'),
				runtime,
				CancellationToken.None,
				message => this.setStatus({ state: 'loading', supported: true, message }),
			);
			process.env.VSCODE_FOUNDRY_LOCAL_NATIVE_DIR = overrideDir;
		}

		this._sdk ??= await import('foundry-local-sdk');
		this._manager = this._sdk.FoundryLocalManager.create({
			appName: 'ryzova-rev',
			appDataDir: revDataRoot,
			modelCacheDir: join(revDataRoot, 'models'),
			logsDir: join(revDataRoot, 'logs'),
			logLevel: 'warn',
		});
		return this._manager;
	}

	private async toCatalogModel(model: FoundryModel): Promise<IRevBuiltInCatalogModel> {
		const inputModalities = splitMetadata(model.inputModalities);
		const outputModalities = splitMetadata(model.outputModalities);
		return {
			id: model.id,
			alias: model.alias,
			displayName: model.info.displayName ?? model.alias,
			contextLength: model.contextLength ?? undefined,
			inputModalities,
			outputModalities,
			supportsToolCalling: model.supportsToolCalling ?? undefined,
			capabilities: splitMetadata(model.capabilities),
			catalogTask: model.info.task ?? undefined,
			isCached: model.isCached,
			isLoaded: await model.isLoaded(),
		};
	}

	private validateRequest(request: IRevBuiltInRuntimeRequest): void {
		this.assertSupported();
		if (!request.requestId.trim()) {
			throw new Error('Rev built-in request ID must not be empty.');
		}
		if (!request.modelAlias.trim()) {
			throw new Error('Rev built-in model alias must not be empty.');
		}
		if (!request.messages.length) {
			throw new Error('Rev built-in request must include at least one message.');
		}
		if (request.task === 'code-helper' && request.allowCodeAuthoring !== true) {
			throw new Error('Rev built-in code-helper requests require explicit code-authoring opt-in.');
		}
		if (request.imageReferences?.length) {
			throw new Error('Rev built-in image input is not enabled by the current Foundry Local chat API.');
		}
	}

	private assertSupported(): void {
		if (!isSupportedHost()) {
			throw new Error(`Rev built-in local intelligence is not supported on ${process.platform}-${process.arch}.`);
		}
	}

	private fail(error: unknown, activeModelAlias?: string): void {
		this.setStatus({
			state: 'error',
			supported: isSupportedHost(),
			activeModelAlias,
			message: error instanceof Error ? error.message : String(error),
		});
	}

	private setStatus(status: IRevBuiltInRuntimeStatus): void {
		this._status = status;
		this._onDidChangeStatus.fire({ ...status });
	}
}

function isSupportedHost(): boolean {
	return SUPPORTED_TARGETS.has(`${process.platform}-${process.arch}`);
}

function splitMetadata(value: string | null): readonly string[] | undefined {
	if (!value) {
		return undefined;
	}
	const values = value.split(',').map(entry => entry.trim()).filter(Boolean);
	return values.length ? values : undefined;
}

function toFoundryMessages(request: IRevBuiltInRuntimeRequest): { role: string; content: string }[] {
	return request.messages.map(message => ({
		role: message.role,
		content: message.content,
	}));
}

function isCancellationError(error: unknown): boolean {
	return error instanceof Error && (
		(error as Error & { code?: string }).code === 'ERR_REV_CANCELLED'
		|| error.name === 'AbortError'
		|| /abort|cancel/i.test(error.message)
	);
}

function createCancelledError(requestId: string): Error {
	const error = new Error(`Rev built-in request was cancelled: ${requestId}`);
	(error as Error & { code?: string }).code = 'ERR_REV_CANCELLED';
	return error;
}
