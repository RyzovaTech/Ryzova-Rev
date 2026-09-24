# Ryzova Rev — Pre-Phase-6 Audit (Phases 1–5)

This audit is the release gate between the Rev Assistant milestone and Phase 6 engineering-agent work. It distinguishes Ryzova defects from inherited Code - OSS test/infrastructure noise and records the evidence required before Phase 6 starts.

## Audit scope

### Phase 1 — Foundation + GitHub

Status: **validated**

- `main` is the default source-of-truth branch in `RyzovaTech/Ryzova-Rev`.
- The repository retains Code - OSS attribution while Ryzova-authored work is licensed GPL-3.0-only.
- The clean Ryzova history and upstream-derived source remain separated by Git history rather than by silently removing attribution.

### Phase 2 — Branding shell

Status: **validated**

Audited product identity includes:

- `nameShort` / `nameLong`: Ryzova Rev
- application name: `ryzova-rev`
- data folders: `.ryzova-rev` / `.ryzova-rev-server`
- URL protocol: `ryzova-rev`
- Windows app/registry identifiers: Ryzova-specific
- macOS bundle identifier: `com.ryzova.rev`
- Linux icon/application identity: Ryzova-specific
- repository / issue URLs: `RyzovaTech/Ryzova-Rev`
- package + lockfile identity: `ryzova-rev-dev`
- license metadata: GPL-3.0-only

Upstream filenames such as `resources/linux/code.desktop` are intentionally retained where the Code - OSS build system expects those paths; their product-facing contents are template-driven and Ryzova-branded.

### Phase 3 — Local build + development preview

Status: **validated, with final post-audit desktop smoke required**

The development environment previously completed dependency installation, native module rebuilds, compile, Electron startup, integrated terminal, and Git validation on the local Windows development machine.

The audit additionally requires:

- clean TypeScript / hygiene checks on the audit head;
- successful dependency/native setup CI;
- one final local desktop launch after the audit merge to ensure the new Rev Assistant surface loads in the real Electron workbench.

### Phase 4 — Rev core architecture

Status: **validated**

Verified boundaries:

- project snapshot contracts;
- execution lifecycle and transition validation;
- deterministic context budgeting;
- conservative permission policy;
- deterministic tool registry;
- central observable Rev core state;
- delayed DI registration.

Focused unit coverage exists under `src/vs/platform/ryzova/test/common/`.

### Phase 5 — Rev Assistant + built-in intelligence

Status: **validated with audit fixes applied**

Verified layers:

- assistant intent and conversation contracts;
- assistant-only provider routing separated from engineering providers;
- Foundry Local runtime isolation in a utility process;
- local model catalog, ranking, fallback, load/unload, streaming and cancellation;
- bounded project/context awareness with local-only automatic workspace contents;
- structured streaming lifecycle and assistant errors;
- first-party desktop Rev Assistant sidebar.

## Audit findings fixed

1. **Local-runtime cancellation status**
   - A cancellation during model preparation could incorrectly report the requested model as `ready` even when no model was loaded.
   - Fixed by deriving post-cancellation status from the actually loaded model set and returning to `idle` when none is loaded.

2. **Non-retryable assistant failures**
   - Route fallback did not previously honor a structured `retryable: false` provider failure.
   - Fixed so non-retryable failures stop immediately instead of incorrectly trying another route.
   - Added focused regression coverage.

3. **Rev Assistant UI platform boundary**
   - The Rev Assistant view was registered in the common/web workbench even though the built-in local intelligence provider is desktop-only.
   - Fixed by registering the UI from the desktop workbench entry point alongside the desktop intelligence provider.

4. **Rev Assistant UI lifecycle / multi-window correctness**
   - DOM controls used the global document rather than the workbench container document.
   - Fixed to use `ownerDocument`, preserving auxiliary-window correctness.
   - Completed/cancelled/error stream states now clear the active request immediately and maintain `aria-busy` state without allowing the catch path to overwrite normalized terminal status.

5. **Project status documentation**
   - The root README still described the repository as branding-only.
   - Updated to match the actual Phase 1–5 implementation state.

## Inherited CI failures that are not Rev defects

The following failures have appeared repeatedly in upstream Code - OSS suites and do not point into Ryzova Phase 1–5 source:

- macOS `ChatPetWidget` pointer-position timing assertion;
- Windows `chat.runInTerminal` integration assertion;
- intermittent extension-host/disposable cleanup failures;
- jobs cancelled by a PR being merged while the workflow was still running.

These must still be observed during the audit run, but they are classified separately from Ryzova source failures. A Ryzova compile/type/hygiene failure remains a blocker.

## Phase 6 entry gate

Phase 6 must not start until all of the following are true:

- audit branch compiles and passes hygiene/type checks;
- Ryzova focused unit tests pass;
- current main dependency/platform setup checks are healthy;
- no failing check points to `src/vs/platform/ryzova/` or `src/vs/workbench/contrib/ryzova/`;
- the audit fixes are merged;
- a final local Electron smoke verifies:
  - Ryzova Rev launches;
  - Rev Assistant sidebar opens;
  - a conversation can be created;
  - send/cancel controls work;
  - the built-in provider reports a sane availability/download/load state.

Only after this gate is satisfied should Phase 6 engineering-agent execution be introduced.