/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech.
 *  SPDX-License-Identifier: GPL-3.0-only
 *  See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/revAssistant.css';

import { $, addDisposableListener, append, clearNode } from '../../../../base/browser/dom.js';
import { IRevAssistantConversation, RevAssistantIntent, RevAssistantStreamEvent } from '../../../../platform/ryzova/common/revAssistant.js';
import { IRevAssistantService } from '../../../../platform/ryzova/common/revAssistantService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../common/views.js';

const UI_INTENTS: ReadonlyArray<{ readonly value: RevAssistantIntent; readonly label: string }> = [
	{ value: 'guide', label: 'Guide' },
	{ value: 'explain', label: 'Explain' },
	{ value: 'plan', label: 'Plan' },
	{ value: 'diagnose', label: 'Diagnose' },
];

/**
 * First-party Rev Assistant workbench surface.
 *
 * Phase 5F deliberately exposes guidance/explanation/planning/diagnosis first.
 * Code authoring still requires the explicit per-request opt-in defined by the
 * platform service, and visual analysis remains hidden until the multimodal
 * runtime path is ready.
 */
export class RevAssistantView extends ViewPane {

	static readonly ID = 'workbench.views.ryzovaRevAssistant';

	private conversationId: string;
	private messagesElement!: HTMLElement;
	private statusElement!: HTMLElement;
	private inputElement!: HTMLTextAreaElement;
	private intentElement!: HTMLSelectElement;
	private sendButton!: HTMLButtonElement;
	private cancelButton!: HTMLButtonElement;
	private newChatButton!: HTMLButtonElement;

	private activeRequestId: string | undefined;
	private streamingText = '';
	private ownerDocument: Document | undefined;
	private disposed = false;

	constructor(
		options: IViewletViewOptions,
		@IThemeService themeService: IThemeService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IOpenerService openerService: IOpenerService,
		@IHoverService hoverService: IHoverService,
		@IRevAssistantService private readonly assistantService: IRevAssistantService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		this.conversationId = this.assistantService.createConversation().id;

		this._register(this.assistantService.onDidChangeConversation(conversation => {
			if (conversation.id === this.conversationId) {
				this.renderConversation(conversation);
			}
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		container.classList.add('rev-assistant-view');
		this.ownerDocument = container.ownerDocument;

		const shell = append(container, $('.rev-assistant-shell'));
		const toolbar = append(shell, $('.rev-assistant-toolbar'));

		this.intentElement = append(toolbar, this.ownerDocument.createElement('select'));
		this.intentElement.className = 'rev-assistant-intent';
		this.intentElement.setAttribute('aria-label', 'Rev Assistant mode');
		for (const intent of UI_INTENTS) {
			const option = this.ownerDocument.createElement('option');
			option.value = intent.value;
			option.textContent = intent.label;
			this.intentElement.appendChild(option);
		}

		this.newChatButton = append(toolbar, this.ownerDocument.createElement('button'));
		this.newChatButton.className = 'rev-assistant-button secondary';
		this.newChatButton.type = 'button';
		this.newChatButton.textContent = 'New chat';

		this.statusElement = append(shell, $('.rev-assistant-status'));
		this.statusElement.setAttribute('role', 'status');
		this.statusElement.textContent = 'Ready';

		this.messagesElement = append(shell, $('.rev-assistant-messages'));
		this.messagesElement.setAttribute('role', 'log');
		this.messagesElement.setAttribute('aria-live', 'polite');

		const composer = append(shell, $('.rev-assistant-composer'));
		this.inputElement = append(composer, this.ownerDocument.createElement('textarea'));
		this.inputElement.className = 'rev-assistant-input';
		this.inputElement.rows = 4;
		this.inputElement.placeholder = 'Ask Rev about this project…';
		this.inputElement.setAttribute('aria-label', 'Message Rev Assistant');

		const actions = append(composer, $('.rev-assistant-actions'));
		const hint = append(actions, $('.rev-assistant-shortcut'));
		hint.textContent = 'Ctrl/Cmd+Enter to send';

		const actionButtons = append(actions, $('.rev-assistant-action-buttons'));
		this.cancelButton = append(actionButtons, this.ownerDocument.createElement('button'));
		this.cancelButton.className = 'rev-assistant-button secondary';
		this.cancelButton.type = 'button';
		this.cancelButton.textContent = 'Cancel';

		this.sendButton = append(actionButtons, this.ownerDocument.createElement('button'));
		this.sendButton.className = 'rev-assistant-button primary';
		this.sendButton.type = 'button';
		this.sendButton.textContent = 'Send';

		this._register(addDisposableListener(this.sendButton, 'click', () => {
			void this.sendCurrentInput();
		}));
		this._register(addDisposableListener(this.cancelButton, 'click', () => {
			void this.cancelActiveRequest();
		}));
		this._register(addDisposableListener(this.newChatButton, 'click', () => {
			void this.startNewConversation();
		}));
		this._register(addDisposableListener(this.inputElement, 'keydown', (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
				event.preventDefault();
				void this.sendCurrentInput();
			}
		}));
		this._register(addDisposableListener(this.inputElement, 'input', () => this.updateControls()));

		const conversation = this.assistantService.getConversation(this.conversationId);
		if (conversation) {
			this.renderConversation(conversation);
		}
		this.updateControls();
	}

	override focus(): void {
		super.focus();
		this.inputElement?.focus();
	}

	private async sendCurrentInput(): Promise<void> {
		const content = this.inputElement.value.trim();
		if (!content || this.activeRequestId) {
			return;
		}

		this.streamingText = '';
		this.inputElement.value = '';
		this.statusElement.textContent = 'Thinking…';
		this.updateControls();

		const intent = this.intentElement.value as RevAssistantIntent;
		try {
			await this.assistantService.stream({
				conversationId: this.conversationId,
				content,
				intent,
			}, event => this.handleStreamEvent(event));
		} catch (error) {
			// The streaming lifecycle already reports cancellation and normalized
			// errors. This catch only covers validation or unexpected failures.
			if (this.activeRequestId) {
				this.statusElement.textContent = error instanceof Error ? error.message : String(error);
			}
		} finally {
			this.activeRequestId = undefined;
			this.streamingText = '';
			if (!this.disposed) {
				this.updateControls();
				this.inputElement.focus();
			}
		}
	}

	private handleStreamEvent(event: RevAssistantStreamEvent): void {
		if (this.disposed) {
			return;
		}
		switch (event.type) {
			case 'started':
				this.activeRequestId = event.requestId;
				this.statusElement.textContent = 'Thinking…';
				this.updateControls();
				break;
			case 'route':
				this.statusElement.textContent = `Working with ${event.modelId}…`;
				break;
			case 'token':
				this.streamingText += event.token;
				this.renderCurrentConversation();
				break;
			case 'completed':
				this.statusElement.textContent = 'Ready';
				this.streamingText = '';
				this.renderConversation(event.reply.conversation);
				break;
			case 'cancelled':
				this.statusElement.textContent = 'Cancelled';
				this.streamingText = '';
				this.renderCurrentConversation();
				break;
			case 'error':
				this.statusElement.textContent = event.message;
				this.streamingText = '';
				this.renderCurrentConversation();
				break;
		}
	}

	private async cancelActiveRequest(): Promise<void> {
		const requestId = this.activeRequestId;
		if (!requestId) {
			return;
		}
		this.statusElement.textContent = 'Cancelling…';
		await this.assistantService.cancel(requestId);
	}

	private async startNewConversation(): Promise<void> {
		if (this.activeRequestId) {
			await this.cancelActiveRequest();
		}

		const previousConversationId = this.conversationId;
		const conversation = this.assistantService.createConversation();
		this.conversationId = conversation.id;
		this.activeRequestId = undefined;
		this.streamingText = '';
		this.assistantService.deleteConversation(previousConversationId);
		this.statusElement.textContent = 'Ready';
		this.renderConversation(conversation);
		this.updateControls();
		this.inputElement.focus();
	}

	private renderCurrentConversation(): void {
		const conversation = this.assistantService.getConversation(this.conversationId);
		if (conversation) {
			this.renderConversation(conversation);
		}
	}

	private renderConversation(conversation: IRevAssistantConversation): void {
		if (!this.messagesElement) {
			return;
		}

		clearNode(this.messagesElement);

		if (!conversation.messages.length && !this.streamingText) {
			const empty = append(this.messagesElement, $('.rev-assistant-empty'));
			const title = append(empty, $('h3'));
			title.textContent = 'Rev Assistant';
			const copy = append(empty, $('p'));
			copy.textContent = 'Ask for guidance, explanations, project planning, or diagnosis. Project context stays local when Rev uses its built-in model.';
		}

		for (const message of conversation.messages) {
			this.appendMessage(message.role, message.content, false);
		}
		if (this.streamingText) {
			this.appendMessage('assistant', this.streamingText, true);
		}

		this.messagesElement.scrollTop = this.messagesElement.scrollHeight;
	}

	private appendMessage(role: 'user' | 'assistant', content: string, streaming: boolean): void {
		const message = append(this.messagesElement, $('.rev-assistant-message'));
		message.classList.add(role === 'user' ? 'user' : 'assistant');
		if (streaming) {
			message.classList.add('streaming');
		}

		const label = append(message, $('.rev-assistant-message-role'));
		label.textContent = role === 'user' ? 'You' : 'Rev';

		const body = append(message, $('.rev-assistant-message-body'));
		body.textContent = content;
	}

	private updateControls(): void {
		if (!this.sendButton || !this.cancelButton || !this.inputElement) {
			return;
		}
		const running = Boolean(this.activeRequestId);
		this.sendButton.disabled = running || !this.inputElement.value.trim();
		this.cancelButton.disabled = !running;
		this.newChatButton.disabled = running;
		this.intentElement.disabled = running;
	}

	override dispose(): void {
		this.disposed = true;
		const conversationId = this.conversationId;
		const requestId = this.activeRequestId;
		if (requestId) {
			void this.assistantService.cancel(requestId).then(() => {
				this.assistantService.deleteConversation(conversationId);
			}).catch(() => {
				// The service owns final cancellation cleanup.
			});
		} else {
			this.assistantService.deleteConversation(conversationId);
		}
		super.dispose();
	}
}
