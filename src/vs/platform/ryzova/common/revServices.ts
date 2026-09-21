/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech.
 *  SPDX-License-Identifier: GPL-3.0-only
 *  See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { IRevAssistantService, RevAssistantService } from './revAssistantService.js';
import { IRevCoreService, RevCoreService } from './revCoreService.js';
import { IRevIntelligenceRegistryService, RevIntelligenceRegistryService } from './revIntelligenceRegistry.js';
import { IRevToolRegistryService, RevToolRegistryService } from './revTools.js';

registerSingleton(IRevCoreService, RevCoreService, InstantiationType.Delayed);
registerSingleton(IRevToolRegistryService, RevToolRegistryService, InstantiationType.Delayed);
registerSingleton(IRevIntelligenceRegistryService, RevIntelligenceRegistryService, InstantiationType.Delayed);
registerSingleton(IRevAssistantService, RevAssistantService, InstantiationType.Delayed);
