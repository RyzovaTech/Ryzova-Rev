/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech.
 *  SPDX-License-Identifier: GPL-3.0-only
 *  See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { RevAssistantStreamEvent } from '../../common/revAssistant.js';
import { RevAssistantError } from '../../common/revAssistantErrors.js';
import { RevAssistantService } from '../../common/revAssistantService.js';
import { buildRevAssistantContextSnapshot, createRevAssistantContextContribution, IRevAssistantContextBuildRequest, IRevAssistantContextService } from '../../common/revAssistantContext.js';
import {
	IRevIntelligenceAvailability,
	IRevIntelligenceModelDescriptor,
	IRevIntelligenceProvider,
	IRevIntelligenceProviderDescriptor,
	IRevIntelligenceRequest,
	IRevIntelligenceResponse,
} from '../../common/revIntelligence.js';
import { RevIntelligenceRegistryService } from '../../common/revIntelligenceRegistry.js';

type TestStreamBehavior = 'fail-before-token' | 'fail-after-token' | 'wait-for-cancel' | 'tokens-empty-final';

class TestIntelligenceProvider implements IRevIntelligenceProvider {
	readonly descriptor: IRevIntelligenceProviderDescriptor;
	readonly attempts: string[] = [];
	readonly requests: IRevIntelligenceRequest[] = [];
	readonly cancelled: string[] = [];

	constructor(
		id: string,
		scope: IRevIntelligenceProviderDescriptor['scope'],
		private readonly modelList: readonly IRevIntelligenceModelDescriptor[],
		private readonly prefix = 'reply',
		private readonly failingModelIds: ReadonlySet<string> = new Set(),
		kind?: IRevIntelligenceProviderDescriptor['kind'],
		private readonly streamBehaviors: ReadonlyMap<string, TestStreamBehavior> = new Map(),
		private readonly nonRetryableModelIds: ReadonlySet<string> = new Set(),
	) {
		this.descriptor = {
			id,
			displayName: id,
			scope,
			kind: kind ?? (scope === 'rev-assistant' ? 'built-in-local' : 'external'),
		};
	}

	async models(): Promise<readonly IRevIntelligenceModelDescriptor[]> {
		return this.modelList;
	}

	async availability(): Promise<IRevIntelligenceAvailability> {
		return { available: true, state: 'ready' };
	}

	async generate(request: IRevIntelligenceRequest): Promise<IRevIntelligenceResponse> {
		this.attempts.push(request.model.id);
		this.requests.push(request);
		if (this.nonRetryableModelIds.has(request.model.id)) {
			throw new RevAssistantError(`non-retryable test failure: ${request.model.id}`, 'provider-failed', false);
		}
		if (this.failingModelIds.has(request.model.id)) {
			throw new Error(`test failure: ${request.model.id}`);
		}
		return {
			requestId: request.requestId,
			modelId: request.model.id,
			content: `${this.prefix}:${request.task}:${request.messages.at(-1)?.content ?? ''}`,
		};
	}

	async stream(
		request: IRevIntelligenceRequest,
		onEvent: (event: import('../../common/revIntelligence.js').RevIntelligenceStreamEvent) => void,
		signal?: AbortSignal,
	): Promise<IRevIntelligenceResponse> {
		const behavior = this.streamBehaviors.get(request.model.id);
		if (!behavior) {
			const response = await this.generate(request);
			onEvent({ type: 'started', requestId: request.requestId, modelId: request.model.id });
			if (response.content) {
				onEvent({ type: 'token', requestId: request.requestId, token: response.content });
			}
			onEvent({ type: 'completed', requestId: request.requestId, response });
			return response;
		}

		this.attempts.push(request.model.id);
		this.requests.push(request);
		onEvent({ type: 'started', requestId: request.requestId, modelId: request.model.id });

		if (behavior === 'fail-before-token') {
			throw new Error(`stream failed before output: ${request.model.id}`);
		}
		if (behavior === 'fail-after-token') {
			onEvent({ type: 'token', requestId: request.requestId, token: 'partial' });
			throw new Error(`stream failed after output: ${request.model.id}`);
		}
		if (behavior === 'tokens-empty-final') {
			onEvent({ type: 'token', requestId: request.requestId, token: 'streamed ' });
			onEvent({ type: 'token', requestId: request.requestId, token: 'answer' });
			return {
				requestId: request.requestId,
				modelId: request.model.id,
				content: '',
			};
		}

		return new Promise<IRevIntelligenceResponse>((_resolve, reject) => {
			const cancel = () => {
				const error = new Error('test stream cancelled');
				(error as Error & { code?: string }).code = 'ERR_REV_CANCELLED';
				reject(error);
			};
			if (signal?.aborted) {
				cancel();
				return;
			}
			signal?.addEventListener('abort', cancel, { once: true });
		});
	}

	async cancel(requestId: string): Promise<void> {
		this.cancelled.push(requestId);
	}
}

class TestAssistantContextService implements IRevAssistantContextService {
	declare readonly _serviceBrand: undefined;
	readonly includeWorkspaceContents: boolean[] = [];

	async buildContext(request: IRevAssistantContextBuildRequest) {
		this.includeWorkspaceContents.push(request.includeWorkspaceContents);
		return buildRevAssistantContextSnapshot(undefined, [
			createRevAssistantContextContribution(
				'test-project-context',
				'project',
				'Test project context',
				'local workspace context',
				100,
			),
		], request, 1);
	}
}

suite('Ryzova Rev Assistant', function () {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('assistant route never consumes engineering providers', async function () {
		const registry = new RevIntelligenceRegistryService();
		const assistantProvider = new TestIntelligenceProvider('assistant-provider', 'rev-assistant', [{
			id: 'assistant-model',
			providerId: 'assistant-provider',
			displayName: 'Assistant',
			task: 'assistant',
			priority: 10,
		}]);
		const engineeringProvider = new TestIntelligenceProvider('engineering-provider', 'engineering', [{
			id: 'engineering-model',
			providerId: 'engineering-provider',
			displayName: 'Engineering',
			task: 'assistant',
			priority: 100,
		}]);

		const assistantRegistration = registry.registerProvider(assistantProvider);
		const engineeringRegistration = registry.registerProvider(engineeringProvider);

		const route = await registry.resolveAssistantRoute('assistant');
		assert.strictEqual(route.provider.descriptor.id, 'assistant-provider');
		assert.strictEqual(route.model.id, 'assistant-model');

		assistantRegistration.dispose();
		engineeringRegistration.dispose();
	});

	test('route resolution returns deterministic fallback order', async function () {
		const registry = new RevIntelligenceRegistryService();
		const provider = new TestIntelligenceProvider('builtin', 'rev-assistant', [
			{ id: 'third', providerId: 'builtin', displayName: 'Third', task: 'assistant', priority: 90, routingRank: 2 },
			{ id: 'first', providerId: 'builtin', displayName: 'First', task: 'assistant', priority: 100, routingRank: 0 },
			{ id: 'second', providerId: 'builtin', displayName: 'Second', task: 'assistant', priority: 99, routingRank: 1 },
		]);
		const registration = registry.registerProvider(provider);

		const routes = await registry.resolveAssistantRoutes('assistant');
		assert.deepStrictEqual(routes.map(route => route.model.id), ['first', 'second', 'third']);

		registration.dispose();
	});

	test('route constraints filter incompatible context and vision models', async function () {
		const registry = new RevIntelligenceRegistryService();
		const provider = new TestIntelligenceProvider('builtin', 'rev-assistant', [
			{ id: 'small', providerId: 'builtin', displayName: 'Small', task: 'assistant', priority: 100, contextWindow: 4096 },
			{ id: 'large', providerId: 'builtin', displayName: 'Large', task: 'assistant', priority: 90, contextWindow: 32768 },
			{ id: 'vision', providerId: 'builtin', displayName: 'Vision', task: 'vision', priority: 100, supportsVision: true },
			{ id: 'not-vision', providerId: 'builtin', displayName: 'Text', task: 'vision', priority: 200, supportsVision: false },
		]);
		const registration = registry.registerProvider(provider);

		const contextRoutes = await registry.resolveAssistantRoutes('assistant', { minimumContextWindow: 8192 });
		assert.deepStrictEqual(contextRoutes.map(route => route.model.id), ['large']);

		const unknownContextRegistration = registry.registerProvider(new TestIntelligenceProvider('unknown-context', 'rev-assistant', [{
			id: 'unknown-context-model',
			providerId: 'unknown-context',
			displayName: 'Unknown Context',
			task: 'assistant',
			priority: 1000,
		}]));
		const constrainedRoutes = await registry.resolveAssistantRoutes('assistant', { minimumContextWindow: 8192 });
		assert.deepStrictEqual(constrainedRoutes.map(route => route.model.id), ['large']);
		unknownContextRegistration.dispose();

		const visionRoutes = await registry.resolveAssistantRoutes('vision', { requireVision: true });
		assert.deepStrictEqual(visionRoutes.map(route => route.model.id), ['vision']);

		registration.dispose();
	});

	test('assistant maintains conversation history and routes by intent', async function () {
		const registry = new RevIntelligenceRegistryService();
		const registration = registry.registerProvider(new TestIntelligenceProvider('builtin', 'rev-assistant', [
			{ id: 'guide', providerId: 'builtin', displayName: 'Guide', task: 'assistant' },
			{ id: 'reason', providerId: 'builtin', displayName: 'Reason', task: 'reasoning' },
			{ id: 'vision', providerId: 'builtin', displayName: 'Vision', task: 'vision', supportsVision: true },
			{ id: 'code', providerId: 'builtin', displayName: 'Code Helper', task: 'code-helper' },
		]));
		const service = new RevAssistantService(registry, new TestAssistantContextService());
		const conversation = service.createConversation('conversation-1');

		const reply = await service.ask({
			conversationId: conversation.id,
			content: 'Explain this project',
			intent: 'explain',
		});

		assert.strictEqual(reply.modelId, 'guide');
		assert.match(reply.message.content, /^reply:assistant:/);
		assert.strictEqual(reply.conversation.messages.length, 2);
		assert.strictEqual(reply.conversation.messages[0].role, 'user');
		assert.strictEqual(reply.conversation.messages[1].role, 'assistant');

		service.dispose();
		registration.dispose();
	});

	test('restores, orders, and deletes local conversation snapshots safely', function () {
		const registry = new RevIntelligenceRegistryService();
		const service = new RevAssistantService(registry, new TestAssistantContextService());
		const deleted: string[] = [];
		const listener = service.onDidDeleteConversation(id => deleted.push(id));

		service.restoreConversation({
			id: 'older',
			createdAt: 10,
			updatedAt: 20,
			messages: [{
				id: 'older-message',
				role: 'user',
				content: 'older',
				createdAt: 15,
			}],
		});
		service.restoreConversation({
			id: 'newer',
			createdAt: 30,
			updatedAt: 40,
			messages: [{
				id: 'newer-message',
				role: 'assistant',
				content: 'newer',
				createdAt: 40,
			}],
		});

		assert.deepStrictEqual(service.listConversations().map(conversation => conversation.id), ['newer', 'older']);
		assert.strictEqual(service.getConversation('newer')?.messages[0].content, 'newer');
		assert.throws(() => service.restoreConversation({
			id: '',
			createdAt: 0,
			updatedAt: 0,
			messages: [],
		}), /ID must not be empty/);
		assert.strictEqual(service.deleteConversation('older'), true);
		assert.deepStrictEqual(deleted, ['older']);

		listener.dispose();
		service.dispose();
	});

	test('assistant falls back to the next ranked model when the preferred route fails', async function () {
		const registry = new RevIntelligenceRegistryService();
		const provider = new TestIntelligenceProvider('builtin', 'rev-assistant', [
			{ id: 'primary', providerId: 'builtin', displayName: 'Primary', task: 'assistant', priority: 100 },
			{ id: 'fallback', providerId: 'builtin', displayName: 'Fallback', task: 'assistant', priority: 90 },
		], 'reply', new Set(['primary']));
		const registration = registry.registerProvider(provider);
		const service = new RevAssistantService(registry, new TestAssistantContextService());
		service.createConversation('conversation-fallback');

		const reply = await service.ask({
			conversationId: 'conversation-fallback',
			content: 'Explain the error',
			intent: 'explain',
		});

		assert.strictEqual(reply.modelId, 'fallback');
		assert.deepStrictEqual(provider.attempts, ['primary', 'fallback']);
		assert.strictEqual(reply.conversation.messages.length, 2);

		service.dispose();
		registration.dispose();
	});

	test('assistant does not retry a route after a non-retryable provider failure', async function () {
		const registry = new RevIntelligenceRegistryService();
		const provider = new TestIntelligenceProvider(
			'builtin',
			'rev-assistant',
			[
				{ id: 'primary', providerId: 'builtin', displayName: 'Primary', task: 'assistant', priority: 100 },
				{ id: 'fallback', providerId: 'builtin', displayName: 'Fallback', task: 'assistant', priority: 90 },
			],
			'reply',
			new Set(),
			undefined,
			new Map(),
			new Set(['primary']),
		);
		const registration = registry.registerProvider(provider);
		const service = new RevAssistantService(registry, new TestAssistantContextService());
		service.createConversation('conversation-non-retryable');

		await assert.rejects(
			() => service.ask({
				conversationId: 'conversation-non-retryable',
				content: 'Explain the error',
				intent: 'explain',
			}),
			(error: unknown) => error instanceof RevAssistantError && error.retryable === false,
		);

		assert.deepStrictEqual(provider.attempts, ['primary']);
		assert.strictEqual(service.getConversation('conversation-non-retryable')?.messages.length, 1);

		service.dispose();
		registration.dispose();
	});

	test('assistant rebuilds project context per fallback route to keep workspace data local', async function () {
		const registry = new RevIntelligenceRegistryService();
		const localProvider = new TestIntelligenceProvider('local', 'rev-assistant', [{
			id: 'local-model',
			providerId: 'local',
			displayName: 'Local',
			task: 'assistant',
			priority: 100,
		}], 'reply', new Set(['local-model']), 'built-in-local');
		const remoteProvider = new TestIntelligenceProvider('remote', 'rev-assistant', [{
			id: 'remote-model',
			providerId: 'remote',
			displayName: 'Remote',
			task: 'assistant',
			priority: 90,
		}], 'reply', new Set(), 'built-in-remote');
		const localRegistration = registry.registerProvider(localProvider);
		const remoteRegistration = registry.registerProvider(remoteProvider);
		const contextService = new TestAssistantContextService();
		const service = new RevAssistantService(registry, contextService);
		service.createConversation('conversation-private-context');

		const reply = await service.ask({
			conversationId: 'conversation-private-context',
			content: 'Explain this project',
			intent: 'explain',
		});

		assert.strictEqual(reply.modelId, 'remote-model');
		assert.deepStrictEqual(contextService.includeWorkspaceContents, [true, false]);
		assert.ok(localProvider.requests[0].messages.some(message => message.content.includes('local workspace context')));
		assert.ok(!remoteProvider.requests[0].messages.some(message => message.content.includes('local workspace context')));

		service.dispose();
		localRegistration.dispose();
		remoteRegistration.dispose();
	});

	test('streams assistant lifecycle and token events with a stable request ID', async function () {
		const registry = new RevIntelligenceRegistryService();
		const provider = new TestIntelligenceProvider('builtin', 'rev-assistant', [{
			id: 'stream-model',
			providerId: 'builtin',
			displayName: 'Stream Model',
			task: 'assistant',
		}]);
		const registration = registry.registerProvider(provider);
		const service = new RevAssistantService(registry, new TestAssistantContextService());
		service.createConversation('conversation-stream');
		const events: RevAssistantStreamEvent[] = [];

		const reply = await service.stream({
			requestId: 'assistant-request-1',
			conversationId: 'conversation-stream',
			content: 'Explain streaming',
			intent: 'explain',
		}, event => events.push(event));

		assert.strictEqual(reply.requestId, 'assistant-request-1');
		assert.deepStrictEqual(events.map(event => event.type), ['started', 'route', 'token', 'completed']);
		assert.ok(events.every(event => event.requestId === 'assistant-request-1'));
		assert.strictEqual(reply.conversation.messages.length, 2);
		assert.strictEqual(service.isRunning('assistant-request-1'), false);

		service.dispose();
		registration.dispose();
	});

	test('persists streamed output when a provider returns an empty final payload', async function () {
		const registry = new RevIntelligenceRegistryService();
		const provider = new TestIntelligenceProvider(
			'builtin',
			'rev-assistant',
			[{ id: 'stream-only', providerId: 'builtin', displayName: 'Stream Only', task: 'assistant' }],
			'reply',
			new Set(),
			undefined,
			new Map([['stream-only', 'tokens-empty-final']]),
		);
		const registration = registry.registerProvider(provider);
		const service = new RevAssistantService(registry, new TestAssistantContextService());
		service.createConversation('conversation-stream-only');

		const reply = await service.stream({
			requestId: 'assistant-request-stream-only',
			conversationId: 'conversation-stream-only',
			content: 'Explain streamed output',
			intent: 'explain',
		});

		assert.strictEqual(reply.message.content, 'streamed answer');
		assert.strictEqual(reply.conversation.messages.at(-1)?.content, 'streamed answer');

		service.dispose();
		registration.dispose();
	});

	test('does not switch models after streamed output has started', async function () {
		const registry = new RevIntelligenceRegistryService();
		const provider = new TestIntelligenceProvider(
			'builtin',
			'rev-assistant',
			[
				{ id: 'primary', providerId: 'builtin', displayName: 'Primary', task: 'assistant', priority: 100 },
				{ id: 'fallback', providerId: 'builtin', displayName: 'Fallback', task: 'assistant', priority: 90 },
			],
			'reply',
			new Set(),
			undefined,
			new Map([['primary', 'fail-after-token']]),
		);
		const registration = registry.registerProvider(provider);
		const service = new RevAssistantService(registry, new TestAssistantContextService());
		service.createConversation('conversation-partial');
		const events: RevAssistantStreamEvent[] = [];

		await assert.rejects(
			() => service.stream({
				requestId: 'assistant-request-partial',
				conversationId: 'conversation-partial',
				content: 'Explain safely',
				intent: 'explain',
			}, event => events.push(event)),
			(error: unknown) => error instanceof RevAssistantError && error.code === 'stream-failed',
		);

		assert.deepStrictEqual(provider.attempts, ['primary']);
		assert.deepStrictEqual(events.map(event => event.type), ['started', 'route', 'token', 'error']);
		assert.strictEqual(service.getConversation('conversation-partial')?.messages.length, 1);

		service.dispose();
		registration.dispose();
	});

	test('cancels an active streaming request without finalizing a partial assistant message', async function () {
		const registry = new RevIntelligenceRegistryService();
		const provider = new TestIntelligenceProvider(
			'builtin',
			'rev-assistant',
			[{ id: 'waiting', providerId: 'builtin', displayName: 'Waiting', task: 'assistant' }],
			'reply',
			new Set(),
			undefined,
			new Map([['waiting', 'wait-for-cancel']]),
		);
		const registration = registry.registerProvider(provider);
		const service = new RevAssistantService(registry, new TestAssistantContextService());
		service.createConversation('conversation-cancel');
		const events: RevAssistantStreamEvent[] = [];
		let routedResolve!: () => void;
		const routed = new Promise<void>(resolve => { routedResolve = resolve; });

		const pending = service.stream({
			requestId: 'assistant-request-cancel',
			conversationId: 'conversation-cancel',
			content: 'Keep thinking',
			intent: 'explain',
		}, event => {
			events.push(event);
			if (event.type === 'route') {
				routedResolve();
			}
		});

		await routed;
		assert.strictEqual(service.isRunning('assistant-request-cancel'), true);
		assert.strictEqual(await service.cancel('assistant-request-cancel'), true);

		await assert.rejects(
			() => pending,
			(error: unknown) => error instanceof RevAssistantError && error.code === 'cancelled',
		);
		assert.ok(events.some(event => event.type === 'cancelled'));
		assert.ok(!events.some(event => event.type === 'completed'));
		assert.strictEqual(service.getConversation('conversation-cancel')?.messages.length, 1);
		assert.strictEqual(provider.cancelled.length, 1);
		assert.strictEqual(service.isRunning('assistant-request-cancel'), false);

		service.dispose();
		registration.dispose();
	});

	test('returns a structured no-route error when no assistant model is available', async function () {
		const registry = new RevIntelligenceRegistryService();
		const service = new RevAssistantService(registry, new TestAssistantContextService());
		service.createConversation('conversation-no-route');

		await assert.rejects(
			() => service.ask({
				requestId: 'assistant-request-no-route',
				conversationId: 'conversation-no-route',
				content: 'Explain this',
				intent: 'explain',
			}),
			(error: unknown) => error instanceof RevAssistantError && error.code === 'no-route',
		);

		service.dispose();
	});

	test('code authoring requires explicit per-request opt-in', async function () {
		const registry = new RevIntelligenceRegistryService();
		const registration = registry.registerProvider(new TestIntelligenceProvider('builtin', 'rev-assistant', [{
			id: 'code',
			providerId: 'builtin',
			displayName: 'Code Helper',
			task: 'code-helper',
		}]));
		const service = new RevAssistantService(registry, new TestAssistantContextService());
		service.createConversation('conversation-1');

		await assert.rejects(() => service.ask({
			conversationId: 'conversation-1',
			content: 'Write the implementation',
			intent: 'code-authoring',
		}), /explicit per-request opt-in/);

		const reply = await service.ask({
			conversationId: 'conversation-1',
			content: 'Write the implementation',
			intent: 'code-authoring',
			allowCodeAuthoring: true,
		});
		assert.strictEqual(reply.modelId, 'code');

		service.dispose();
		registration.dispose();
	});

	test('visual analysis uses the assistant vision route', async function () {
		const registry = new RevIntelligenceRegistryService();
		const registration = registry.registerProvider(new TestIntelligenceProvider('builtin', 'rev-assistant', [{
			id: 'vision',
			providerId: 'builtin',
			displayName: 'Vision',
			task: 'vision',
			supportsVision: true,
		}]));
		const service = new RevAssistantService(registry, new TestAssistantContextService());
		service.createConversation('conversation-1');

		const reply = await service.ask({
			conversationId: 'conversation-1',
			content: 'What is wrong with this UI?',
			intent: 'visual-analysis',
			imageReferences: ['screenshot://1'],
		});

		assert.strictEqual(reply.modelId, 'vision');
		assert.match(reply.message.content, /^reply:vision:/);

		service.dispose();
		registration.dispose();
	});
});
