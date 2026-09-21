/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech.
 *  SPDX-License-Identifier: GPL-3.0-only
 *  See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { createRevExecutionSnapshot, IRevExecutionSnapshot, RevExecutionState, transitionRevExecution } from './revExecution.js';
import { IRevProjectSnapshot } from './revProject.js';

export type RevCorePhase = 'idle' | 'project-ready' | 'executing' | 'error';

export interface IRevCoreSnapshot {
	readonly phase: RevCorePhase;
	readonly project?: IRevProjectSnapshot;
	readonly execution?: IRevExecutionSnapshot;
	readonly errorMessage?: string;
}

export const IRevCoreService = createDecorator<IRevCoreService>('revCoreService');

export interface IRevCoreService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeState: Event<IRevCoreSnapshot>;
	readonly snapshot: IRevCoreSnapshot;

	setProject(project: IRevProjectSnapshot): void;
	clearProject(): void;
	beginExecution(id: string, request: string): IRevExecutionSnapshot;
	transitionExecution(nextState: RevExecutionState, failureMessage?: string): IRevExecutionSnapshot;
	setError(message: string): void;
	reset(): void;
}

export class RevCoreService extends Disposable implements IRevCoreService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeState = this._register(new Emitter<IRevCoreSnapshot>());
	readonly onDidChangeState = this._onDidChangeState.event;

	private _snapshot: IRevCoreSnapshot = { phase: 'idle' };

	get snapshot(): IRevCoreSnapshot {
		return this._snapshot;
	}

	setProject(project: IRevProjectSnapshot): void {
		this.update({
			phase: 'project-ready',
			project,
		});
	}

	clearProject(): void {
		this.update({ phase: 'idle' });
	}

	beginExecution(id: string, request: string): IRevExecutionSnapshot {
		const execution = createRevExecutionSnapshot(id, request);
		this.update({
			phase: 'executing',
			...(this._snapshot.project === undefined ? {} : { project: this._snapshot.project }),
			execution,
		});
		return execution;
	}

	transitionExecution(nextState: RevExecutionState, failureMessage?: string): IRevExecutionSnapshot {
		const current = this._snapshot.execution;
		if (!current) {
			throw new Error('Cannot transition Rev execution because no execution is active.');
		}

		const execution = transitionRevExecution(current, nextState, Date.now(), failureMessage);
		const terminal = nextState === 'completed' || nextState === 'failed' || nextState === 'cancelled';
		let phase: RevCorePhase = 'executing';
		if (nextState === 'failed') {
			phase = 'error';
		} else if (terminal) {
			phase = this._snapshot.project ? 'project-ready' : 'idle';
		}

		this.update({
			phase,
			...(this._snapshot.project === undefined ? {} : { project: this._snapshot.project }),
			execution,
			...(failureMessage === undefined ? {} : { errorMessage: failureMessage }),
		});
		return execution;
	}

	setError(message: string): void {
		this.update({
			...this._snapshot,
			phase: 'error',
			errorMessage: message,
		});
	}

	reset(): void {
		this.update({
			phase: this._snapshot.project ? 'project-ready' : 'idle',
			...(this._snapshot.project === undefined ? {} : { project: this._snapshot.project }),
		});
	}

	private update(snapshot: IRevCoreSnapshot): void {
		this._snapshot = snapshot;
		this._onDidChangeState.fire(snapshot);
	}
}
