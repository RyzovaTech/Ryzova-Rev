/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { RevBuiltInIntelligenceProvider } from '../../common/revBuiltInIntelligenceProvider.js';
import {
	IRevBuiltInModelRuntimeService,
	IRevBuiltInRuntimeRequest,
	IRevBuiltInRuntimeStatus,
} from '../../common/revBuiltInModelRuntime.js';
import { IRevBuiltInCatalogModel } from '../../common/revBuiltInModels.js';
import { IRevIntelligenceResponse, RevIntelligenceStreamEvent } from '../../common/revIntelligence.js';

class TestRuntime extends Disposable implements IRevBuiltInModelRuntimeService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeStatus = this._register(new Emitter<IRevBuiltInRuntimeStatus>());
	readonly onDidChangeStatus: Event<IRevBuiltInRuntimeStatus> = this._onDidChangeStatus.event;

	private readonly _onDidStreamEvent = this._register(new Emitter<RevIntelligenceStreamEvent>());
	readonly onDidStreamEvent: Event<RevIntelligenceStreamEvent> = this._onDidStreamEvent.event;

	status: IRevBuiltInRuntimeStatus = { state: 'idle', supported: true };
	catalog: readonly IRevBuiltInCatalogModel[] = [];
	lastRequest: IRevBuiltInRuntimeRequest | undefined;
	cancelled: string[] = [];

	async getStatus(): Promise<IRevBuiltInRuntimeStatus> {
		return this.status;
	}

	async listModels(): Promise<readonly IRevBuiltInCatalogModel[]> {
		return this.catalog;
	}

	async prepareModel(modelAlias: string): Promise<IRevBuiltInCatalogModel> {
		const model = this.catalog.find(candidate => candidate.alias === modelAlias);
		if (!model) {
			throw new Error('missing test model');
		}
		return model;
	}

	async generate(request: IRevBuiltInRuntimeRequest): Promise<IRevIntelligenceResponse> {
		return this.stream(request);
	}

	async stream(request: IRevBuiltInRuntimeRequest): Promise<IRevIntelligenceResponse> {
		this.lastRequest = request;
		this._onDidStreamEvent.fire({ type: 'token', requestId: 'unrelated', token: 'ignore' });
		this._onDidStreamEvent.fire({ type: 'started', requestId: request.requestId, modelId: request.modelAlias });
		this._onDidStreamEvent.fire({ type: 'token', requestId: request.requestId, token: 'hello' });
		const response = { requestId: request.requestId, modelId: request.modelAlias, content: 'hello' };
		this._onDidStreamEvent.fire({ type: 'completed', requestId: request.requestId, response });
		return response;
	}

	async cancel(requestId: string): Promise<void> {
		this.cancelled.push(requestId);
	}

	async unload(): Promise<void> { }
}

suite('Ryzova Rev Built-in Intelligence Provider', function () {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('maps local catalog models to assistant task descriptors', async function () {
		const runtime = new TestRuntime();
		runtime.catalog = [
			{ id: 'general-v1', alias: 'qwen2.5-1.5b', displayName: 'General', inputModalities: ['text'], outputModalities: ['text'], capabilities: ['chat'] },
			{ id: 'coder-v1', alias: 'qwen2.5-coder-1.5b', displayName: 'Coder', inputModalities: ['text'], outputModalities: ['text'], capabilities: ['chat'] },
		];
		const provider = new RevBuiltInIntelligenceProvider(runtime);

		const models = await provider.models();
		assert.deepStrictEqual(models.map(model => model.task), ['assistant', 'reasoning', 'code-helper']);
		assert.strictEqual(models[0].runtimeModelAlias, 'qwen2.5-1.5b');
		assert.strictEqual(models[1].runtimeModelAlias, 'qwen2.5-1.5b');
		assert.strictEqual(models[2].runtimeModelAlias, 'qwen2.5-coder-1.5b');

		provider.dispose();
		runtime.dispose();
	});

	test('reports unsupported runtime without exposing the provider as available', async function () {
		const runtime = new TestRuntime();
		runtime.status = { state: 'idle', supported: false };
		const provider = new RevBuiltInIntelligenceProvider(runtime);

		const availability = await provider.availability();
		assert.strictEqual(availability.available, false);
		assert.strictEqual(availability.state, 'unavailable');

		provider.dispose();
		runtime.dispose();
	});

	test('delegates generation to the runtime alias selected by routing', async function () {
		const runtime = new TestRuntime();
		const provider = new RevBuiltInIntelligenceProvider(runtime);

		const response = await provider.generate({
			requestId: 'request-1',
			task: 'assistant',
			model: {
				id: 'descriptor',
				providerId: provider.descriptor.id,
				displayName: 'Local',
				task: 'assistant',
				runtimeModelAlias: 'qwen2.5-1.5b',
			},
			messages: [{ role: 'user', content: 'Hello' }],
			allowCodeAuthoring: false,
		});

		assert.strictEqual(response.content, 'hello');
		assert.strictEqual(runtime.lastRequest?.modelAlias, 'qwen2.5-1.5b');
		assert.strictEqual(runtime.lastRequest?.requestId, 'request-1');

		provider.dispose();
		runtime.dispose();
	});

	test('forwards only stream events belonging to the current request', async function () {
		const runtime = new TestRuntime();
		const provider = new RevBuiltInIntelligenceProvider(runtime);
		const events: RevIntelligenceStreamEvent[] = [];

		await provider.stream({
			requestId: 'request-2',
			task: 'assistant',
			model: {
				id: 'descriptor',
				providerId: provider.descriptor.id,
				displayName: 'Local',
				task: 'assistant',
				runtimeModelAlias: 'qwen2.5-1.5b',
			},
			messages: [{ role: 'user', content: 'Stream' }],
			allowCodeAuthoring: false,
		}, event => events.push(event));

		assert.deepStrictEqual(events.map(event => event.type), ['started', 'token', 'completed']);
		assert.ok(events.every(event => event.requestId === 'request-2'));

		provider.dispose();
		runtime.dispose();
	});
});
