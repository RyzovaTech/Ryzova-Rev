/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech.
 *  SPDX-License-Identifier: GPL-3.0-only
 *  See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type RevAssistantErrorCode =
	| 'cancelled'
	| 'busy'
	| 'no-route'
	| 'provider-failed'
	| 'stream-failed'
	| 'timeout'
	| 'all-routes-failed';

export class RevAssistantError extends Error {
	constructor(
		message: string,
		readonly code: RevAssistantErrorCode,
		readonly retryable: boolean,
		readonly detail?: unknown,
	) {
		super(message);
		this.name = 'RevAssistantError';
	}
}

export function isRevAssistantCancellationError(error: unknown): boolean {
	if (error instanceof RevAssistantError) {
		return error.code === 'cancelled';
	}
	if (!(error instanceof Error)) {
		return false;
	}
	const code = (error as Error & { code?: string }).code;
	return code === 'ERR_REV_CANCELLED'
		|| error.name === 'AbortError'
		|| /cancelled|canceled/i.test(error.message);
}

export function createRevAssistantCancelledError(message = 'Rev Assistant request was cancelled.'): RevAssistantError {
	return new RevAssistantError(message, 'cancelled', false);
}

export function toRevAssistantError(
	error: unknown,
	fallbackCode: RevAssistantErrorCode = 'provider-failed',
	retryable = true,
): RevAssistantError {
	if (error instanceof RevAssistantError) {
		return error;
	}
	if (isRevAssistantCancellationError(error)) {
		return createRevAssistantCancelledError(error instanceof Error ? error.message : undefined);
	}

	const message = error instanceof Error ? error.message : String(error);
	if (/timed out|timeout/i.test(message)) {
		return new RevAssistantError(message, 'timeout', true, error);
	}
	return new RevAssistantError(message || 'Rev Assistant request failed.', fallbackCode, retryable, error);
}
