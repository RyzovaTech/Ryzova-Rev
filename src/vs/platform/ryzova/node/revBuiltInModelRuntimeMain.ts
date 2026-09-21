/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech.
 *  SPDX-License-Identifier: GPL-3.0-only
 *  See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../base/common/lifecycle.js';
import { ProxyChannel } from '../../../base/parts/ipc/common/ipc.js';
import { Server as UtilityProcessServer } from '../../../base/parts/ipc/node/ipc.mp.js';
import { isUtilityProcess } from '../../../base/parts/sandbox/node/electronTypes.js';
import { revBuiltInModelRuntimeChannelName } from '../common/revBuiltInModelRuntime.js';
import { RevBuiltInModelRuntimeService } from './revBuiltInModelRuntimeService.js';

if (!isUtilityProcess(process)) {
	throw new Error('revBuiltInModelRuntimeMain must run in a utility process');
}

const server = new UtilityProcessServer();
const service = new RevBuiltInModelRuntimeService();
server.registerChannel(revBuiltInModelRuntimeChannelName, ProxyChannel.fromService(service, new DisposableStore()));
