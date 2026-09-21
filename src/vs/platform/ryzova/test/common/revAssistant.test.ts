/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech.
 *  SPDX-License-Identifier: GPL-3.0-only
 *  See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { RevAssistantService } from '../../common/revAssistantService.js';
import {
	IRevIntelligenceAvailability,
	IRevIntelligenceModelDescriptor,
	IRevIntelligenceProvider,
	IRevIntelligenceProviderDescriptor,
	IRevIntelligenceRequest,
	IRevIntelligenceResponse,
} from '../../common/revIntelligence.js';
import { RevIntelligenceRegistryService } from '../../common/revIntelligenceRegistry.js';

class TestIntelligenceProvider implements IRevIntelligenceProvider {
	readonly descriptor: IRevIntelligenceProviderDescriptor;
	readonly attempts: string[] = [];

	constructor(
		id: string,
		scope: IRevIntelligenceProviderDescriptor['scope'],
		private readonly modelList: readonly IRevIntelligenceModelDescriptor[],
		private readonly prefix = 'reply',
		private readonly failingModelIds: ReadonlySet<string> = new Set(),
	) {
		this.descriptor = {
			id,
			displayName: id,
			scope,
			kind: scope === 'rev-assistant' ? 'built-in-local' : 'external',
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
		if (this.failingModelIds.has(request.model.id)) {
			throw new Error(`test failure: ${request.model.id}`);
		}
		return {
			requestId: request.requestId,
			modelId: request.model.id,
			content: `${this.prefix}:${request.task}:${request.messages.at(-1)?.content ?? ''}`,
		};
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
		const service = new RevAssistantService(registry);
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

	test('assistant falls back to the next ranked model when the preferred route fails', async function () {
		const registry = new RevIntelligenceRegistryService();
		const provider = new TestIntelligenceProvider('builtin', 'rev-assistant', [
			{ id: 'primary', providerId: 'builtin', displayName: 'Primary', task: 'assistant', priority: 100 },
			{ id: 'fallback', providerId: 'builtin', displayName: 'Fallback', task: 'assistant', priority: 90 },
		], 'reply', new Set(['primary']));
		const registration = registry.registerProvider(provider);
		const service = new RevAssistantService(registry);
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

	test('code authoring requires explicit per-request opt-in', async function () {
		const registry = new RevIntelligenceRegistryService();
		const registration = registry.registerProvider(new TestIntelligenceProvider('builtin', 'rev-assistant', [{
			id: 'code',
			providerId: 'builtin',
			displayName: 'Code Helper',
			task: 'code-helper',
		}]));
		const service = new RevAssistantService(registry);
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
		const service = new RevAssistantService(registry);
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
