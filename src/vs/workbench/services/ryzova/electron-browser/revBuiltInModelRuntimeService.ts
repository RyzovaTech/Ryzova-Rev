/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { arch, platform } from '../../../../base/common/process.js';
import { getDelayedChannel, IChannel, ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import {
	IRevBuiltInModelRuntimeService,
	revBuiltInModelRuntimeChannelName,
} from '../../../../platform/ryzova/common/revBuiltInModelRuntime.js';
import { IUtilityProcessWorkerWorkbenchService } from '../../utilityProcess/electron-browser/utilityProcessWorkerWorkbenchService.js';

const SUPPORTED_TARGETS = new Set([
	'darwin-arm64',
	'linux-x64',
	'linux-arm64',
	'win32-x64',
	'win32-arm64',
]);

/**
 * Renderer-side proxy to Rev's Foundry Local utility process.
 *
 * Creating the service is cheap: the utility process and native model runtime
 * are spawned lazily on first real use.
 */
export class RevBuiltInModelRuntimeWorkbenchService implements IRevBuiltInModelRuntimeService {
	declare readonly _serviceBrand: undefined;

	private _channel: IChannel | undefined;
	private _proxy: IRevBuiltInModelRuntimeService | undefined;

	constructor(
		@IUtilityProcessWorkerWorkbenchService private readonly utilityProcessWorkerWorkbenchService: IUtilityProcessWorkerWorkbenchService,
	) { }

	get onDidChangeStatus() { return this.getProxy().onDidChangeStatus; }
	get onDidStreamEvent() { return this.getProxy().onDidStreamEvent; }

	async getStatus() {
		if (!this.isSupportedHost()) {
			return { state: 'idle' as const, supported: false };
		}
		return this.getProxy().getStatus();
	}

	async listModels() {
		if (!this.isSupportedHost()) {
			return [];
		}
		return this.getProxy().listModels();
	}

	prepareModel(modelAlias: string) { return this.getProxy().prepareModel(modelAlias); }
	generate(request: Parameters<IRevBuiltInModelRuntimeService['generate']>[0]) { return this.getProxy().generate(request); }
	stream(request: Parameters<IRevBuiltInModelRuntimeService['stream']>[0]) { return this.getProxy().stream(request); }
	cancel(requestId: string) { return this.getProxy().cancel(requestId); }
	unload(modelAlias?: string) { return this.getProxy().unload(modelAlias); }

	private getProxy(): IRevBuiltInModelRuntimeService {
		if (!this._proxy) {
			this._proxy = ProxyChannel.toService<IRevBuiltInModelRuntimeService>(this.getChannel(), { disableMarshalling: true });
		}
		return this._proxy;
	}

	private getChannel(): IChannel {
		if (!this._channel) {
			this._channel = getDelayedChannel((async () => {
				const { client } = await this.utilityProcessWorkerWorkbenchService.createWorker({
					moduleId: 'vs/platform/ryzova/node/revBuiltInModelRuntimeMain',
					type: 'revBuiltInModelRuntime',
					name: 'rev-built-in-intelligence',
					// Foundry Local loads a third-party native addon and runtime
					// libraries. macOS therefore needs the plugin helper boundary.
					allowLoadingUnsignedLibraries: true,
				});
				return client.getChannel(revBuiltInModelRuntimeChannelName);
			})());
		}
		return this._channel;
	}

	private isSupportedHost(): boolean {
		return !!platform && !!arch && SUPPORTED_TARGETS.has(`${platform}-${arch}`);
	}
}

registerSingleton(IRevBuiltInModelRuntimeService, RevBuiltInModelRuntimeWorkbenchService, InstantiationType.Delayed);
