/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech.
 *  SPDX-License-Identifier: GPL-3.0-only
 *  See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IRevAssistantConversation } from '../../../../platform/ryzova/common/revAssistant.js';
import { IRevAssistantService } from '../../../../platform/ryzova/common/revAssistantService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';

const REV_ASSISTANT_MEMORY_KEY = 'ryzova.revAssistant.localMemory.v1';
const MAX_CONVERSATIONS = 4;
const MAX_MESSAGES_PER_CONVERSATION = 60;
const MAX_TOTAL_CONTENT_CHARS = 512_000;

interface IRevAssistantPersistedMemory {
	readonly version: 1;
	readonly conversations: readonly IRevAssistantConversation[];
}

/**
 * Persists Rev Assistant conversation state locally for the current workspace.
 *
 * StorageTarget.MACHINE is deliberate: automatic project-aware conversation
 * content must not sync to another device or account behind the user's back.
 */
class RevAssistantMemoryContribution extends Disposable implements IWorkbenchContribution {

	constructor(
		@IRevAssistantService private readonly assistantService: IRevAssistantService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();

		this.restore();
		this._register(this.assistantService.onDidChangeConversation(() => this.save()));
		this._register(this.assistantService.onDidDeleteConversation(() => this.save()));
		this._register(this.storageService.onWillSaveState(() => this.save()));
	}

	private restore(): void {
		const raw = this.storageService.get(REV_ASSISTANT_MEMORY_KEY, StorageScope.WORKSPACE);
		if (!raw) {
			return;
		}

		try {
			const parsed = JSON.parse(raw) as Partial<IRevAssistantPersistedMemory>;
			if (parsed.version !== 1 || !Array.isArray(parsed.conversations)) {
				return;
			}

			for (const conversation of parsed.conversations.slice(0, MAX_CONVERSATIONS)) {
				try {
					this.assistantService.restoreConversation(conversation);
				} catch {
					// Corrupt or obsolete local memory must never block workbench startup.
				}
			}
		} catch {
			// Ignore malformed local JSON and replace it on the next successful save.
		}
	}

	private save(): void {
		const conversations = this.createBoundedSnapshot(this.assistantService.listConversations());
		if (!conversations.length) {
			this.storageService.remove(REV_ASSISTANT_MEMORY_KEY, StorageScope.WORKSPACE);
			return;
		}

		const persisted: IRevAssistantPersistedMemory = { version: 1, conversations };
		this.storageService.store(
			REV_ASSISTANT_MEMORY_KEY,
			JSON.stringify(persisted),
			StorageScope.WORKSPACE,
			StorageTarget.MACHINE,
		);
	}

	private createBoundedSnapshot(conversations: readonly IRevAssistantConversation[]): IRevAssistantConversation[] {
		let remainingChars = MAX_TOTAL_CONTENT_CHARS;
		const result: IRevAssistantConversation[] = [];

		for (const conversation of conversations.slice(0, MAX_CONVERSATIONS)) {
			const candidateMessages = conversation.messages.slice(-MAX_MESSAGES_PER_CONVERSATION);
			const selected = [];
			for (let index = candidateMessages.length - 1; index >= 0; index--) {
				const message = candidateMessages[index];
				if (message.content.length > remainingChars) {
					continue;
				}
				selected.push({ ...message });
				remainingChars -= message.content.length;
			}
			selected.reverse();

			result.push({
				id: conversation.id,
				createdAt: conversation.createdAt,
				updatedAt: conversation.updatedAt,
				messages: selected,
			});
			if (remainingChars <= 0) {
				break;
			}
		}

		return result;
	}
}

registerWorkbenchContribution2(
	'workbench.contrib.ryzova.revAssistantMemory',
	RevAssistantMemoryContribution,
	WorkbenchPhase.BlockRestore,
);
