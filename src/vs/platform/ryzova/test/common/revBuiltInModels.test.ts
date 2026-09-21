/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech.
 *  SPDX-License-Identifier: GPL-3.0-only
 *  See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { revModelSupportsVision, selectRevBuiltInModel } from '../../common/revBuiltInModels.js';

suite('Ryzova Rev Built-in Model Selection', function () {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('assistant uses the highest preferred available alias', function () {
		const selected = selectRevBuiltInModel('assistant', [
			{ id: 'small', alias: 'qwen2.5-0.5b', isCached: true },
			{ id: 'preferred', alias: 'qwen2.5-1.5b', isCached: false },
			{ id: 'other', alias: 'unrelated-model', isCached: true },
		]);

		assert.strictEqual(selected?.id, 'preferred');
	});

	test('assistant prefers current Qwen 3.5 text model when available', function () {
		const selected = selectRevBuiltInModel('assistant', [
			{ id: 'old', alias: 'qwen2.5-1.5b', isCached: true },
			{ id: 'new', alias: 'qwen3.5-2b-text', isCached: false },
		]);

		assert.strictEqual(selected?.id, 'new');
	});

	test('reasoning prefers Qwen 3.5 4B when available', function () {
		const selected = selectRevBuiltInModel('reasoning', [
			{ id: 'phi', alias: 'phi-4-mini-reasoning', isCached: true },
			{ id: 'qwen', alias: 'qwen3.5-4b', isCached: false, inputModalities: ['text', 'image'], outputModalities: ['text'] },
		]);

		assert.strictEqual(selected?.id, 'qwen');
	});

	test('code helper stays on coding-model candidates', function () {
		const selected = selectRevBuiltInModel('code-helper', [
			{ id: 'general', alias: 'phi-3.5-mini', isCached: true },
			{ id: 'coder', alias: 'qwen2.5-coder-1.5b' },
		]);

		assert.strictEqual(selected?.id, 'coder');
	});

	test('vision discovers image-capable models dynamically', function () {
		const selected = selectRevBuiltInModel('vision', [
			{ id: 'text', alias: 'text-only', inputModalities: ['text'], isCached: true },
			{ id: 'vision', alias: 'future-vision-model', inputModalities: ['text', 'image'], contextLength: 32768 },
		]);

		assert.strictEqual(selected?.id, 'vision');
		assert.strictEqual(revModelSupportsVision(selected!), true);
	});

	test('falls back to another compatible text chat model', function () {
		const selected = selectRevBuiltInModel('assistant', [
			{ id: 'fallback', alias: 'future-small-chat', inputModalities: ['text'], outputModalities: ['text'], capabilities: ['chat'], isCached: true },
			{ id: 'audio', alias: 'whisper', inputModalities: ['audio'], outputModalities: ['text'], capabilities: ['transcription'], isCached: true },
		]);

		assert.strictEqual(selected?.id, 'fallback');
	});

	test('returns undefined when task has no compatible local model', function () {
		assert.strictEqual(selectRevBuiltInModel('vision', [
			{ id: 'text', alias: 'qwen2.5-1.5b', inputModalities: ['text'] },
		]), undefined);
	});
});
