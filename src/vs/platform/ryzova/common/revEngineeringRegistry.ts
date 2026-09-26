/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech.
 *  SPDX-License-Identifier: GPL-3.0-only
 *  See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import {
	IRevEngineeringModelDescriptor,
	IRevEngineeringProvider,
	RevEngineeringTask,
} from './revEngineering.js';

export interface IRevEngineeringRoute {
	readonly provider: IRevEngineeringProvider;
	readonly model: IRevEngineeringModelDescriptor;
}

export interface IRevEngineeringRouteOptions {
	readonly minimumContextWindow?: number;
	readonly requireToolCalling?: boolean;
	readonly requireStreaming?: boolean;
	readonly requireVision?: boolean;
	readonly excludedProviderIds?: readonly string[];
	readonly excludedModelIds?: readonly string[];
}

export const IRevEngineeringRegistryService = createDecorator<IRevEngineeringRegistryService>('revEngineeringRegistryService');

export interface IRevEngineeringRegistryService {
	readonly _serviceBrand: undefined;

	registerProvider(provider: IRevEngineeringProvider): IDisposable;
	getProvider(id: string): IRevEngineeringProvider | undefined;
	listProviders(): readonly IRevEngineeringProvider[];
	resolveRoutes(task: RevEngineeringTask, options?: IRevEngineeringRouteOptions): Promise<readonly IRevEngineeringRoute[]>;
	resolveRoute(task: RevEngineeringTask, options?: IRevEngineeringRouteOptions): Promise<IRevEngineeringRoute>;
}

export class RevEngineeringRegistryService implements IRevEngineeringRegistryService {
	declare readonly _serviceBrand: undefined;

	private readonly providers = new Map<string, IRevEngineeringProvider>();

	registerProvider(provider: IRevEngineeringProvider): IDisposable {
		const id = provider.descriptor.id.trim();
		if (!id) {
			throw new Error('Rev engineering provider ID must not be empty.');
		}
		if (this.providers.has(id)) {
			throw new Error(`Rev engineering provider already registered: ${id}`);
		}

		this.providers.set(id, provider);
		return toDisposable(() => {
			if (this.providers.get(id) === provider) {
				this.providers.delete(id);
			}
		});
	}

	getProvider(id: string): IRevEngineeringProvider | undefined {
		return this.providers.get(id.trim());
	}

	listProviders(): readonly IRevEngineeringProvider[] {
		return [...this.providers.values()].sort((a, b) => a.descriptor.id.localeCompare(b.descriptor.id));
	}

	async resolveRoutes(task: RevEngineeringTask, options: IRevEngineeringRouteOptions = {}): Promise<readonly IRevEngineeringRoute[]> {
		const minimumContextWindow = Math.max(0, options.minimumContextWindow ?? 0);
		const excludedProviderIds = new Set(options.excludedProviderIds ?? []);
		const excludedModelIds = new Set(options.excludedModelIds ?? []);
		const candidates: IRevEngineeringRoute[] = [];

		for (const provider of this.listProviders()) {
			if (excludedProviderIds.has(provider.descriptor.id)) {
				continue;
			}

			try {
				const availability = await provider.availability();
				if (!availability.available) {
					continue;
				}

				for (const model of await provider.models()) {
					if (model.providerId !== provider.descriptor.id || !model.tasks.includes(task)) {
						continue;
					}
					if (excludedModelIds.has(model.id)) {
						continue;
					}
					if (minimumContextWindow > 0 && (model.contextWindow === undefined || model.contextWindow < minimumContextWindow)) {
						continue;
					}
					if (options.requireToolCalling === true && model.supportsToolCalling !== true) {
						continue;
					}
					if (options.requireStreaming === true && model.supportsStreaming !== true) {
						continue;
					}
					if (options.requireVision === true && model.supportsVision !== true) {
						continue;
					}
					candidates.push({ provider, model });
				}
			} catch {
				// A broken engineering provider must not prevent another provider
				// from serving the task.
				continue;
			}
		}

		candidates.sort((a, b) => {
			const priorityDelta = (b.model.priority ?? 0) - (a.model.priority ?? 0);
			if (priorityDelta !== 0) {
				return priorityDelta;
			}
			const contextKnowledgeDelta = Number(b.model.contextWindow !== undefined) - Number(a.model.contextWindow !== undefined);
			if (minimumContextWindow > 0 && contextKnowledgeDelta !== 0) {
				return contextKnowledgeDelta;
			}
			const providerDelta = a.provider.descriptor.id.localeCompare(b.provider.descriptor.id);
			if (providerDelta !== 0) {
				return providerDelta;
			}
			return a.model.id.localeCompare(b.model.id);
		});

		return candidates;
	}

	async resolveRoute(task: RevEngineeringTask, options?: IRevEngineeringRouteOptions): Promise<IRevEngineeringRoute> {
		const route = (await this.resolveRoutes(task, options))[0];
		if (!route) {
			throw new Error(`No Rev engineering model is available for task: ${task}.`);
		}
		return route;
	}
}
