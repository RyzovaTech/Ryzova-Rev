/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech.
 *  SPDX-License-Identifier: GPL-3.0-only
 *  See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	rankRevBuiltInModels,
	revModelAliasMatches,
	revModelSupportsVision,
	selectRevBuiltInModel,
} from '../../common/revBuiltInModels.js';

suite('Ryzova Rev Built-in Model Selection', function () {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('assistant uses the highest preferred available family', function () {
		const selected = selectRevBuiltInModel('assistant', [
			{ id: 'small', alias: 'qwen2.5-0.5b', isCached: true },
			{ id: 'preferred', alias: 'qwen3.5-0.8b', isCached: false },
			{ id: 'other', alias: 'unrelated-model', isCached: true },
		]);

		assert.strictEqual(selected?.id, 'preferred');
	});

	test('matches Foundry concrete variants to their short preferred alias', function () {
		assert.strictEqual(revModelAliasMatches('Qwen3.5-0.8B-generic-cpu', 'qwen3.5-0.8b'), true);
		assert.strictEqual(revModelAliasMatches('qwen2.5-coder-0.5b-instruct-generic-cpu', 'qwen2.5-coder-0.5b'), true);
		assert.strictEqual(revModelAliasMatches('qwen3.5-4b', 'qwen3.5-0.8b'), false);
	});

	test('reasoning prefers Qwen 3.5 4B when available', function () {
		const selected = selectRevBuiltInModel('reasoning', [
			{ id: 'phi', alias: 'phi-4-mini-reasoning', isCached: true },
			{ id: 'qwen', alias: 'qwen3.5-4b-generic-cpu', isCached: false, inputModalities: ['text', 'image'], outputModalities: ['text'] },
		]);

		assert.strictEqual(selected?.id, 'qwen');
	});

	test('code helper stays on coding-model candidates before general fallbacks', function () {
		const selected = selectRevBuiltInModel('code-helper', [
			{ id: 'general', alias: 'phi-3.5-mini', isCached: true },
			{ id: 'coder', alias: 'qwen2.5-coder-1.5b-generic-cpu' },
		]);

		assert.strictEqual(selected?.id, 'coder');
	});

	test('ranking prefers loaded and cached variants inside the same model family', function () {
		const ranked = rankRevBuiltInModels('assistant', [
			{ id: 'cpu', alias: 'qwen3.5-0.8b-generic-cpu', isCached: true },
			{ id: 'gpu', alias: 'qwen3.5-0.8b-directml-gpu', isCached: true, isLoaded: true },
		]);

		assert.deepStrictEqual(ranked.map(candidate => candidate.model.id), ['gpu', 'cpu']);
		assert.ok(ranked[0].reasons.includes('already-loaded'));
	});

	test('context requirement filters known undersized models and favors known sufficient context', function () {
		const ranked = rankRevBuiltInModels('assistant', [
			{ id: 'small', alias: 'qwen3.5-0.8b', contextLength: 4096 },
			{ id: 'enough', alias: 'qwen2.5-1.5b', contextLength: 32768 },
			{ id: 'unknown', alias: 'phi-3.5-mini' },
		], { minimumContextLength: 8192 });

		assert.strictEqual(ranked.some(candidate => candidate.model.id === 'small'), false);
		assert.strictEqual(ranked.some(candidate => candidate.model.id === 'enough'), true);
		assert.strictEqual(ranked.some(candidate => candidate.model.id === 'unknown'), true);
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
