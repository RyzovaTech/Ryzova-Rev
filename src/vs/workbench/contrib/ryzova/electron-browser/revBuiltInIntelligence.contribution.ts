/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech.
 *  SPDX-License-Identifier: GPL-3.0-only
 *  See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { RevBuiltInIntelligenceProvider } from '../../../../platform/ryzova/common/revBuiltInIntelligenceProvider.js';
import { IRevBuiltInModelRuntimeService } from '../../../../platform/ryzova/common/revBuiltInModelRuntime.js';
import { IRevIntelligenceRegistryService } from '../../../../platform/ryzova/common/revIntelligenceRegistry.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';

/**
 * Desktop lifetime owner for Rev's built-in local intelligence provider.
 */
class RevBuiltInIntelligenceContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@IRevBuiltInModelRuntimeService runtime: IRevBuiltInModelRuntimeService,
		@IRevIntelligenceRegistryService registry: IRevIntelligenceRegistryService,
	) {
		super();
		const provider = this._register(new RevBuiltInIntelligenceProvider(runtime));
		this._register(registry.registerProvider(provider));
	}
}

registerWorkbenchContribution2(
	'workbench.contrib.ryzova.revBuiltInIntelligence',
	RevBuiltInIntelligenceContribution,
	WorkbenchPhase.BlockRestore,
);
