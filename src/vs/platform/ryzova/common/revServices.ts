/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { IRevCoreService, RevCoreService } from './revCoreService.js';
import { IRevToolRegistryService, RevToolRegistryService } from './revTools.js';

registerSingleton(IRevCoreService, RevCoreService, InstantiationType.Delayed);
registerSingleton(IRevToolRegistryService, RevToolRegistryService, InstantiationType.Delayed);
