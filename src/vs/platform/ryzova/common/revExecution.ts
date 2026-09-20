/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const revExecutionStates = [
	'understanding',
	'planning',
	'executing',
	'validating',
	'reviewing',
	'repairing',
	'completed',
	'failed',
	'cancelled',
] as const;

export type RevExecutionState = typeof revExecutionStates[number];
export type RevTerminalExecutionState = Extract<RevExecutionState, 'completed' | 'failed' | 'cancelled'>;

export interface IRevExecutionSnapshot {
	readonly id: string;
	readonly request: string;
	readonly state: RevExecutionState;
	readonly startedAt: number;
	readonly updatedAt: number;
	readonly cancellationRequested: boolean;
	readonly failureMessage?: string;
}

const revExecutionTransitions: Readonly<Record<RevExecutionState, readonly RevExecutionState[]>> = {
	understanding: ['planning', 'failed', 'cancelled'],
	planning: ['executing', 'completed', 'failed', 'cancelled'],
	executing: ['validating', 'failed', 'cancelled'],
	validating: ['reviewing', 'failed', 'cancelled'],
	reviewing: ['repairing', 'completed', 'failed', 'cancelled'],
	repairing: ['validating', 'failed', 'cancelled'],
	completed: [],
	failed: [],
	cancelled: [],
};

export function canTransitionRevExecution(from: RevExecutionState, to: RevExecutionState): boolean {
	return revExecutionTransitions[from].includes(to);
}

export function createRevExecutionSnapshot(id: string, request: string, now = Date.now()): IRevExecutionSnapshot {
	if (!id.trim()) {
		throw new Error('Rev execution ID must not be empty.');
	}
	if (!request.trim()) {
		throw new Error('Rev execution request must not be empty.');
	}
	return {
		id,
		request,
		state: 'understanding',
		startedAt: now,
		updatedAt: now,
		cancellationRequested: false,
	};
}

export function transitionRevExecution(snapshot: IRevExecutionSnapshot, nextState: RevExecutionState, now = Date.now(), failureMessage?: string): IRevExecutionSnapshot {
	if (!canTransitionRevExecution(snapshot.state, nextState)) {
		throw new Error(`Invalid Rev execution transition: ${snapshot.state} -> ${nextState}`);
	}

	return {
		...snapshot,
		state: nextState,
		updatedAt: now,
		cancellationRequested: snapshot.cancellationRequested || nextState === 'cancelled',
		...(failureMessage === undefined ? {} : { failureMessage }),
	};
}
