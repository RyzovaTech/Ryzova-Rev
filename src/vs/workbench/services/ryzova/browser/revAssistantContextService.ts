/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech.
 *  SPDX-License-Identifier: GPL-3.0-only
 *  See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { extUri } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IMarker, IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import {
	buildRevAssistantContextSnapshot,
	createRevAssistantContextContribution,
	IRevAssistantContextBuildRequest,
	IRevAssistantContextContribution,
	IRevAssistantContextService,
	IRevAssistantContextSnapshot,
} from '../../../../platform/ryzova/common/revAssistantContext.js';
import { IRevCoreService } from '../../../../platform/ryzova/common/revCoreService.js';
import { IRevProjectSnapshot, RevProjectSourceKind } from '../../../../platform/ryzova/common/revProject.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ISCMRepository, ISCMService } from '../../../contrib/scm/common/scm.js';
import { IEditorService } from '../../editor/common/editorService.js';
import { IWorkingCopyService } from '../../workingCopy/common/workingCopyService.js';

const MAX_SELECTION_CHARS = 12_000;
const MAX_ACTIVE_FILE_CHARS = 16_000;
const MAX_RELATED_FILE_CHARS = 8_000;
const MAX_RELATED_FILES = 3;
const MAX_STRUCTURE_ENTRIES_PER_ROOT = 40;
const MAX_DIAGNOSTICS = 40;

/**
 * Workbench bridge between Code - OSS project state and Rev's bounded assistant
 * context contracts. It observes existing platform services; it does not create a
 * second editor/workspace/Git state model.
 */
export class RevAssistantContextWorkbenchService extends Disposable implements IRevAssistantContextService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IEditorService private readonly editorService: IEditorService,
		@ICodeEditorService private readonly codeEditorService: ICodeEditorService,
		@IMarkerService private readonly markerService: IMarkerService,
		@ISCMService private readonly scmService: ISCMService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
		@IFileService private readonly fileService: IFileService,
		@IRevCoreService private readonly revCoreService: IRevCoreService,
	) {
		super();

		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this.refreshProjectSnapshot()));
		this._register(this.workspaceContextService.onDidChangeWorkspaceName(() => this.refreshProjectSnapshot()));
		this._register(this.editorService.onDidActiveEditorChange(() => this.refreshProjectSnapshot()));
		this._register(this.workingCopyService.onDidChangeDirty(() => this.refreshProjectSnapshot()));
		this._register(this.scmService.onDidAddRepository(() => this.refreshProjectSnapshot()));
		this._register(this.scmService.onDidRemoveRepository(() => this.refreshProjectSnapshot()));

		this.refreshProjectSnapshot();
	}

	async buildContext(request: IRevAssistantContextBuildRequest): Promise<IRevAssistantContextSnapshot> {
		const project = this.refreshProjectSnapshot();

		// Automatic workspace data must never cross a provider boundary unless the
		// caller has explicitly classified that route as safe for project contents.
		if (!request.includeWorkspaceContents || !project) {
			return buildRevAssistantContextSnapshot(project, [], request);
		}

		const contributions: IRevAssistantContextContribution[] = [];
		contributions.push(this.createProjectContribution(project));

		const activeEditor = this.codeEditorService.getActiveCodeEditor();
		const activeModel = activeEditor?.getModel() ?? undefined;
		const activeSelection = activeEditor?.getSelection() ?? undefined;

		if (activeModel) {
			if (activeSelection && !activeSelection.isEmpty()) {
				const selectedText = truncate(activeModel.getValueInRange(activeSelection), MAX_SELECTION_CHARS);
				if (selectedText.trim()) {
					contributions.push(createRevAssistantContextContribution(
						'active-selection',
						'selection',
						'Current editor selection',
						[
							`File: ${this.displayResource(activeModel.uri)}`,
							`Range: ${activeSelection.startLineNumber}:${activeSelection.startColumn}-${activeSelection.endLineNumber}:${activeSelection.endColumn}`,
							'Selected text:',
							selectedText,
						].join('\n'),
						120,
					));
				}
			}

			const centerLine = activeSelection?.positionLineNumber ?? activeEditor?.getPosition()?.lineNumber ?? 1;
			contributions.push(createRevAssistantContextContribution(
				'active-file',
				'file',
				'Active editor excerpt',
				[
					`File: ${this.displayResource(activeModel.uri)}`,
					`Language: ${activeModel.getLanguageId()}`,
					'Nearby source:',
					this.modelExcerpt(activeModel, centerLine, MAX_ACTIVE_FILE_CHARS),
				].join('\n'),
				110,
			));
		}

		const diagnostics = this.createDiagnosticsContribution(activeModel?.uri);
		if (diagnostics) {
			contributions.push(diagnostics);
		}

		const git = this.createGitContribution();
		if (git) {
			contributions.push(git);
		}

		const structure = await this.createProjectStructureContribution(project);
		if (structure) {
			contributions.push(structure);
		}

		contributions.push(...this.createRelatedOpenFileContributions(request.prompt, activeModel?.uri));

		return buildRevAssistantContextSnapshot(project, contributions, request);
	}

	private refreshProjectSnapshot(): IRevProjectSnapshot | undefined {
		const workspace = this.workspaceContextService.getWorkspace();
		const roots = workspace.folders.map(folder => ({ uri: folder.uri, name: folder.name }));
		const activeResource = this.codeEditorService.getActiveCodeEditor()?.getModel()?.uri;
		const gitRepositories = this.getGitRepositories();

		if (!roots.length && !activeResource) {
			this.revCoreService.clearProject();
			return undefined;
		}

		let sourceKind: RevProjectSourceKind = 'local';
		if (roots.some(root => root.uri.scheme !== 'file')) {
			sourceKind = 'remote';
		} else if (gitRepositories.length) {
			sourceKind = 'git';
		}

		const project: IRevProjectSnapshot = {
			id: workspace.id,
			name: workspace.name ?? roots[0]?.name ?? 'Untitled Project',
			sourceKind,
			roots,
			...(activeResource === undefined ? {} : { activeResource }),
			gitRepositoryCount: gitRepositories.length,
			hasDirtyWorkingCopies: this.workingCopyService.hasDirty,
			capturedAt: Date.now(),
		};
		this.revCoreService.setProject(project);
		return project;
	}

	private createProjectContribution(project: IRevProjectSnapshot): IRevAssistantContextContribution {
		return createRevAssistantContextContribution(
			'project-summary',
			'project',
			'Project snapshot',
			[
				`Project: ${project.name || '(unnamed)'}`,
				`Source: ${project.sourceKind}`,
				`Workspace roots: ${project.roots.length}`,
				...project.roots.map(root => `- ${root.name} [${root.uri.scheme}]`),
				`Git repositories: ${project.gitRepositoryCount}`,
				`Dirty working copies: ${project.hasDirtyWorkingCopies ? 'yes' : 'no'}`,
				...(project.activeResource ? [`Active resource: ${this.displayResource(project.activeResource)}`] : []),
			].join('\n'),
			100,
		);
	}

	private createDiagnosticsContribution(activeResource: URI | undefined): IRevAssistantContextContribution | undefined {
		const severities = MarkerSeverity.Error | MarkerSeverity.Warning;
		const markers: IMarker[] = [];

		if (activeResource) {
			markers.push(...this.markerService.read({ resource: activeResource, severities, take: 25 }));
		}

		if (markers.length < MAX_DIAGNOSTICS) {
			const activeKey = activeResource?.toString();
			for (const marker of this.markerService.read({ severities, take: 100 })) {
				if (markers.length >= MAX_DIAGNOSTICS) {
					break;
				}
				if (marker.resource.toString() === activeKey || !this.workspaceContextService.isInsideWorkspace(marker.resource)) {
					continue;
				}
				markers.push(marker);
			}
		}

		if (!markers.length) {
			return undefined;
		}

		return createRevAssistantContextContribution(
			'diagnostics',
			'diagnostic',
			'Current project diagnostics',
			markers.map(marker => {
				const severity = MarkerSeverity.toString(marker.severity) || 'Diagnostic';
				return `${this.displayResource(marker.resource)}:${marker.startLineNumber}:${marker.startColumn} [${severity}] ${marker.message}`;
			}).join('\n'),
			105,
		);
	}

	private createGitContribution(): IRevAssistantContextContribution | undefined {
		const repositories = this.getGitRepositories();
		if (!repositories.length) {
			return undefined;
		}

		const lines = repositories.slice(0, 10).map(repository => {
			const changeCount = repository.provider.groups.reduce((total, group) => total + group.resources.length, 0);
			const root = repository.provider.rootUri ? this.displayResource(repository.provider.rootUri) : '(workspace)';
			return `- ${repository.provider.label} @ ${root}: ${changeCount} changed resources`;
		});

		return createRevAssistantContextContribution(
			'git-summary',
			'git',
			'Git / source control summary',
			[`Repositories: ${repositories.length}`, ...lines].join('\n'),
			90,
		);
	}

	private async createProjectStructureContribution(project: IRevProjectSnapshot): Promise<IRevAssistantContextContribution | undefined> {
		const lines: string[] = [];

		for (const root of project.roots.slice(0, 6)) {
			try {
				const stat = await this.fileService.resolve(root.uri);
				const children = [...(stat.children ?? [])]
					.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name))
					.slice(0, MAX_STRUCTURE_ENTRIES_PER_ROOT);
				lines.push(`${root.name}/`);
				for (const child of children) {
					lines.push(`  ${child.isDirectory ? 'dir ' : 'file'} ${child.name}`);
				}
				if ((stat.children?.length ?? 0) > children.length) {
					lines.push(`  … ${(stat.children?.length ?? 0) - children.length} more entries`);
				}
			} catch {
				// An unavailable root must not block the assistant from using the
				// remaining context sources.
			}
		}

		if (!lines.length) {
			return undefined;
		}

		return createRevAssistantContextContribution(
			'project-structure',
			'project',
			'Top-level project structure',
			lines.join('\n'),
			80,
		);
	}

	private createRelatedOpenFileContributions(prompt: string, activeResource: URI | undefined): IRevAssistantContextContribution[] {
		const activeKey = activeResource?.toString();
		const terms = [...new Set(prompt.toLowerCase().split(/[^a-z0-9_.$-]+/g).filter(term => term.length >= 3))].slice(0, 16);
		const candidates: Array<{ key: string; score: number; label: string; content: string }> = [];
		const seen = new Set<string>();

		for (const editor of this.codeEditorService.listCodeEditors()) {
			const model = editor.getModel();
			if (!model || !this.workspaceContextService.isInsideWorkspace(model.uri)) {
				continue;
			}
			const key = model.uri.toString();
			if (key === activeKey || seen.has(key)) {
				continue;
			}
			seen.add(key);

			const display = this.displayResource(model.uri);
			const centerLine = editor.getPosition()?.lineNumber ?? 1;
			const excerpt = this.modelExcerpt(model, centerLine, MAX_RELATED_FILE_CHARS);
			const haystack = `${display}\n${excerpt}`.toLowerCase();
			let score = 0;
			for (const term of terms) {
				if (display.toLowerCase().includes(term)) {
					score += 3;
				}
				if (haystack.includes(term)) {
					score += 1;
				}
			}

			candidates.push({
				key,
				score,
				label: `Open project file: ${display}`,
				content: [`File: ${display}`, `Language: ${model.getLanguageId()}`, 'Nearby source:', excerpt].join('\n'),
			});
		}

		return candidates
			.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
			.slice(0, MAX_RELATED_FILES)
			.map((candidate, index) => createRevAssistantContextContribution(
				`related-open-file-${index + 1}`,
				'file',
				candidate.label,
				candidate.content,
				70 + Math.min(20, candidate.score),
			));
	}

	private getGitRepositories(): ISCMRepository[] {
		return Array.from(this.scmService.repositories).filter(repository => {
			const providerIdentity = `${repository.provider.id} ${repository.provider.providerId}`.toLowerCase();
			return providerIdentity.split(/\s+/).includes('git') || providerIdentity.includes('git');
		});
	}

	private displayResource(resource: URI): string {
		const folder = this.workspaceContextService.getWorkspaceFolder(resource);
		if (folder) {
			const relative = extUri.relativePath(folder.uri, resource);
			return relative ? `${folder.name}/${relative}` : folder.name;
		}
		return resource.scheme === 'file' ? resource.path : resource.toString(true);
	}

	private modelExcerpt(model: ITextModel, centerLine: number, maxChars: number): string {
		const startLine = Math.max(1, centerLine - 80);
		const endLine = Math.min(model.getLineCount(), centerLine + 120);
		const lines: string[] = [];
		let length = 0;

		for (let line = startLine; line <= endLine; line++) {
			const text = `${line}: ${model.getLineContent(line)}`;
			if (length + text.length + 1 > maxChars) {
				lines.push('… excerpt truncated …');
				break;
			}
			lines.push(text);
			length += text.length + 1;
		}

		return lines.join('\n');
	}
}

function truncate(value: string, maxChars: number): string {
	if (value.length <= maxChars) {
		return value;
	}
	return `${value.slice(0, Math.max(0, maxChars - 23))}\n… content truncated …`;
}

registerSingleton(IRevAssistantContextService, RevAssistantContextWorkbenchService, InstantiationType.Delayed);
