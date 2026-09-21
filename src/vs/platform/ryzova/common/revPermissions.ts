/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech.
 *  SPDX-License-Identifier: GPL-3.0-only
 *  See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const revCapabilities = [
	'readWorkspace',
	'writeWorkspace',
	'runCommand',
	'gitWrite',
	'network',
	'openExternal',
	'manageExtensions',
] as const;

export type RevCapability = typeof revCapabilities[number];
export type RevPermissionDecision = 'allow' | 'ask' | 'deny';

export interface IRevPermissionRequest {
	readonly capability: RevCapability;
	readonly reason: string;
	readonly executionId?: string;
	readonly resource?: string;
}

export interface IRevPermissionEvaluation {
	readonly decision: RevPermissionDecision;
	readonly reason: string;
}

export interface IRevPermissionPolicy {
	evaluate(request: IRevPermissionRequest): IRevPermissionEvaluation;
}

export class RevDefaultPermissionPolicy implements IRevPermissionPolicy {
	evaluate(request: IRevPermissionRequest): IRevPermissionEvaluation {
		switch (request.capability) {
			case 'readWorkspace':
				return { decision: 'allow', reason: 'Workspace reads are allowed by the default Rev policy.' };
			case 'writeWorkspace':
			case 'gitWrite':
			case 'runCommand':
			case 'network':
			case 'openExternal':
			case 'manageExtensions':
				return { decision: 'ask', reason: `${request.capability} requires explicit approval by the default Rev policy.` };
		}
	}
}
