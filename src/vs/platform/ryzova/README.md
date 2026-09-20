# Ryzova Rev Core Architecture

This directory is the stable boundary between the Code - OSS platform and Ryzova Rev intelligence.

## Status

**Phase 4 — Rev Core Architecture Layer: complete.**

The Phase 4 boundary is intentionally small. Later Rev features should extend these contracts and services instead of introducing parallel runtime state or scattering Ryzova-specific logic across upstream Code - OSS modules.

## Principles

- Reuse Code - OSS capabilities for files, editors, terminals, Git, tasks, debugging, extensions, and workspace lifecycle.
- Keep Rev intelligence behind small platform contracts instead of scattering product logic across upstream modules.
- Treat AI as a planner and proposer. Existing platform services remain the executors of filesystem, process, Git, and editor operations.
- Keep permissions explicit and capability-based.
- Make execution state observable and verifiable.
- Keep context selection bounded by an explicit budget.
- Add only narrow integration points to upstream workbench code.

## Phase 4 modules

- `revProject.ts` — project/workspace snapshot contracts.
- `revExecution.ts` — engineering execution lifecycle and transition rules.
- `revContext.ts` — context candidates, budgets, and deterministic selection.
- `revPermissions.ts` — permission capabilities and policy contracts.
- `revTools.ts` — tool metadata and registry service.
- `revCoreService.ts` — central Rev runtime state service.
- `revServices.ts` — delayed service registration.

## Architecture guarantees

- Rev owns its product-specific state under `src/vs/platform/ryzova/`.
- Code - OSS remains the execution substrate for editor, filesystem, terminal, Git, task, debug, extension, and workspace capabilities.
- Engineering execution follows an explicit lifecycle rather than ad-hoc boolean flags.
- Context admission is deterministic and budget-aware.
- Mutating or externally visible capabilities require an explicit permission decision.
- Tools are registered behind a stable registry contract before agent execution is introduced.
- The workbench integration remains a narrow side-effect registration import.
- Phase 4 behavior is covered by focused unit tests under `src/vs/platform/ryzova/test/common/`.

The architecture is informed by lessons from the earlier Alphi Creator Suite (project sessions, context budgeting, execution state, permissions, and tool registries), but this implementation is original and adapted to Code - OSS. Rev deliberately does not copy Alphi's UI/runtime structure or Dyad-derived portions.

Future phases should extend these contracts rather than bypass them:

- Phase 5: Rev Assistant + built-in intelligence.
- Phase 6: engineering agents and tool execution.
- Phase 7: run/test/repair/verify loop.
- Phase 8: integrated live preview.
