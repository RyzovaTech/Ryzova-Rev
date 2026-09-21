# Ryzova Rev Core Architecture

This directory is the stable boundary between the Code - OSS platform and Ryzova Rev intelligence.

## Status

**Phase 4 — Rev Core Architecture Layer: complete.**  
**Phase 5 — Rev Assistant + Built-in Intelligence: in progress.**  
**Phase 5B — Built-in Local Model Runtime: complete.**  
**Phase 5C — Model Catalog + Routing: complete.**

Phase 5 extends the Phase 4 boundary with a dedicated assistant intelligence path that is intentionally separate from external engineering models. Rev Assistant must remain available independently of BYOK/local coding-model configuration, while engineering-model execution stays reserved for Phase 6.

Phase 5B adds the on-device execution path: Rev can discover, download, load, stream from, cancel, and unload Foundry Local chat models in an isolated utility process. The runtime is lazy and downloads model weights only when a selected local model is first needed.

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

## Phase 5 foundation

- `revIntelligence.ts` — assistant-model/provider contracts and task roles.
- `revIntelligenceRegistry.ts` — assistant-only provider/model routing.
- `revAssistant.ts` — conversation intent contracts and the Rev Assistant charter.
- `revAssistantService.ts` — conversation state and model invocation.
- `revServices.ts` — delayed registration for assistant intelligence services.
- Assistant routing excludes providers scoped as `engineering`.
- Code authoring is disabled unless the user explicitly opts in for that request.
- Rev Assistant does not execute workspace tools directly; Phase 6 engineering agents will use the Rev tool layer.

### Phase 5B built-in runtime

- `revBuiltInModels.ts` — deterministic assistant/reasoning/code-helper model selection with compatible-model fallback.
- `revBuiltInModelRuntime.ts` — runtime lifecycle, status, streaming, cancellation, and unload contracts.
- `revBuiltInIntelligenceProvider.ts` — bridge from Rev intelligence routing to the local runtime.
- `node/revBuiltInModelRuntimeService.ts` — Foundry Local discovery, on-demand download/load, inference, timeout, cancellation, and memory lifecycle.
- `node/revBuiltInModelRuntimeMain.ts` — isolated utility-process entry point.
- `workbench/services/ryzova/electron-browser/revBuiltInModelRuntimeService.ts` — renderer IPC proxy.
- `workbench/contrib/ryzova/electron-browser/revBuiltInIntelligence.contribution.ts` — desktop provider bootstrap.
- Supported native targets mirror Foundry Local: Windows x64/arm64, Linux x64/arm64, and macOS arm64.
- Only one local chat model is kept loaded at a time to bound memory use; downloaded models remain cached on disk.
- Runtime progress is observable through `idle → discovering → downloading → loading → ready → generating` states.
- Streaming requests are cancellable and guarded by model-load and stream-inactivity timeouts.
- Built-in code-helper inference still requires explicit code-authoring opt-in.
- Image-reference input is intentionally not advertised by the provider yet because the current Foundry Local JavaScript chat API accepts text messages only; the existing vision role remains reserved for a later Phase 5 integration rather than silently dropping image input.

### Phase 5C model catalog and routing

- Foundry aliases are normalized by model family, so short aliases and concrete variants such as `qwen3.5-0.8b-generic-cpu` participate in the same routing preference.
- Task-specific routing ranks assistant, reasoning, and code-helper families independently instead of treating every local chat model as interchangeable.
- Compatible future catalog models can be used as controlled fallbacks when a preferred family is unavailable.
- Loaded and cached variants receive deterministic tie-break preference to reduce unnecessary model swaps and downloads.
- Route constraints can require vision support or a minimum known context window.
- The built-in provider exposes a bounded fallback set per task rather than a single fragile route.
- The intelligence registry returns an ordered route list while continuing to exclude engineering-scoped providers from Rev Assistant.
- Rev Assistant retries the next compatible route when inference fails, but never retries cancellation.
- Routing behavior is deterministic and covered by unit tests, including variant aliases, context constraints, vision filtering, and inference fallback.

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
