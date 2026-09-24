/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech.
 *  SPDX-License-Identifier: GPL-3.0-only
 *  See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';
import { RevCapability } from './revPermissions.js';

export interface IRevToolExecutionContext {
	readonly executionId: string;
	readonly toolCallId: string;
	readonly projectId?: string;
	readonly signal: AbortSignal;
}

export interface IRevToolDefinition {
	readonly id: string;
	readonly description: string;
	readonly capabilities: readonly RevCapability[];
	execute(input: unknown, context: IRevToolExecutionContext): Promise<unknown>;
}

export const IRevToolRegistryService = createDecorator<IRevToolRegistryService>('revToolRegistryService');

export interface IRevToolRegistryService {
	readonly _serviceBrand: undefined;

	register(tool: IRevToolDefinition): void;
	unregister(id: string): boolean;
	get(id: string): IRevToolDefinition | undefined;
	has(id: string): boolean;
	list(): readonly IRevToolDefinition[];
}

export class RevToolRegistryService implements IRevToolRegistryService {
	declare readonly _serviceBrand: undefined;

	private readonly tools = new Map<string, IRevToolDefinition>();

	register(tool: IRevToolDefinition): void {
		const id = tool.id.trim();
		if (!id) {
			throw new Error('Rev tool ID must not be empty.');
		}
		if (this.tools.has(id)) {
			throw new Error(`Rev tool already registered: ${id}`);
		}
		this.tools.set(id, id === tool.id ? tool : { ...tool, id });
	}

	unregister(id: string): boolean {
		return this.tools.delete(id.trim());
	}

	get(id: string): IRevToolDefinition | undefined {
		return this.tools.get(id.trim());
	}

	has(id: string): boolean {
		return this.tools.has(id.trim());
	}

	list(): readonly IRevToolDefinition[] {
		return [...this.tools.values()].sort((a, b) => a.id.localeCompare(b.id));
	}
}
