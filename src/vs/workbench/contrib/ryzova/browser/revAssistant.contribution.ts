/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech.
 *  SPDX-License-Identifier: GPL-3.0-only
 *  See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { localize, localize2 } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { Extensions, IViewContainersRegistry, IViewDescriptorService, IViewsRegistry, ViewContainer, ViewContainerLocation } from '../../../common/views.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { RevAssistantView } from './revAssistantView.js';

export const REV_ASSISTANT_VIEW_CONTAINER_ID = 'workbench.view.ryzovaRevAssistant';

const revAssistantIcon = registerIcon(
	'ryzova-rev-assistant-view-icon',
	Codicon.lightbulbSparkleAutofix,
	localize('revAssistantViewIcon', 'View icon of Rev Assistant.'),
);

class RevAssistantViewPaneContainer extends ViewPaneContainer {
	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IExtensionService extensionService: IExtensionService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@ILogService logService: ILogService,
	) {
		super(
			REV_ASSISTANT_VIEW_CONTAINER_ID,
			{ mergeViewWithContainerWhenSingleView: true },
			instantiationService,
			configurationService,
			layoutService,
			contextMenuService,
			telemetryService,
			extensionService,
			themeService,
			storageService,
			contextService,
			viewDescriptorService,
			logService,
		);
	}

	override create(parent: HTMLElement): void {
		super.create(parent);
		parent.classList.add('rev-assistant-view-container');
	}
}

const viewContainerRegistry = Registry.as<IViewContainersRegistry>(Extensions.ViewContainersRegistry);

export const REV_ASSISTANT_VIEW_CONTAINER: ViewContainer = viewContainerRegistry.registerViewContainer({
	id: REV_ASSISTANT_VIEW_CONTAINER_ID,
	title: localize2('revAssistantContainer', 'Rev Assistant'),
	ctorDescriptor: new SyncDescriptor(RevAssistantViewPaneContainer),
	storageId: 'workbench.ryzovaRevAssistant.views.state',
	icon: revAssistantIcon,
	alwaysUseContainerInfo: true,
	hideIfEmpty: false,
	order: 6,
	openCommandActionDescriptor: {
		id: REV_ASSISTANT_VIEW_CONTAINER_ID,
		title: localize2('openRevAssistant', 'Rev Assistant'),
		order: 6,
	},
}, ViewContainerLocation.Sidebar);

Registry.as<IViewsRegistry>(Extensions.ViewsRegistry).registerViews([{
	id: RevAssistantView.ID,
	name: localize2('revAssistantView', 'Rev Assistant'),
	ctorDescriptor: new SyncDescriptor(RevAssistantView),
	containerIcon: revAssistantIcon,
	order: 1,
	canToggleVisibility: false,
	canMoveView: true,
	collapsed: false,
}], REV_ASSISTANT_VIEW_CONTAINER);
