/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech.
 *  SPDX-License-Identifier: GPL-3.0-only
 *  See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';

export type RevProjectSourceKind = 'local' | 'git' | 'remote';

export interface IRevProjectRoot {
	readonly uri: URI;
	readonly name: string;
}

export interface IRevProjectSnapshot {
	readonly id: string;
	readonly name: string;
	readonly sourceKind: RevProjectSourceKind;
	readonly roots: readonly IRevProjectRoot[];
	readonly activeResource?: URI;
	readonly gitRepositoryCount: number;
	readonly hasDirtyWorkingCopies: boolean;
	readonly capturedAt: number;
}

export function createEmptyRevProjectSnapshot(now = Date.now()): IRevProjectSnapshot {
	return {
		id: 'empty',
		name: '',
		sourceKind: 'local',
		roots: [],
		gitRepositoryCount: 0,
		hasDirtyWorkingCopies: false,
		capturedAt: now,
	};
}
