/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech.
 *  SPDX-License-Identifier: GPL-3.0-only
 *  See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IRevBuiltInCatalogModel } from './revBuiltInModels.js';
import { IRevIntelligenceMessage, IRevIntelligenceResponse, RevIntelligenceStreamEvent, RevIntelligenceTask } from './revIntelligence.js';

export const revBuiltInModelRuntimeChannelName = 'revBuiltInModelRuntime';

export type RevBuiltInRuntimeState =
	| 'idle'
	| 'discovering'
	| 'downloading'
	| 'loading'
	| 'ready'
	| 'generating'
	| 'error';

export interface IRevBuiltInRuntimeStatus {
	readonly state: RevBuiltInRuntimeState;
	readonly supported: boolean;
	readonly activeModelAlias?: string;
	readonly progress?: number;
	readonly message?: string;
}

export interface IRevBuiltInRuntimeRequest {
	readonly requestId: string;
	readonly task: RevIntelligenceTask;
	readonly modelAlias: string;
	readonly messages: readonly IRevIntelligenceMessage[];
	readonly allowCodeAuthoring: boolean;
	readonly imageReferences?: readonly string[];
}

export interface IRevBuiltInModelRuntimeService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeStatus: Event<IRevBuiltInRuntimeStatus>;
	readonly onDidStreamEvent: Event<RevIntelligenceStreamEvent>;

	getStatus(): Promise<IRevBuiltInRuntimeStatus>;
	listModels(): Promise<readonly IRevBuiltInCatalogModel[]>;
	prepareModel(modelAlias: string): Promise<IRevBuiltInCatalogModel>;
	generate(request: IRevBuiltInRuntimeRequest): Promise<IRevIntelligenceResponse>;
	stream(request: IRevBuiltInRuntimeRequest): Promise<IRevIntelligenceResponse>;
	cancel(requestId: string): Promise<void>;
	unload(modelAlias?: string): Promise<void>;
}

export const IRevBuiltInModelRuntimeService = createDecorator<IRevBuiltInModelRuntimeService>('revBuiltInModelRuntimeService');
