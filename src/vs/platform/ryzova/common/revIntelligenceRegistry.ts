/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech.
 *  SPDX-License-Identifier: GPL-3.0-only
 *  See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IRevIntelligenceModelDescriptor, IRevIntelligenceProvider, RevIntelligenceTask } from './revIntelligence.js';

export interface IRevIntelligenceRoute {
	readonly provider: IRevIntelligenceProvider;
	readonly model: IRevIntelligenceModelDescriptor;
}

export const IRevIntelligenceRegistryService = createDecorator<IRevIntelligenceRegistryService>('revIntelligenceRegistryService');

export interface IRevIntelligenceRegistryService {
	readonly _serviceBrand: undefined;

	registerProvider(provider: IRevIntelligenceProvider): IDisposable;
	getProvider(id: string): IRevIntelligenceProvider | undefined;
	listProviders(): readonly IRevIntelligenceProvider[];
	resolveAssistantRoute(task: RevIntelligenceTask): Promise<IRevIntelligenceRoute>;
}

export class RevIntelligenceRegistryService implements IRevIntelligenceRegistryService {
	declare readonly _serviceBrand: undefined;

	private readonly providers = new Map<string, IRevIntelligenceProvider>();

	registerProvider(provider: IRevIntelligenceProvider): IDisposable {
		const id = provider.descriptor.id.trim();
		if (!id) {
			throw new Error('Rev intelligence provider ID must not be empty.');
		}
		if (this.providers.has(id)) {
			throw new Error(`Rev intelligence provider already registered: ${id}`);
		}

		this.providers.set(id, provider);
		return toDisposable(() => {
			if (this.providers.get(id) === provider) {
				this.providers.delete(id);
			}
		});
	}

	getProvider(id: string): IRevIntelligenceProvider | undefined {
		return this.providers.get(id);
	}

	listProviders(): readonly IRevIntelligenceProvider[] {
		return [...this.providers.values()].sort((a, b) => a.descriptor.id.localeCompare(b.descriptor.id));
	}

	async resolveAssistantRoute(task: RevIntelligenceTask): Promise<IRevIntelligenceRoute> {
		const assistantProviders = this.listProviders().filter(provider => provider.descriptor.scope === 'rev-assistant');
		const candidates: { provider: IRevIntelligenceProvider; model: IRevIntelligenceModelDescriptor }[] = [];

		for (const provider of assistantProviders) {
			try {
				const availability = await provider.availability();
				if (!availability.available) {
					continue;
				}

				for (const model of await provider.models()) {
					if (
						model.providerId === provider.descriptor.id
						&& model.task === task
						&& (task !== 'vision' || model.supportsVision === true)
					) {
						candidates.push({ provider, model });
					}
				}
			} catch {
				// A broken provider must not prevent another built-in Rev Assistant provider from serving the task.
				continue;
			}
		}

		candidates.sort((a, b) => {
			const priorityDelta = (b.model.priority ?? 0) - (a.model.priority ?? 0);
			if (priorityDelta !== 0) {
				return priorityDelta;
			}
			const providerDelta = a.provider.descriptor.id.localeCompare(b.provider.descriptor.id);
			return providerDelta !== 0 ? providerDelta : a.model.id.localeCompare(b.model.id);
		});

		const route = candidates[0];
		if (!route) {
			throw new Error(`No built-in Rev Assistant model is available for task: ${task}.`);
		}
		return route;
	}
}
