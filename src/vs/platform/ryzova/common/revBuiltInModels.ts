/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RevIntelligenceTask } from './revIntelligence.js';

export interface IRevBuiltInCatalogModel {
	readonly id: string;
	readonly alias: string;
	readonly displayName?: string;
	readonly contextLength?: number;
	readonly maxOutputTokens?: number;
	readonly inputModalities?: readonly string[];
	readonly outputModalities?: readonly string[];
	readonly supportsToolCalling?: boolean;
	readonly capabilities?: readonly string[];
	readonly catalogTask?: string;
	readonly isCached?: boolean;
	readonly isLoaded?: boolean;
}

export interface IRevBuiltInModelPreference {
	readonly task: RevIntelligenceTask;
	readonly preferredAliases: readonly string[];
	readonly requireVision?: boolean;
	readonly fallbackToCompatibleTextModel?: boolean;
}

export const REV_BUILT_IN_MODEL_PREFERENCES: readonly IRevBuiltInModelPreference[] = [
	{
		task: 'assistant',
		preferredAliases: ['qwen3.5-2b-text', 'qwen3.5-0.8b', 'qwen2.5-1.5b', 'phi-3.5-mini', 'qwen2.5-0.5b'],
		fallbackToCompatibleTextModel: true,
	},
	{
		task: 'reasoning',
		preferredAliases: ['qwen3.5-4b', 'phi-4-mini-reasoning', 'deepseek-r1-7b', 'qwen3.5-2b-text', 'phi-3.5-mini', 'qwen2.5-1.5b'],
		fallbackToCompatibleTextModel: true,
	},
	{
		task: 'code-helper',
		preferredAliases: ['qwen2.5-coder-1.5b', 'qwen3.5-4b', 'qwen2.5-coder-7b', 'qwen2.5-coder-0.5b', 'qwen3.5-2b-text', 'qwen2.5-1.5b'],
		fallbackToCompatibleTextModel: true,
	},
	{
		task: 'vision',
		preferredAliases: ['qwen3.5-4b', 'qwen3.5-2b', 'qwen3.5-0.8b', 'qwen3-vl-4b-instruct', 'qwen3-vl-2b-instruct'],
		requireVision: true,
	},
];

export function revBuiltInModelPreference(task: RevIntelligenceTask): IRevBuiltInModelPreference {
	const preference = REV_BUILT_IN_MODEL_PREFERENCES.find(candidate => candidate.task === task);
	if (!preference) {
		throw new Error(`No Rev built-in model preference is defined for task: ${task}`);
	}
	return preference;
}

export function revModelSupportsVision(model: IRevBuiltInCatalogModel): boolean {
	return model.inputModalities?.some(modality => modality.toLowerCase() === 'image') === true;
}

/**
 * Select the most appropriate local model for a Rev intelligence task.
 *
 * Explicit aliases are ordered by preference. A cached model wins over an
 * uncached model only when both have the same alias preference. Vision falls
 * back to capability discovery so Rev can adopt newly-added Foundry Local
 * multimodal models without shipping a new hard-coded alias.
 */
export function selectRevBuiltInModel(
	task: RevIntelligenceTask,
	models: readonly IRevBuiltInCatalogModel[],
): IRevBuiltInCatalogModel | undefined {
	const preference = revBuiltInModelPreference(task);
	const eligible = models.filter(model => !preference.requireVision || revModelSupportsVision(model));
	if (!eligible.length) {
		return undefined;
	}

	if (preference.preferredAliases.length) {
		const ranked = eligible
			.map(model => ({
				model,
				aliasRank: preference.preferredAliases.indexOf(model.alias),
			}))
			.filter(candidate => candidate.aliasRank >= 0)
			.sort((a, b) => {
				if (a.aliasRank !== b.aliasRank) {
					return a.aliasRank - b.aliasRank;
				}
				const cachedDelta = Number(Boolean(b.model.isCached)) - Number(Boolean(a.model.isCached));
				if (cachedDelta !== 0) {
					return cachedDelta;
				}
				return a.model.id.localeCompare(b.model.id);
			});

		if (ranked.length) {
			return ranked[0].model;
		}
		if (!preference.fallbackToCompatibleTextModel && !preference.requireVision) {
			return undefined;
		}
	}

	const fallback = preference.requireVision
		? eligible
		: eligible.filter(isCompatibleTextChatModel);
	if (!fallback.length) {
		return undefined;
	}

	return [...fallback].sort((a, b) => {
		const cachedDelta = Number(Boolean(b.isCached)) - Number(Boolean(a.isCached));
		if (cachedDelta !== 0) {
			return cachedDelta;
		}
		const loadedDelta = Number(Boolean(b.isLoaded)) - Number(Boolean(a.isLoaded));
		if (loadedDelta !== 0) {
			return loadedDelta;
		}
		const contextDelta = (b.contextLength ?? 0) - (a.contextLength ?? 0);
		if (contextDelta !== 0) {
			return contextDelta;
		}
		return a.id.localeCompare(b.id);
	})[0];
}


export function isCompatibleTextChatModel(model: IRevBuiltInCatalogModel): boolean {
	const inputOk = !model.inputModalities?.length || model.inputModalities.some(modality => modality.toLowerCase() === 'text');
	const outputOk = !model.outputModalities?.length || model.outputModalities.some(modality => modality.toLowerCase() === 'text');
	const capabilities = model.capabilities?.map(capability => capability.toLowerCase());
	const capabilityOk = !capabilities?.length || capabilities.some(capability => capability === 'chat' || capability === 'completion');
	const task = model.catalogTask?.toLowerCase();
	const taskOk = !task || !/(audio|speech|transcription|embedding)/.test(task);
	return inputOk && outputOk && capabilityOk && taskOk;
}
