/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type RevContextKind =
	| 'instruction'
	| 'project'
	| 'file'
	| 'selection'
	| 'symbol'
	| 'diagnostic'
	| 'terminal'
	| 'git'
	| 'memory'
	| 'tool-result';

export interface IRevContextCandidate {
	readonly id: string;
	readonly kind: RevContextKind;
	readonly estimatedTokens: number;
	readonly priority: number;
	readonly required?: boolean;
}

export interface IRevContextBudget {
	readonly maxTokens: number;
	readonly reservedOutputTokens: number;
}

export interface IRevContextSelection {
	readonly selected: readonly IRevContextCandidate[];
	readonly rejected: readonly IRevContextCandidate[];
	readonly usedTokens: number;
	readonly availableTokens: number;
	readonly overBudget: boolean;
}

export function getRevContextAvailableTokens(budget: IRevContextBudget): number {
	return Math.max(0, budget.maxTokens - budget.reservedOutputTokens);
}

export function selectRevContext(candidates: readonly IRevContextCandidate[], budget: IRevContextBudget): IRevContextSelection {
	const availableTokens = getRevContextAvailableTokens(budget);
	const ordered = [...candidates].sort((a, b) => {
		if (Boolean(a.required) !== Boolean(b.required)) {
			return a.required ? -1 : 1;
		}
		if (a.priority !== b.priority) {
			return b.priority - a.priority;
		}
		return a.id.localeCompare(b.id);
	});

	const selected: IRevContextCandidate[] = [];
	const rejected: IRevContextCandidate[] = [];
	let usedTokens = 0;

	for (const candidate of ordered) {
		const tokenCost = Math.max(0, candidate.estimatedTokens);
		if (candidate.required || usedTokens + tokenCost <= availableTokens) {
			selected.push(candidate);
			usedTokens += tokenCost;
		} else {
			rejected.push(candidate);
		}
	}

	return {
		selected,
		rejected,
		usedTokens,
		availableTokens,
		overBudget: usedTokens > availableTokens,
	};
}
