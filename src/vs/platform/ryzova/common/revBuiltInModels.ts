/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech.
 *  SPDX-License-Identifier: GPL-3.0-only
 *  See LICENSE in the project root for license information.
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

export interface IRevBuiltInModelRoutingOptions {
	readonly minimumContextLength?: number;
	readonly preferCached?: boolean;
	readonly preferLoaded?: boolean;
	readonly limit?: number;
}

export interface IRevBuiltInModelCandidate {
	readonly model: IRevBuiltInCatalogModel;
	readonly score: number;
	readonly preferenceRank: number | undefined;
	readonly reasons: readonly string[];
}

export const REV_BUILT_IN_MODEL_PREFERENCES: readonly IRevBuiltInModelPreference[] = [
	{
		task: 'assistant',
		preferredAliases: ['qwen3.5-0.8b', 'qwen2.5-1.5b', 'phi-3.5-mini', 'qwen2.5-0.5b'],
		fallbackToCompatibleTextModel: true,
	},
	{
		task: 'reasoning',
		preferredAliases: ['qwen3.5-4b', 'phi-4-mini-reasoning', 'deepseek-r1-7b', 'qwen3.5-0.8b', 'phi-3.5-mini', 'qwen2.5-1.5b'],
		fallbackToCompatibleTextModel: true,
	},
	{
		task: 'code-helper',
		preferredAliases: ['qwen2.5-coder-1.5b', 'qwen3.5-4b', 'qwen2.5-coder-7b', 'qwen2.5-coder-0.5b', 'qwen3.5-0.8b', 'qwen2.5-1.5b'],
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

export function isCompatibleTextChatModel(model: IRevBuiltInCatalogModel): boolean {
	const inputOk = !model.inputModalities?.length || model.inputModalities.some(modality => modality.toLowerCase() === 'text');
	const outputOk = !model.outputModalities?.length || model.outputModalities.some(modality => modality.toLowerCase() === 'text');
	const capabilities = model.capabilities?.map(capability => capability.toLowerCase());
	const capabilityOk = !capabilities?.length || capabilities.some(capability => capability === 'chat' || capability === 'completion');
	const task = model.catalogTask?.toLowerCase();
	const taskOk = !task || !/(audio|speech|transcription|embedding)/.test(task);
	return inputOk && outputOk && capabilityOk && taskOk;
}

/**
 * Foundry model aliases can be exposed as either the short family alias
 * (`qwen3.5-0.8b`) or a concrete variant
 * (`qwen3.5-0.8b-generic-cpu`). Treat both as the same preference family.
 */
export function revModelAliasMatches(alias: string, preferredAlias: string): boolean {
	const candidate = alias.trim().toLowerCase();
	const preferred = preferredAlias.trim().toLowerCase();
	return candidate === preferred || candidate.startsWith(`${preferred}-`);
}

function preferenceRank(alias: string, preferredAliases: readonly string[]): number | undefined {
	for (let index = 0; index < preferredAliases.length; index++) {
		if (revModelAliasMatches(alias, preferredAliases[index])) {
			return index;
		}
	}
	return undefined;
}

function isEligibleForTask(task: RevIntelligenceTask, model: IRevBuiltInCatalogModel): boolean {
	if (task === 'vision') {
		return revModelSupportsVision(model);
	}
	return isCompatibleTextChatModel(model);
}

/**
 * Rank every compatible local model for a Rev intelligence task.
 *
 * The explicit family preference remains the strongest signal, while already
 * loaded/cached models and sufficient context improve ordering within the same
 * family or among compatible fallbacks. The result is deterministic so routing
 * does not change because a catalog happens to return models in a different order.
 */
export function rankRevBuiltInModels(
	task: RevIntelligenceTask,
	models: readonly IRevBuiltInCatalogModel[],
	options: IRevBuiltInModelRoutingOptions = {},
): readonly IRevBuiltInModelCandidate[] {
	const preference = revBuiltInModelPreference(task);
	const minimumContextLength = Math.max(0, options.minimumContextLength ?? 0);
	const preferCached = options.preferCached !== false;
	const preferLoaded = options.preferLoaded !== false;

	const candidates: IRevBuiltInModelCandidate[] = [];
	for (const model of models) {
		if (!isEligibleForTask(task, model)) {
			continue;
		}
		if (minimumContextLength > 0 && model.contextLength !== undefined && model.contextLength < minimumContextLength) {
			continue;
		}

		const rank = preferenceRank(model.alias, preference.preferredAliases);
		if (rank === undefined && !preference.fallbackToCompatibleTextModel && !preference.requireVision) {
			continue;
		}

		let score = rank === undefined ? 10_000 : 100_000 - (rank * 5_000);
		const reasons: string[] = [];
		if (rank !== undefined) {
			reasons.push(`preferred-family:${preference.preferredAliases[rank]}`);
		} else {
			reasons.push('compatible-fallback');
		}

		if (preferLoaded && model.isLoaded) {
			score += 800;
			reasons.push('already-loaded');
		}
		if (preferCached && model.isCached) {
			score += 400;
			reasons.push('already-cached');
		}
		if (minimumContextLength > 0) {
			if (model.contextLength === undefined) {
				score -= 100;
				reasons.push('context-unknown');
			} else {
				score += Math.min(300, Math.floor((model.contextLength - minimumContextLength) / 1024));
				reasons.push('context-sufficient');
			}
		}
		if (task === 'code-helper' && model.supportsToolCalling) {
			score += 50;
			reasons.push('tool-capable');
		}

		candidates.push({ model, score, preferenceRank: rank, reasons });
	}

	candidates.sort((a, b) => {
		const scoreDelta = b.score - a.score;
		if (scoreDelta !== 0) {
			return scoreDelta;
		}
		const aliasDelta = a.model.alias.localeCompare(b.model.alias);
		return aliasDelta !== 0 ? aliasDelta : a.model.id.localeCompare(b.model.id);
	});

	const limit = options.limit === undefined ? candidates.length : Math.max(0, options.limit);
	return candidates.slice(0, limit);
}

/** Return the highest-ranked compatible local model for a Rev intelligence task. */
export function selectRevBuiltInModel(
	task: RevIntelligenceTask,
	models: readonly IRevBuiltInCatalogModel[],
	options?: IRevBuiltInModelRoutingOptions,
): IRevBuiltInCatalogModel | undefined {
	return rankRevBuiltInModels(task, models, { ...options, limit: 1 })[0]?.model;
}
