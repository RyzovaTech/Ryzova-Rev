/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RyzovaTech.
 *  SPDX-License-Identifier: GPL-3.0-only
 *  See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { selectRevContext } from '../../common/revContext.js';
import { RevCoreService } from '../../common/revCoreService.js';
import { createRevExecutionSnapshot, transitionRevExecution } from '../../common/revExecution.js';
import { RevDefaultPermissionPolicy } from '../../common/revPermissions.js';
import { RevToolRegistryService } from '../../common/revTools.js';

suite('Ryzova Rev Core Architecture', function () {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('execution lifecycle allows only declared transitions', function () {
		const initial = createRevExecutionSnapshot('exec-1', 'Implement feature', 100);
		assert.strictEqual(initial.state, 'understanding');

		const planning = transitionRevExecution(initial, 'planning', 200);
		assert.strictEqual(planning.state, 'planning');
		assert.strictEqual(planning.updatedAt, 200);

		assert.throws(
			() => transitionRevExecution(planning, 'reviewing', 300),
			/Invalid Rev execution transition/
		);
	});

	test('context selection respects priorities and explicit budget', function () {
		const selection = selectRevContext([
			{ id: 'required', kind: 'instruction', estimatedTokens: 80, priority: 1, required: true },
			{ id: 'high', kind: 'file', estimatedTokens: 60, priority: 10 },
			{ id: 'low', kind: 'file', estimatedTokens: 60, priority: 1 },
		], {
			maxTokens: 180,
			reservedOutputTokens: 40,
		});

		assert.deepStrictEqual(selection.selected.map(candidate => candidate.id), ['required', 'high']);
		assert.deepStrictEqual(selection.rejected.map(candidate => candidate.id), ['low']);
		assert.strictEqual(selection.usedTokens, 140);
		assert.strictEqual(selection.availableTokens, 140);
		assert.strictEqual(selection.overBudget, false);
	});

	test('required context remains selected and reports over-budget state', function () {
		const selection = selectRevContext([
			{ id: 'required', kind: 'project', estimatedTokens: 150, priority: 1, required: true },
		], {
			maxTokens: 100,
			reservedOutputTokens: 20,
		});

		assert.strictEqual(selection.selected.length, 1);
		assert.strictEqual(selection.overBudget, true);
	});

	test('default permission policy is conservative for mutating capabilities', function () {
		const policy = new RevDefaultPermissionPolicy();

		assert.strictEqual(policy.evaluate({
			capability: 'readWorkspace',
			reason: 'Build project context',
		}).decision, 'allow');

		assert.strictEqual(policy.evaluate({
			capability: 'writeWorkspace',
			reason: 'Apply an edit',
		}).decision, 'ask');

		assert.strictEqual(policy.evaluate({
			capability: 'runCommand',
			reason: 'Run tests',
		}).decision, 'ask');
	});

	test('tool registry rejects duplicate IDs and returns deterministic ordering', async function () {
		const registry = new RevToolRegistryService();
		const controller = new AbortController();
		const context = {
			executionId: 'exec-1',
			toolCallId: 'call-1',
			signal: controller.signal,
		};

		registry.register({
			id: 'z-tool',
			description: 'Z tool',
			capabilities: ['readWorkspace'],
			execute: async input => input,
		});
		registry.register({
			id: 'a-tool',
			description: 'A tool',
			capabilities: [],
			execute: async input => input,
		});

		assert.deepStrictEqual(registry.list().map(tool => tool.id), ['a-tool', 'z-tool']);
		assert.strictEqual(registry.has('a-tool'), true);
		assert.strictEqual(await registry.get('a-tool')!.execute('ok', context), 'ok');
		assert.throws(() => registry.register({
			id: 'a-tool',
			description: 'Duplicate',
			capabilities: [],
			execute: async input => input,
		}), /already registered/);
	});

	test('core service publishes project and execution state transitions', function () {
		const service = new RevCoreService();
		const phases: string[] = [];
		const listener = service.onDidChangeState(snapshot => phases.push(snapshot.phase));

		service.setProject({
			id: 'project-1',
			name: 'Project',
			sourceKind: 'local',
			roots: [],
			gitRepositoryCount: 1,
			hasDirtyWorkingCopies: false,
			capturedAt: 100,
		});

		service.beginExecution('exec-1', 'Implement feature');
		service.transitionExecution('planning');
		service.transitionExecution('executing');
		service.transitionExecution('validating');
		service.transitionExecution('reviewing');
		service.transitionExecution('completed');

		assert.strictEqual(service.snapshot.phase, 'project-ready');
		assert.strictEqual(service.snapshot.execution?.state, 'completed');
		assert.deepStrictEqual(phases, [
			'project-ready',
			'executing',
			'executing',
			'executing',
			'executing',
			'executing',
			'project-ready',
		]);

		listener.dispose();
		service.dispose();
	});
});
