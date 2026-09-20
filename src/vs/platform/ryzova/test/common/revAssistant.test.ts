/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
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

	constructor(
		id: string,
		scope: IRevIntelligenceProviderDescriptor['scope'],
		private readonly modelList: readonly IRevIntelligenceModelDescriptor[],
		private readonly prefix = 'reply',
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
