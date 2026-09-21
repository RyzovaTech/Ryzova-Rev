/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech.
 *  SPDX-License-Identifier: GPL-3.0-only
 *  See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	buildRevAssistantContextSnapshot,
	createRevAssistantContextContribution,
	estimateRevContextTokens,
} from '../../common/revAssistantContext.js';

suite('Ryzova Rev Assistant Context', function () {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('estimates and admits bounded context by deterministic priority', function () {
		const active = createRevAssistantContextContribution(
			'active',
			'file',
			'Active file',
			'const active = true;'.repeat(20),
			100,
		);
		const oversized = createRevAssistantContextContribution(
			'oversized',
			'file',
			'Oversized file',
			'x'.repeat(20_000),
			10,
		);

		const snapshot = buildRevAssistantContextSnapshot(undefined, [oversized, active], {
			prompt: 'Explain the active file',
			contextWindow: 2048,
			reservedOutputTokens: 512,
			basePromptTokens: 128,
			includeWorkspaceContents: true,
		}, 1);

		assert.ok(estimateRevContextTokens(active.content) > 0);
		assert.deepStrictEqual(snapshot.selected.map(item => item.id), ['active']);
		assert.deepStrictEqual(snapshot.rejected.map(item => item.id), ['oversized']);
		assert.ok(snapshot.usedTokens <= snapshot.availableTokens);
		assert.match(snapshot.message?.content ?? '', /untrusted workspace data/);
	});

	test('privacy gate suppresses automatic workspace context', function () {
		const contribution = createRevAssistantContextContribution(
			'project',
			'project',
			'Project',
			'private workspace metadata',
			100,
		);

		const snapshot = buildRevAssistantContextSnapshot(undefined, [contribution], {
			prompt: 'Explain the project',
			includeWorkspaceContents: false,
		}, 1);

		assert.deepStrictEqual(snapshot.selected, []);
		assert.deepStrictEqual(snapshot.rejected.map(item => item.id), ['project']);
		assert.strictEqual(snapshot.message, undefined);
		assert.strictEqual(snapshot.usedTokens, 0);
	});
});
