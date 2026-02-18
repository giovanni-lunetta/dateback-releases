# DateBack Testing & Refactor Safety Guide

This document explains the test harness and refactor safety program used in DateBack to keep behavior unchanged while improving code structure.

Repo root: `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source`

## Quick Start

From repo root, run:

- `npm run check`
- `npm test`
- `npm run test:all`

Current `package.json` scripts:

- `"check": "node --check main.js && node --check src/renderer.js && node --check src/renderer.helpers.js"`
- `"test": "node --test"`
- `"test:all": "npm run check && npm test"`

## What Changed (High-Level Refactor Slices)

The refactor program followed a strict pattern: lock behavior first with characterization tests, then extract pure helpers, then rewire production code mechanically.

High-level slices implemented:

- Main process safety + readability around IPC flow handling in `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/main.js`
  - call-shape locking for `start-processing` and `retry-corrupted`
  - no-hang lifecycle protections tested
- Renderer pure-helper extraction in `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/src/renderer.helpers.js`
  - mode resolution
  - visibility decisions
  - storage estimation/warnings
  - start-processing args construction
  - processing UI state decisions
  - success modal copy/rows decisions
- Renderer glue remains in `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/src/renderer.js`
  - binds helper exports via global injection with fallback behavior
  - applies computed state to DOM

## What We Verified (Equivalence Locks)

Behavior was locked by characterization tests before refactors.

### Major test suites

| Suite | File | Coverage |
|---|---|---|
| Main IPC characterization | `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/test/main.ipc.characterization.test.js` | IPC handler return shapes/messages, sender auth outcomes, call-shape locks, retry/start invariants, process leak cleanup |
| Renderer pure helper unit tests | `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/test/renderer.helpers.test.js` | Pure function outputs in `renderer.helpers.js` |
| Renderer UI glue characterization | `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/test/renderer.ui.characterization.test.js` | `updateAutoUploadUiState` glue behavior, `applyVisibilityState`, `buildVisibilityInput` wiring |
| Start args lock | `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/test/renderer.startProcessing.characterization.test.js` | `startProcessingRoutine` payload to `window.api.startProcessing()` including resumeMode rules |
| Storage lock | `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/test/renderer.checkStorage.characterization.test.js` | `checkStorage` warnings and summary equivalence |
| Success modal lock | `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/test/renderer.successModal.characterization.test.js` | `showSuccessModal` copy/rows/order/conditional display |
| Processing transition lock | `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/test/renderer.processingUi.characterization.test.js` | Running/stopped UI state transitions and control toggles |

## How the Characterization Tests Work

Renderer characterization tests avoid browser/Electron runtime dependencies by executing real renderer function source in a Node VM context.

Pattern used:

- Read `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/src/renderer.js` as text.
- Extract target function source (for example `startProcessingRoutine`, `checkStorage`, `showSuccessModal`, `updateAutoUploadUiState`) using local helpers like `extractNamedFunctionSource(...)`.
- Create a minimal fake DOM object model:
  - elements with `classList.toggle/add/remove`
  - `textContent`, `checked`, `disabled`, `open`, etc.
- Stub `window.api` methods (for example `startProcessing`, disk-space calls) to capture payloads and avoid OS side effects.
- Inject helper exports from `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/src/renderer.helpers.js` via `globalThis.DateBackRendererHelpers`.
- Assert exact behavior (payload keys, UI text, class toggles, row ordering) to lock equivalence.

Main IPC characterization tests use controlled overrides/stubs to avoid real subprocess/network/GUI side effects and to verify exact response shapes and error strings.

## Refactor Map

### Pure helpers

`/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/src/renderer.helpers.js` exports:

- `resolveStorageMode`
- `resolveRunModeFlags`
- `computeModeVisibilityState`
- `computeWorkingFolderHelpText`
- `computePauseAfterBatchState`
- `buildStartProcessingArgs`
- `computeStorageEstimates`
- `computeStorageWarningState`
- `computeProcessingUiState`
- `buildSuccessModalCopy`
- `buildSuccessModalRows`

### Renderer binding

`/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/src/renderer.js`:

- Binds helpers from `globalThis.DateBackRendererHelpers`.
- Uses in-file fallbacks when helpers are not injected.
- Applies helper outputs to DOM with existing selectors and wiring.

### Main process readability helpers

`/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/main.js` includes extracted helpers:

- `prepareStartOrganizerRun`
- `prepareRetryOrganizerRun`

These keep call-shapes and runtime behavior unchanged while reducing duplication.

## Known Gotchas

### Previous hang issue (fixed)

- Symptom: tests could pass but Node test runner did not exit.
- Root cause: leaked `caffeinate` `ChildProcess` handles in the IPC test suite.
- Fix: test teardown now finds/kills leaked `caffeinate` child handles in:
  - `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/test/main.ipc.characterization.test.js`
- Result: `node --test` exits cleanly.

Important:

- `--test-force-exit` is not required and should be avoided.
- If a new hang appears, check active handles first and fix teardown rather than forcing process exit.

## Refactor Safety Rules Used

These rules were followed throughout the program:

- Add a characterization test first to lock current behavior.
- Extract pure helper(s).
- Rewire production code to call helper(s) mechanically.
- Preserve exact strings, return shapes, key ordering, and UI row ordering where locked.
- Re-run all checks/tests after each slice.

## When Adding New Refactors

Checklist:

1. Add characterization test(s) first for the behavior you plan to touch.
2. Keep tests deterministic (no real OS/network side effects).
3. Extract pure helper(s) where possible.
4. Rewire production code to use helper(s) without changing behavior.
5. Run `npm run test:all`.
6. Verify `git status` is clean before finalizing.

## Useful Commands

From `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source`:

- `npm run check`
- `npm test`
- `npm run test:all`
- `node --test test/main.ipc.characterization.test.js`
- `node --test test/renderer.*.test.js`

