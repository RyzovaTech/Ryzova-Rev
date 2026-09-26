/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech.
 *  SPDX-License-Identifier: GPL-3.0-only
 *  See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	IRevEngineeringAvailability,
	IRevEngineeringModelDescriptor,
	IRevEngineeringProvider,
	IRevEngineeringProviderDescriptor,
	IRevEngineeringRequest,
	IRevEngineeringResponse,
} from '../../common/revEngineering.js';
import { RevEngineeringRegistryService } from '../../common/revEngineeringRegistry.js';
import {
	IRevIntelligenceAvailability,
	IRevIntelligenceModelDescriptor,
	IRevIntelligenceProvider,
	IRevIntelligenceProviderDescriptor,
	IRevIntelligenceRequest,
	IRevIntelligenceResponse,
} from '../../common/revIntelligence.js';
import { RevIntelligenceRegistryService } from '../../common/revIntelligenceRegistry.js';

class TestEngineeringProvider implements IRevEngineeringProvider {
	readonly descriptor: IRevEngineeringProviderDescriptor;

	constructor(
		id: string,
		private readonly modelList: readonly IRevEngineeringModelDescriptor[],
		private readonly available = true,
	) {
		this.descriptor = { id, displayName: id, kind: 'byok' };
	}

	async models(): Promise<readonly IRevEngineeringModelDescriptor[]> {
		return this.modelList;
	}

	async availability(): Promise<IRevEngineeringAvailability> {
		return { available: this.available, state: this.available ? 'ready' : 'unavailable' };
	}

	async generate(request: IRevEngineeringRequest): Promise<IRevEngineeringResponse> {
		return { requestId: request.requestId, modelId: request.model.id, content: 'ok' };
	}
}

class TestAssistantProvider implements IRevIntelligenceProvider {
	readonly descriptor: IRevIntelligenceProviderDescriptor = {
		id: 'shared-id',
		displayName: 'Assistant only',
		scope: 'rev-assistant',
		kind: 'built-in-local',
	};

	async models(): Promise<readonly IRevIntelligenceModelDescriptor[]> {
		return [{ id: 'assistant', providerId: this.descriptor.id, displayName: 'Assistant', task: 'assistant' }];
	}

	async availability(): Promise<IRevIntelligenceAvailability> {
		return { available: true, state: 'ready' };
	}

	async generate(request: IRevIntelligenceRequest): Promise<IRevIntelligenceResponse> {
		return { requestId: request.requestId, modelId: request.model.id, content: 'assistant' };
	}
}

suite('Ryzova Rev Engineering Registry', function () {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('resolves deterministic engineering routes by task and priority', async function () {
		const registry = new RevEngineeringRegistryService();
		const provider = new TestEngineeringProvider('engineer', [
			{ id: 'execute-low', providerId: 'engineer', displayName: 'Low', tasks: ['execute'], priority: 10 },
			{ id: 'plan', providerId: 'engineer', displayName: 'Plan', tasks: ['plan'], priority: 50 },
			{ id: 'execute-high', providerId: 'engineer', displayName: 'High', tasks: ['execute'], priority: 100 },
		]);
		const registration = registry.registerProvider(provider);

		const routes = await registry.resolveRoutes('execute');
		assert.deepStrictEqual(routes.map(route => route.model.id), ['execute-high', 'execute-low']);

		registration.dispose();
	});

	test('enforces engineering capability constraints', async function () {
		const registry = new RevEngineeringRegistryService();
		const provider = new TestEngineeringProvider('engineer', [
			{
				id: 'plain',
				providerId: 'engineer',
				displayName: 'Plain',
				tasks: ['execute'],
				contextWindow: 32_768,
			},
			{
				id: 'tools',
				providerId: 'engineer',
				displayName: 'Tools',
				tasks: ['execute'],
				contextWindow: 65_536,
				supportsToolCalling: true,
				supportsStreaming: true,
			},
			{
				id: 'unknown-context',
				providerId: 'engineer',
				displayName: 'Unknown',
				tasks: ['execute'],
				supportsToolCalling: true,
				supportsStreaming: true,
			},
		]);
		const registration = registry.registerProvider(provider);

		const routes = await registry.resolveRoutes('execute', {
			minimumContextWindow: 40_000,
			requireToolCalling: true,
			requireStreaming: true,
		});
		assert.deepStrictEqual(routes.map(route => route.model.id), ['tools']);

		registration.dispose();
	});

	test('isolates engineering providers from Rev Assistant routing', async function () {
		const engineeringRegistry = new RevEngineeringRegistryService();
		const assistantRegistry = new RevIntelligenceRegistryService();

		const engineeringRegistration = engineeringRegistry.registerProvider(new TestEngineeringProvider('shared-id', [{
			id: 'engineer',
			providerId: 'shared-id',
			displayName: 'Engineer',
			tasks: ['plan', 'execute'],
			priority: 100,
		}]));
		const assistantRegistration = assistantRegistry.registerProvider(new TestAssistantProvider());

		assert.strictEqual((await engineeringRegistry.resolveRoute('plan')).model.id, 'engineer');
		assert.strictEqual((await assistantRegistry.resolveAssistantRoute('assistant')).model.id, 'assistant');

		engineeringRegistration.dispose();
		assistantRegistration.dispose();
	});

	test('skips unavailable or broken engineering providers', async function () {
		const registry = new RevEngineeringRegistryService();
		const unavailable = registry.registerProvider(new TestEngineeringProvider('unavailable', [{
			id: 'unavailable-model',
			providerId: 'unavailable',
			displayName: 'Unavailable',
			tasks: ['diagnose'],
			priority: 200,
		}], false));
		const available = registry.registerProvider(new TestEngineeringProvider('available', [{
			id: 'available-model',
			providerId: 'available',
			displayName: 'Available',
			tasks: ['diagnose'],
			priority: 10,
		}]));

		assert.strictEqual((await registry.resolveRoute('diagnose')).model.id, 'available-model');

		unavailable.dispose();
		available.dispose();
	});
});
