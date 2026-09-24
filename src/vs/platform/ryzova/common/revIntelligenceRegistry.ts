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

export interface IRevIntelligenceRouteOptions {
	readonly minimumContextWindow?: number;
	readonly requireVision?: boolean;
	readonly excludedProviderIds?: readonly string[];
	readonly excludedModelIds?: readonly string[];
}

export const IRevIntelligenceRegistryService = createDecorator<IRevIntelligenceRegistryService>('revIntelligenceRegistryService');

export interface IRevIntelligenceRegistryService {
	readonly _serviceBrand: undefined;

	registerProvider(provider: IRevIntelligenceProvider): IDisposable;
	getProvider(id: string): IRevIntelligenceProvider | undefined;
	listProviders(): readonly IRevIntelligenceProvider[];
	resolveAssistantRoutes(task: RevIntelligenceTask, options?: IRevIntelligenceRouteOptions): Promise<readonly IRevIntelligenceRoute[]>;
	resolveAssistantRoute(task: RevIntelligenceTask, options?: IRevIntelligenceRouteOptions): Promise<IRevIntelligenceRoute>;
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

	async resolveAssistantRoutes(task: RevIntelligenceTask, options: IRevIntelligenceRouteOptions = {}): Promise<readonly IRevIntelligenceRoute[]> {
		const excludedProviderIds = new Set(options.excludedProviderIds ?? []);
		const excludedModelIds = new Set(options.excludedModelIds ?? []);
		const requireVision = options.requireVision ?? task === 'vision';
		const minimumContextWindow = Math.max(0, options.minimumContextWindow ?? 0);
		const assistantProviders = this.listProviders().filter(provider =>
			provider.descriptor.scope === 'rev-assistant' && !excludedProviderIds.has(provider.descriptor.id)
		);
		const candidates: IRevIntelligenceRoute[] = [];

		for (const provider of assistantProviders) {
			try {
				const availability = await provider.availability();
				if (!availability.available) {
					continue;
				}

				for (const model of await provider.models()) {
					if (model.providerId !== provider.descriptor.id || model.task !== task) {
						continue;
					}
					if (excludedModelIds.has(model.id)) {
						continue;
					}
					if (requireVision && model.supportsVision !== true) {
						continue;
					}
					if (minimumContextWindow > 0 && (model.contextWindow === undefined || model.contextWindow < minimumContextWindow)) {
						continue;
					}
					candidates.push({ provider, model });
				}
			} catch {
				// A broken provider must not prevent another Rev Assistant provider from serving the task.
				continue;
			}
		}

		candidates.sort((a, b) => {
			const priorityDelta = (b.model.priority ?? 0) - (a.model.priority ?? 0);
			if (priorityDelta !== 0) {
				return priorityDelta;
			}
			const loadedDelta = Number(Boolean(b.model.isLoaded)) - Number(Boolean(a.model.isLoaded));
			if (loadedDelta !== 0) {
				return loadedDelta;
			}
			const cachedDelta = Number(Boolean(b.model.isCached)) - Number(Boolean(a.model.isCached));
			if (cachedDelta !== 0) {
				return cachedDelta;
			}
			const contextKnowledgeDelta = Number(b.model.contextWindow !== undefined) - Number(a.model.contextWindow !== undefined);
			if (minimumContextWindow > 0 && contextKnowledgeDelta !== 0) {
				return contextKnowledgeDelta;
			}
			const providerDelta = a.provider.descriptor.id.localeCompare(b.provider.descriptor.id);
			if (providerDelta !== 0) {
				return providerDelta;
			}
			const routingRankDelta = (a.model.routingRank ?? Number.MAX_SAFE_INTEGER) - (b.model.routingRank ?? Number.MAX_SAFE_INTEGER);
			return routingRankDelta !== 0 ? routingRankDelta : a.model.id.localeCompare(b.model.id);
		});

		return candidates;
	}

	async resolveAssistantRoute(task: RevIntelligenceTask, options?: IRevIntelligenceRouteOptions): Promise<IRevIntelligenceRoute> {
		const route = (await this.resolveAssistantRoutes(task, options))[0];
		if (!route) {
			throw new Error(`No built-in Rev Assistant model is available for task: ${task}.`);
		}
		return route;
	}
}
