# DateBack App Architecture And Workflow

## 1. Executive summary

DateBack is a macOS desktop app for turning a downloaded Snapchat Memories export ZIP into a browsable, resumable local archive.

The product solves three practical problems:
- Snapchat exports arrive as a large ZIP plus JSON metadata, not as a ready-to-use photo library.
- The export can be large enough that processing, pausing, resuming, and retrying failures matter.
- Users may want either a purely local archive or an automated local-to-cloud handoff flow.

The app currently has two major product modes:
- **Computer mode**: DateBack writes processed files into batch folders under the user’s working/output location.
- **Cloud mode**: DateBack still uses a local processing root and a local staging area, then copies staged results into a user-selected synced cloud folder.

At a high level, the desktop app is a layered Electron application with a Python worker:
- The **Electron main process** owns security, path validation, subprocess launching, IPC, license validation, updater hooks, and privileged OS access.
- The **preload script** exposes a narrow `window.api` bridge into the renderer.
- The **renderer** owns the full UI, form state, progress state, modal system, and user-driven workflow logic.
- The **Python pipeline** does the actual ZIP parsing, download/media extraction, batching, resume logic, auto-upload staging/delivery, reporting, and retry behavior.

This document is meant to describe **what the app does today**, based on the current codebase in `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source`.

Historical audit/planning notes now live outside the app repo in `/Users/giovanni-lunetta/DateBack_Business/docs/coding_agent_audit`. Those docs are context, not the source of truth. The source of truth is the current code.

## 2. Tech stack and runtime architecture

### 2.1 Main technologies

| Area | Current implementation |
|---|---|
| Desktop shell | Electron |
| UI | Static HTML + CSS + vanilla renderer JavaScript |
| Privileged desktop logic | `main.js` |
| Secure renderer bridge | `preload.js` with `contextBridge` |
| Processing backend | Python |
| Packaged worker | `assets/bin/memory-organizer` in production builds |
| Dev worker entry | `python/cli.py` -> `python/process_snapchat_memories.py` |
| Local persistence | Filesystem, `electron-store`, `localStorage` |
| Tests | Node `node:test` suites plus a small Python `unittest` suite |
| Packaging | `electron-builder` |
| Updates | `electron-updater` |
| Licensing | Polar validation via main-process HTTP request |

### 2.2 Electron process model

#### Main process
The main process in `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/main.js` is the trusted desktop boundary.

It is responsible for:
- creating the BrowserWindow
- enforcing renderer trust and IPC sender validation
- validating and canonicalizing paths
- running file pickers and open-folder actions
- launching and monitoring the Python worker or packaged binary
- translating worker stdout/stderr into renderer progress/log events
- managing license validation and persistence
- managing updater prompts
- exporting support logs

#### Preload
The preload script in `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/preload.js` exposes a narrow, validated API to the renderer through `contextBridge.exposeInMainWorld('api', ...)`.

It is responsible for:
- input validation on renderer-provided strings and paths
- exposing invoke-style methods for privileged actions
- exposing event listener helpers for progress, logs, and support-log export events
- preventing direct renderer access to Node/Electron internals

#### Renderer
The renderer is split across:
- `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/src/index.html`
- `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/src/styles.css`
- `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/src/renderer.js`
- `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/src/renderer.helpers.js`

The renderer is responsible for:
- the user-visible step flow
- mode switching
- form validation and CTA gating
- storage readiness checks
- progress/status UI
- all modal interactions
- deciding when to call IPC actions
- interpreting backend progress events into user-facing state

#### Python processing pipeline
The Python worker is centered in `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/python/process_snapchat_memories.py`.

It is responsible for:
- reading the Snapchat export ZIP
- parsing memories metadata
- extracting or downloading media safely
- organizing outputs into batches
- building and reading progress manifests
- supporting resume, verify, trust-manifest, retry-corrupted, and start-fresh flows
- handling auto-upload staging and destination delivery in Cloud mode
- writing detailed reports and corrupted-file output

### 2.3 Renderer/backend communication model

The communication boundary is:
1. Renderer calls `window.api.*` from preload.
2. Preload forwards through `ipcRenderer.invoke(...)` or event listeners.
3. Main process validates sender and arguments.
4. Main process launches or controls the Python worker.
5. Python emits stdout JSON messages through `python/cli.py` or the packaged binary.
6. Main process forwards those messages to the renderer as `progress-update` or `log-message` events.

### 2.4 Important IPC boundaries

Important invoke-style IPC operations include:
- ZIP selection and validation
- folder selection and folder opening
- get-defaults
- start-processing
- stop-processing
- get-resume-manifest
- clear-output-folder
- resume-batch
- retry-corrupted
- get disk free space
- battery-status check
- license validate/status/clear

Important event-style IPC operations include:
- `progress-update`
- `log-message`
- `show-logs-exported-modal`

### 2.5 Security considerations

The security model is split across Electron process boundaries, path validation, log/privacy handling, and release-time trust assumptions.

#### Electron trust boundaries

Current trust assumptions:
- the renderer is **not** treated as fully trusted by default
- the BrowserWindow runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and `webSecurity: true`
- the main process tracks a trusted renderer document key after the expected app document finishes loading
- privileged IPC handlers use sender validation before doing filesystem, process, or network work
- in-app navigation to unexpected documents is blocked, and external URLs are opened through safe main-process helpers instead
- permission requests are denied through `setPermissionRequestHandler`

Practical implication:
- future changes should assume the renderer is a UI surface, not a privileged execution surface
- any new privileged behavior should stay behind preload + validated IPC rather than being pushed into renderer code

#### Preload and IPC exposure assumptions

Current preload assumptions:
- the renderer only gets the methods exposed on `window.api`
- preload performs basic input validation for required strings and optional paths
- the main process remains the final authority for validation and security checks

Practical implication:
- preload validation is a first filter, not the security boundary by itself
- any new `window.api` method should be reviewed for argument shape, least-privilege scope, and sender validation on the main-process side

#### Path validation, canonicalization, and symlink blocking

Current path/file protections include:
- input sanitization before path handling
- canonicalization of output, staging, and destination paths
- symlink blocking in sensitive output-path validation paths
- writable-directory checks before starting processing
- explicit nesting rules for processing root, staging, and destination relationships
- output-directory approval rules that usually require either:
  - the app default processing root, or
  - a user-approved folder-picker result

Important path rules enforced today:
- output roots cannot be obvious sensitive roots such as top-level home folders like raw Documents/Downloads/Pictures roots
- destination and staging cannot be the same
- destination cannot be inside staging
- staging cannot be inside destination
- destination cannot be inside the processing root
- destination cannot be a parent of the processing root

Practical implication:
- future agents should not treat path strings as interchangeable labels; the code relies on canonical relationships between processing root, staging root, and destination root

#### Support-log privacy expectations

Current support-log privacy model:
- `src/logger.js` writes redacted JSONL logs
- absolute user paths and media filenames are redacted from log fields
- common sensitive object keys such as tokens/secrets are redacted
- support-log export only includes recent log files plus a generated `system.json`
- `system.json` records log basenames and time range, not full filesystem paths

Practical implication:
- support logs are intentionally privacy-conscious, but they are still diagnostic artifacts and should be handled as support data, not public content
- changes to logging should preserve redaction guarantees unless there is an explicit product/security decision to alter them

#### License and network boundary

Current license/network assumptions:
- Polar license validation happens in the main process, not directly in the renderer
- environment variables in the main process control production vs sandbox Polar configuration
- renderer CSP currently allows connections to the Polar API host and Formspree, but core license validation is still a main-process concern
- license state is persisted locally in `electron-store`

Practical implication:
- changes to licensing, network calls, or support/contact integrations should be reviewed together with CSP, environment configuration, and main-process trust boundaries

#### Packaged worker and binary trust assumptions

Current release-time trust assumptions:
- production builds trust the bundled `assets/bin/memory-organizer` worker binary
- production builds also trust the bundled `assets/bin/ffmpeg`
- development can use `python/cli.py` and an optional `DATEBACK_PYTHON` override, but that is a local developer trust decision, not a renderer-controlled behavior
- the renderer does not choose arbitrary executables

Practical implication:
- the bundled worker and FFmpeg binaries are part of the release trust chain and should be treated like shipped code, not like user data
- packaging/release work should verify binary provenance and compatibility, especially because the canonical in-repo PyInstaller build invocation is not fully documented

## 3. Repository structure

### 3.1 Top-level application files

| Path | Purpose |
|---|---|
| `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/main.js` | Electron main process. Security boundary, IPC handlers, subprocess orchestration, updater, support logs, license validation, menu wiring. |
| `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/preload.js` | Secure bridge between renderer and main process. Validates basic input shapes and exposes `window.api`. |
| `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/package.json` | npm scripts, dependencies, Electron Builder packaging config, extraResources, updater publish config. |
| `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/package-lock.json` | Locked JavaScript dependency graph. |
| `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/.env.example` | Example environment file for updater/build secrets. |
| `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/memory-organizer.spec` | One of two PyInstaller spec files present in the repo. Current canonical build invocation is not proven inside this repo. |
| `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/LICENSE` | App license. |
| `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/THIRD_PARTY_NOTICES.txt` | Third-party notices bundled with the app. |
| `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/setup-secret-protection.sh` | Local repo hygiene script, not runtime app logic. |
| `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/CHANGELOG.md` | Release/change history context. |
| `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/CLAUDE.md` | Agent/developer context, not app runtime logic. |

### 3.2 Frontend files

| Path | Purpose |
|---|---|
| `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/src/index.html` | Full renderer DOM for the app: setup flow, progress UI, footer, and all modals. |
| `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/src/styles.css` | Entire visual system and layout for the desktop UI. |
| `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/src/renderer.js` | Main renderer controller. DOM bindings, workflow logic, progress handling, storage checks, modal handling, license UI, support modal UI. |
| `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/src/renderer.helpers.js` | Extracted pure-ish helper logic for renderer state decisions. Used directly by tests and by renderer glue. |
| `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/src/logger.js` | Main-process JSONL logger with privacy redaction, rotation, queueing, and rollover. |
| `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/src/supportLogs.js` | Support-log ZIP export utility. Collects recent log files and system metadata with privacy-conscious output. |

### 3.3 Python files

| Path | Purpose |
|---|---|
| `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/python/process_snapchat_memories.py` | Core processing pipeline. ZIP parsing, media handling, batching, resume, auto-upload, reporting, retry. |
| `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/python/cli.py` | Thin CLI wrapper that converts Python progress into JSON messages for Electron. |
| `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/python/batch_resume_logic.py` | Small helper module for batch scanning and resume-state decisions. Added to make batch-resume behavior explicit and testable. |
| `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/python/requirements.txt` | Python dependency list. |
| `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/python/memory-organizer.spec` | Second PyInstaller spec candidate. |

### 3.4 Build and docs files

| Path | Purpose |
|---|---|
| `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/build/entitlements.mac.plist` | macOS hardened runtime entitlements used during signed builds. |
| `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/docs/BUILD.md` | Current repository knowledge about packaging and the worker binary build path. |
| `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/docs/TESTING.md` | Current testing approach and characterization-test strategy. |

### 3.5 Tests

The test suite lives under `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/test`.

Important files include:
- `main.dotenv.guard.test.js`: verifies dotenv loading stays optional and guarded
- `main.ipc.characterization.test.js`: locks IPC behavior and main-process call shapes
- `renderer.helpers.test.js`: direct tests of pure helper logic
- `renderer.ui.characterization.test.js`: UI glue and visibility-state locking
- `renderer.checkStorage.characterization.test.js`: storage-check behavior locking
- `renderer.startProcessing.characterization.test.js`: renderer start-processing payload behavior
- `renderer.processingUi.characterization.test.js`: UI state transitions while processing
- `renderer.successModal.characterization.test.js`: success-modal content and row rendering
- `renderer.progressUpdate.characterization.test.js`: progress update regressions, including stale status clearing
- `python_batch_resume_logic_test.py`: focused Python tests for batch resume semantics, including Cloud continuity behavior

## 4. Core product concepts

The following terms are easy to confuse. The distinction matters.

| Concept | Current meaning in code | Easy confusion to avoid |
|---|---|---|
| **ZIP file / Snapchat export** | The downloaded Snapchat export ZIP, usually named `mydata...zip`, containing `memories_history.json` and media references. | It is not already a usable photo library. It is raw input. |
| **Working folder / processing root / `outputDir`** | The root directory DateBack uses for manifests, reports, temp files, corrupted files, default staging, resume, start-fresh, and the generated processed-memory folder. In Electron this is the user-facing `outputDir` field/state. | It is **not** just a temp cache location. In Cloud mode it is hidden by default but still exists and still matters. |
| **Processed output folder / `OUTPUT_DIR` in Python** | The actual dated output folder, typically `Processed_Memories_<date>`, created under the processing root. | This is not always the same as the chosen `outputDir` from the renderer. The renderer’s `outputDir` is usually the root above it. |
| **Staging folder / custom staging folder / `staging-path`** | Optional override for Cloud staging. If unset, Cloud mode stages into `.staging` under the processing root. | This is distinct from `outputDir`. Do not collapse them. |
| **Synced cloud folder / `destinationDir`** | A folder inside iCloud Drive, Dropbox, Google Drive, OneDrive, Box, or a similar sync client where finished files are copied for cloud sync. | This is the final delivery handoff, not the processing root and not the staging root. |
| **Computer mode** | Files are processed into batch folders in the output location. No auto-upload pipeline is used. | Pause-after-batch here is for local storage management, not cloud sync automation. |
| **Cloud mode** | Files are processed locally, staged locally, then copied into a synced destination folder. The user-visible main flow asks for destination, not working root. | Cloud mode is not “no local working root.” It still depends on a concrete processing root and staging path. |
| **Batch** | A processing group organized around a target size of 500 memories/files. | A completed batch folder may contain fewer than 500 actual files because duplicates/errors/skips are allowed. The app does not guarantee exactly 500 physical files per completed batch. |
| **Manifest / batch progress** | The persisted resume state in `.batch_progress.json` or legacy `.batch_progress`, stored alongside the processing root. | It is not just a progress bar artifact. It is critical to trust resume and Cloud resume state. |
| **Processed indices** | A set/list of original memory indices that were already processed. Used as a source of truth for trust-manifest resume and Cloud resume filtering. | This tracks logical memories, not simply files on disk. |
| **Trust resume** | Resume mode that trusts the manifest and skips already processed items without scanning the filesystem. | Faster, but it trusts saved state more than disk verification. |
| **Verify resume** | Resume mode that checks files on disk and rebuilds processed state from actual existing outputs. | Safer, slower, and more file-system dependent. |
| **Success / partial success / retry corrupted** | Success means the run completed. Partial success means some memories failed and are in the report/corrupted output. Retry corrupted uses the report to retry only failed entries. | A successful run can still have errors and expose `Retry Corrupted Files`. |
| **Support logs** | A privacy-conscious ZIP export of recent redacted logs plus system metadata. | Support logs are not the same as processing reports. Logs are for troubleshooting the app, not listing failed memories. |

## 5. Full user workflow — end to end

This section describes the current end-to-end flow as implemented.

### 5.1 App launch

| Aspect | Current behavior |
|---|---|
| What the user sees | The main DateBack window opens. |
| What the renderer does | `init()` runs in `renderer.js`. |
| What happens first | The renderer checks license status through `window.api.getLicenseStatus()`. |
| Stored state involved | Main process reads `electron-store` key `license`. |
| What can go wrong | If license status cannot be read or is invalid, the license modal is shown. |

### 5.2 First-launch instructions and onboarding

| Aspect | Current behavior |
|---|---|
| What the user sees | An instructions modal with a built-in Snapchat export walkthrough and a link to `https://dateback.app/#export-guide`. |
| Choice they make | Close it, reopen it later from the header, and optionally check “Don’t show this again.” |
| What gets stored | `localStorage.hasSeenInstructions = 'true'` only if the user explicitly checks the box when closing. |
| Backend involvement | None, except opening Snapchat or website URLs through `window.api.openUrl`. |
| What can go wrong | This is renderer-only state. Future agents should verify modal sequencing on first launch because license gating and instructions both run during init. |

### 5.3 License activation

| Aspect | Current behavior |
|---|---|
| What the user sees | A license activation modal asking for the purchase key. |
| Choice they make | Enter the key and click Activate License. |
| Backend action | Main process calls Polar’s license validation endpoint and stores the validated license in `electron-store`. |
| Stored state | `store.set('license', ...)` with validation result and activation timestamp. |
| What can go wrong | Invalid key, offline validation failure, rate limiting, or API failure. There is no implemented trial flow. |

### 5.4 Step 1: ZIP selection

| Aspect | Current behavior |
|---|---|
| What the user sees | Drag/drop ZIP area, selected-file chip, validation status, and “Find My Zip Automatically.” |
| Choice they make | Drag a ZIP, browse for it, or auto-find one in Downloads. |
| Backend action | Main process validates the ZIP and can auto-scan Downloads for the newest `mydata*.zip`. |
| Stored state | Renderer stores selected ZIP path, validation state, and memory count once validated. |
| What can go wrong | Invalid ZIP, expired Snapchat links inside export, wrong export structure, or missing metadata. |

### 5.5 Step 2: mode selection

| Aspect | Computer mode | Cloud mode |
|---|---|---|
| What the user sees | “Store Memories on Computer” card and optional “Pause after each batch (up to 500 files)” checkbox. | “Store Memories on Cloud” card. |
| What choice means | Direct local archive with optional pause-between-batches behavior. | Local processing plus staging plus copy to a synced folder. |
| Stored state | Renderer checkbox state only until start. | Renderer checkbox state only until start. |
| What can go wrong | Confusing path expectations if the user has not selected a working folder yet. | Invalid destination, invalid staging/destination nesting, or insufficient temporary space. |

### 5.6 Step 3: folder selection

#### Computer mode
- The visible step is the working/output folder chooser.
- The renderer uses and displays `outputDir` directly.
- The backend treats this as the processing root.

#### Cloud mode
- The visible required step is the synced cloud folder chooser.
- The working folder step is hidden from the main flow.
- The renderer still keeps a concrete `outputDir` behind the scenes, defaulted from `get-defaults()` unless overridden in Advanced Cloud Options.
- The advanced panel exposes:
  - working folder override
  - temporary storage auto/manual cache settings
  - custom staging folder override

### 5.7 Step 4: storage readiness

| Aspect | Current behavior |
|---|---|
| What the user sees | Total memories, available space, estimated required space, and warnings. |
| Backend action | Main process can return free space for a canonical path. Cloud mode preflight validates staging/destination constraints and free-space rules. |
| Stored state | Mostly runtime-only renderer state. |
| What can go wrong | Low disk, invalid staging/destination relationships, or Cloud cache requirement failure. |

### 5.8 Start processing

| Aspect | Current behavior |
|---|---|
| What the user clicks | `START PROCESSING` |
| Renderer action | Validates ZIP, mode, output root, Cloud destination, battery/offline warnings, and storage warnings. Builds the start payload. |
| Main-process action | Validates sender, validates output root, validates auto-upload options, builds subprocess args, and launches the worker. |
| Python action | Opens ZIP, sets config, loads/resolves manifest state, processes memories, and streams progress events. |
| What gets stored | Session output dir in main process, manifests in processing root, report files, temp/staging state, logs. |
| What can go wrong | Path validation failure, disk-space failure, ZIP validation failure, worker startup failure, or runtime Python failure. |

### 5.9 Progress states

The renderer currently uses progress phases such as:
- Ready
- Preparing
- Resuming
- Verifying
- Processing
- Uploading
- Retrying
- Paused
- Needs Attention
- Complete

The user sees:
- a progress bar
- a primary progress label
- a helper/status line under the progress bar
- a collapsible log panel

Backend progress sources include:
- per-item progress
- verification progress
- batch-pause events
- auto-upload progress
- auto-pause/auto-resume events in Cloud mode
- completion or error

### 5.10 Pause, resume, and continue later

| Flow | Current behavior |
|---|---|
| Pause Processing | Sends `stop-processing` to main, which SIGTERMs the worker. Python handles this as a graceful pause request. |
| Resume Processing | Uses manifest lookup and the resume modal if prior state exists. |
| Resume modes | Skip Already Processed = trust-manifest. Verify Files = disk verification. Start Fresh = destructive cleanup. |
| Save Progress for Later | Stops the active run and shows a previous-run summary; the manifest remains for future resume. |
| Batch pause | Computer mode only. After a completed batch, Python waits for a resume signal file. |

### 5.11 Completion

| Aspect | Current behavior |
|---|---|
| What the user sees | Success modal with stats, optional retry button, and optional staging-folder button in Cloud runs. |
| Renderer behavior | Uses `buildSuccessModalCopy` and `buildSuccessModalRows` to generate mode-aware stats. |
| Backend behavior | Writes `detailed_report.json`, flushes upload state, and returns final stats. |
| What can go wrong | The run can complete with errors, in which case retry is offered. |

### 5.12 Next steps and support/log export

| Feature | Current behavior |
|---|---|
| Next Steps modal | Static help modal with local-storage and manual cloud-upload guidance. It is not deeply mode-aware. |
| Contact Support | Opens a mailto link with app version and platform context. |
| Export Support Logs | Help menu action; creates a ZIP of recent redacted logs plus `system.json`, reveals it in Finder, and shows a renderer modal. |
| Open Output Folder | Footer button opens the output root in Computer mode and the selected cloud destination in Cloud mode if one is chosen. |

## 6. Computer mode workflow

### 6.1 What Computer mode does

Computer mode writes processed memories into batch folders inside the local output flow under the processing root.

Typical path shape:
- user selects processing root `outputDir`
- Python creates `Processed_Memories_<date>` under that root
- batch folders such as `Batch_01`, `Batch_02`, and so on live under the processed folder

### 6.2 Batch behavior in Computer mode

Current implemented contract:
- the batch target is 500
- the app processes in 500-memory groups
- completed batch folders may contain fewer than 500 actual files when duplicates, skips, or errors reduce physical output count

This is an important truth:
- **underfilled completed batches are allowed**
- this is expected when the underlying memory set does not map one-to-one to new physical files

What is **not** supposed to happen:
- a partial active batch being incorrectly treated as completed on pause and then skipped on resume

That specific bug was fixed by preserving correct `last_completed_batch` semantics and keeping partial-batch continuity.

### 6.3 Pause-after-batch in Computer mode

Pause-after-batch means:
- after a completed batch, Python emits a `batch_pause` event
- the renderer shows the Batch Complete modal
- if the user clicks `Continue to Next Batch`, the renderer calls `resume-batch`
- main process writes `.dateback_resume_signal` into the validated output root
- Python is polling for that signal and then continues

Important nuance:
- the signal file is written into the renderer/main-process validated output root
- Python looks for `.dateback_resume_signal` in `dirname(OUTPUT_DIR)`
- these align because `OUTPUT_DIR` is the dated processed folder under the selected working root

### 6.4 Manual pause/resume in Computer mode

Manual pause means:
- the user clicks `Pause Processing`
- main process sends SIGTERM to the worker
- Python sets a graceful pause flag and tries to finish in-flight work cleanly
- manifest state is persisted
- renderer exposes Resume, Save Progress for Later, or Start Over actions

Resume means:
- renderer checks for manifest state
- user chooses trust-manifest or verify-files
- Python either trusts `processed_indices` or scans actual outputs to rebuild what is already done
- batch continuation logic uses the output root to find incomplete or already completed batch structure

### 6.5 Guarantees and non-guarantees in Computer mode

Guaranteed today:
- processed files already written are kept on pause
- completed underfilled batches from duplicates/skips remain valid completed batches
- start fresh deletes current output/report/temp/manifest state and restarts from scratch
- retry corrupted uses the report and does not require re-running the entire export

Not guaranteed today:
- every completed batch folder contains exactly 500 files
- purely cosmetic batch structure if timestamp collisions or duplicate logic reduce unique output files

### 6.6 Retry, resume, and start-fresh in Computer mode

| Flow | Current behavior |
|---|---|
| Trust resume | Uses manifest `processed_indices` to skip already processed entries. Fast. |
| Verify resume | Scans output files and rebuilds processed state from disk. Slower but safer. |
| Start fresh | Main process clears processed folders, reports, temp files, and manifests under the processing root. |
| Retry corrupted | Reads `detailed_report.json`, selects `Error` entries, and reprocesses only those. |

## 7. Cloud mode workflow

### 7.1 How Cloud mode differs from Computer mode

Cloud mode differs in three ways:
- the main visible flow asks for a synced cloud destination instead of a visible working-folder step
- a local staging pipeline is introduced between processing and final delivery
- processed state uses both manifest-driven logical progress and uploader/staging state

### 7.2 What the user sees in Cloud mode

The current visible main flow is:
1. Select ZIP
2. Choose storage mode
3. Select synced cloud folder
4. Review storage readiness

Advanced Cloud Options currently expose:
- working folder override
- temporary storage mode and limits
- custom staging folder override

### 7.3 What is still true behind the scenes

Even though the visible working-folder step is hidden in Cloud mode, the app still depends on a concrete processing root.

Current Cloud architecture:
- `outputDir` still exists and is still required internally
- if the user does not override it, the renderer defaults it from `get-defaults()`
- that processing root is used for manifests, reports, retries, temp files, corrupted files, and default `.staging`

This is the current conceptual split:
- **processing root / working root** = `outputDir`
- **staging folder** = `staging-path` override or `<processing root>/.staging`
- **synced cloud folder** = `destinationDir`

These are not the same thing.

### 7.4 How staging and destination delivery work

Cloud mode processing uses:
- `AUTO_STAGING_DIR`: where batch folders are staged locally
- `AUTO_DESTINATION_DIR`: where staged files are copied into the synced destination
- `UploadLedger`: to track uploads/delivery bookkeeping
- `AutoUploadManager`: to stage, queue, recover, and drain uploads

The delivery model today is:
1. Python writes staged batch output into the staging root.
2. AutoUploadManager copies staged files into the synced destination folder.
3. The user’s cloud sync client uploads from that destination folder.

### 7.5 How processed indices are used in Cloud mode

Cloud mode intentionally uses manifest `processed_indices` as a primary resume filter.

That means:
- already processed memory indices are removed from the remaining work set
- resume does not need to re-scan the entire output tree the same way verify-files Computer mode does
- logical memory progress is preserved even if files are already staged or uploaded

This behavior remains part of the current design and was **not** removed by the recent resume fixes.

### 7.6 How `recover_pending()` fits in

Before processing remaining work, Cloud mode calls `recover_pending()`.

Its role is:
- inspect the staging root for already staged media files
- re-enqueue those files for delivery so interrupted uploads can continue

This is important because Cloud resume is two-layered:
- `processed_indices` preserve logical processing progress
- `recover_pending()` preserves already staged delivery work

### 7.7 What Cloud resume does now after the recent continuity fixes

This is the current implemented contract after the recent fix:
- Cloud mode still filters remaining work using `processed_indices`
- Cloud mode still calls `recover_pending()`
- Cloud mode now scans the **actual staging root** rather than reusing the Computer-mode output-root scan
- if a partial staged batch already exists, Cloud resume continues into that batch
- if no partial staged batch exists but completed staged batches already exist, Cloud resume continues numbering from the next batch after the highest existing staging batch
- Cloud mode only restarts at `Batch_01` if there are truly no prior staged batches to continue

This is the recent bug that was fixed:
- before the fix, Cloud mode preserved file-level logical progress but restarted remaining new work at `Batch_01`, which broke staging batch continuity

### 7.8 What Cloud mode preserves vs what it does not preserve

Preserved:
- logical processed-memory progress via `processed_indices`
- staged delivery recovery via `recover_pending()`
- local processing root semantics via `outputDir`
- batch continuity in staging after resume

Not preserved as a product promise:
- exact 500-file physical batch folders
- a user-visible guarantee that the synced cloud destination is a clean reflection of one exact staging batch at all times during active upload

### 7.9 Known Cloud-specific tricky areas

Cloud mode has the most architectural complexity in the app.

Current caveats to understand:
- the visible working-folder step is hidden, but the working root still matters everywhere important
- staging and destination path rules are strict and easy to break if a future change conflates them
- temporary storage pressure can auto-pause processing until delivery drains below the resume threshold
- the Next Steps modal is still a generic help surface and is not a strict Cloud-mode operational spec

## 8. State and persistence model

### 8.1 Persistence overview

| State artifact | Where it lives | What it means |
|---|---|---|
| License record | `electron-store` | Whether the app is activated on this Mac. |
| Instructions seen flag | Renderer `localStorage.hasSeenInstructions` | Whether the user chose not to show onboarding again. |
| Batch progress manifest | `.batch_progress.json` or legacy `.batch_progress` in the processing root | Resume metadata, processed indices, batch boundaries, ZIP fingerprint, processed counts. |
| Detailed report | `detailed_report.json` in the processing root | Structured per-entry report used for summary and retry-corrupted. |
| Temp processing | `temp_processing` in the processing root | Temporary extraction/download workspace. |
| Corrupted output | `Corrupted_Memories` in the processing root | Files or artifacts associated with corrupt/error cases. |
| Cloud staging | default `.staging` under processing root or custom staging dir | Local staged batch files for Cloud delivery. |
| Upload ledger | `.upload_ledger.jsonl` in the processing root | Delivery bookkeeping for auto-upload. |
| Resume signal file | `.dateback_resume_signal` in the validated output root / processing root area | Signal used only for pause-after-batch continuation. |
| Logs | Electron `userData/logs` | Redacted JSONL logs used for debugging and support export. |

### 8.2 Manifest semantics

Current manifest roles:
- `last_completed_batch` means the last fully finalized batch
- `active_partial_batch` marks an interrupted current batch when relevant
- `processed_indices` is the key logical progress source for trust-manifest and Cloud-mode filtering
- `processed_count`, `last_index`, and ZIP fingerprint support resume safety and summary state

Important source-of-truth rule:
- `processed_indices` is the logical source of truth for already-processed memories in trust-manifest and Cloud resume
- batch folder scanning is a structural continuation aid, not the only truth source

### 8.3 Output-root assumptions

Current default assumptions:
- default processing root from `get-defaults()` is `~/Pictures/SnapchatMemories`
- `Processed_Memories_<date>` is created under that root unless output naming is otherwise determined by current run context
- manifests, reports, temp files, corrupted files, and default staging all live relative to the processing root

## 9. Failure / recovery model

### 9.1 Pause requested and graceful shutdown

Current flow:
- renderer calls `stop-processing`
- main process sends SIGTERM to the worker
- Python signal handler converts this into a graceful pause request
- in-flight work is allowed to settle as much as possible
- progress/manifest state is saved

### 9.2 Resume processing

Current resume entry points:
- start button detects an existing manifest and may open the Resume Processing modal
- user picks trust-manifest, verify-files, or start fresh

Current source-of-truth behavior:
- trust-manifest uses manifest logical progress
- verify-files uses disk scanning in Computer mode
- Cloud mode uses processed-indices filtering and staging continuity scanning

### 9.3 Start fresh

Start fresh currently means:
- main process clears processed folders, corrupted folder, temp folder, detailed report, and manifest files under the processing root
- the original ZIP is untouched
- the next run behaves like a clean run

### 9.4 Retry corrupted

Retry corrupted currently means:
- read `detailed_report.json`
- select report entries marked `Error`
- re-run only those entries
- in Cloud mode, reuse auto-upload settings, destination, and staging behavior

### 9.5 Storage warnings and low-space behavior

Computer mode low-space behavior:
- warns when estimated required space exceeds available space
- for pause-after-batch flows, warnings now tell the user to move or delete finished batch folders before continuing

Cloud mode low-space behavior:
- validates cache requirements on the staging volume
- can emit auto-pause/auto-resume based on staging cache thresholds
- assumes the destination remains available and the cloud sync client is functioning

### 9.6 Frontend-only vs backend-originated failures

| Failure type | Likely source |
|---|---|
| Missing ZIP selection, invalid CTA state, modal visibility problems | Renderer/front-end state |
| Output/destination/staging path rejection | Main-process validation or Python auto-upload validation |
| No disk space / invalid volume checks | Main-process preflight or Python runtime checks |
| Resume mismatch / manifest mismatch | Mostly Python logic with renderer resume UI around it |
| Expired Snapchat links or media fetch/download failures | Python processing pipeline |
| License activation failure | Main-process network/license path |
| Support log export failure | Main-process logger/supportLogs path |

## 10. UI architecture / frontend state model

### 10.1 How `renderer.js` drives state

`/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/src/renderer.js` is the app’s main state machine in practice.

It owns:
- DOM references for nearly everything in the app
- setup-flow state
- current storage mode
- current output/destination/staging state
- processing flags such as `isProcessing`, `stoppedByUser`, `hadPartialRun`, `lastStats`
- modal open/close behavior
- progress rendering and progress-phase interpretation

This file is the highest-risk frontend file because many state transitions are coordinated here rather than in a smaller centralized model.

### 10.2 Role of `renderer.helpers.js`

`/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/src/renderer.helpers.js` contains extracted decision helpers for:
- mode resolution
- working-folder help copy
- run-mode flags and start-processing arg assembly
- storage estimates and storage warnings
- processing UI control states
- success modal copy and row decisions

It exists to keep some logic testable and to reduce regression risk while `renderer.js` remains the DOM glue layer.

### 10.3 Major frontend state areas

The main frontend state areas are:
- ZIP selection and validation state
- storage mode state
- output/destination/staging path state
- Cloud auto-cache state
- progress phase state
- resume/restart partial-run state
- success/summary modal state
- license modal state
- contact/log export modal state

### 10.4 Modal system

Major modals currently implemented:
- instructions modal
- success modal
- next steps modal
- stop confirm modal
- battery warning modal
- offline warning modal
- restart confirm modal
- resume mode modal
- batch pause modal
- storage warning modal
- generic message modal
- expired-link modal
- license modal
- contact support modal
- support logs exported modal

Modal behavior is mostly managed ad hoc in `renderer.js` rather than through a generalized modal framework.

### 10.5 Progress handling

Progress handling currently lives in `handleProgressUpdate(data)`.

It interprets backend events such as:
- `progress`
- verification progress
- `batch_pause`
- `upload_progress`
- `auto_pause`
- `auto_resume`
- `upload_error`
- `upload_fatal`
- `complete`

A recently fixed frontend bug in this area:
- after `Continue to Next Batch`, the temporary “continuing...” helper text could remain visible after real processing resumed
- current code now clears/replaces that temporary helper state when actual progress resumes

### 10.6 Where the renderer is easiest to regress

High-risk renderer areas include:
- mode switching between Computer and Cloud
- output/destination/staging path interactions
- storage warning logic and CTA enablement
- partial-run transitions between Stop, Resume, Continue Later, and Start Fresh
- success/summary modal reuse
- progress-phase transitions from backend events

### 10.7 Known frontend-state pitfalls already discovered

Known current or historical pitfalls:
- Cloud mode hides the visible working-folder step but still depends on `outputDir` being kept in state
- progress helper text can get stuck if progress-state transitions are not carefully reset
- shared modal shells can cause copy or structure to be less mode-specific than intended
- the support-log listener wiring at the bottom of `renderer.js` reassigns `window.api.onLogsExported` in a way that future frontend changes should treat carefully

## 11. Testing architecture

### 11.1 Test suites that exist today

Current automated coverage includes:
- main-process characterization tests
- pure renderer helper tests
- renderer DOM-glue characterization tests
- renderer processing/progress regressions
- Python unit tests for batch resume logic

Primary commands:
- `npm run check`
- `npm test`
- `npm run test:all`
- `python3 test/python_batch_resume_logic_test.py`

### 11.2 What is covered well

Relatively strong current coverage exists for:
- IPC call shapes and response behavior in `main.js`
- helper-function logic in `renderer.helpers.js`
- renderer wiring around start args, mode visibility, storage warnings, success-modal rows, and progress-update regressions
- batch resume decision logic in the extracted Python helper

### 11.3 What is still weak

Still weak or mostly manual today:
- full end-to-end Electron + Python integration
- real ZIP processing against fixture exports
- real download/media extraction edge cases
- true Cloud sync behavior with Dropbox/iCloud/etc.
- updater flows in packaged builds
- support-log export end-to-end in a packaged environment
- notarized/release artifact smoke verification

### 11.4 Characterization-test strategy

The JavaScript test suite relies heavily on characterization tests.

That means:
- behavior is locked before structural refactors
- renderer functions are extracted and run in Node VM contexts with fake DOM objects
- helper outputs, exact strings, and payload shapes are intentionally asserted

This is important for future agents because the repo has already chosen “lock current behavior, then refactor safely” as the working test strategy.

### 11.5 Python-specific tests now present

Current Python-specific automated coverage is narrow but meaningful:
- `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/test/python_batch_resume_logic_test.py`

It covers:
- partial-batch semantics for `last_completed_batch`
- Computer-mode incomplete batch continuation
- allowed underfilled completed batches
- Cloud-mode batch continuity after resume
- staging-root scanning, including custom staging roots

It does **not** yet cover the full processing pipeline end to end.

## 12. Release / packaging overview

### 12.1 Practical release pipeline in this repo

The JavaScript/Electron packaging path in this repo is clear:
- `npm run build`
- `npm run build:mac`

The worker-binary build path is less explicit in-repo:
- the app expects prebuilt binaries in `assets/bin/memory-organizer` and `assets/bin/ffmpeg`
- this repo does not prove the canonical PyInstaller build command used to produce `memory-organizer`

### 12.2 What has to be true before release

Before release, confirm:
- `assets/bin/memory-organizer` exists and is compatible with the current Python pipeline
- `assets/bin/ffmpeg` exists and is packaged correctly
- `npm run test:all` passes
- packaged app can launch and spawn the worker
- license validation environment variables are configured as intended for production or sandbox/QA
- signing/notarization settings are valid for the current build target

### 12.3 Manual verification that should happen before shipping

At minimum, manual release verification should include:
- fresh launch on a clean machine or clean user profile
- license activation flow
- ZIP auto-find and manual ZIP selection
- Computer-mode run end to end
- Computer-mode pause/resume and pause-after-batch
- Cloud-mode run end to end with a real synced destination folder
- Cloud-mode pause/resume with staged batches already present
- retry-corrupted flow
- support logs export via Help menu
- updater prompt behavior in the intended release channel

### 12.4 High-risk files and areas for release

High-risk areas before packaging or shipping:
- `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/main.js`
- `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/src/renderer.js`
- `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/python/process_snapchat_memories.py`
- `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/python/batch_resume_logic.py`
- packaged `assets/bin/memory-organizer`
- any change touching manifests, auto-upload staging, destination validation, or resume behavior

### 12.5 Release-specific caveats future agents should know

Important practical caveats:
- The About dialog in `main.js` still hardcodes `Version: 1.0.6`, which can drift from `package.json` version `1.1.4`.
- Build docs confirm the worker binary path expectation, but not the canonical worker build command.
- Changes to IPC payload shapes, output-root validation, or Python CLI args are release-risky because they cross process boundaries.

## 13. Known tricky areas / sharp edges

### 13.1 Concepts that are easy to confuse

The biggest concept traps are:
- `outputDir` versus `OUTPUT_DIR`
- processing root versus staging folder versus destination folder
- Computer-mode batch folder semantics versus Cloud-mode staged batch semantics
- processed indices versus physical files on disk

### 13.2 Behavior that looks like a bug but is actually expected

Expected behavior that can look suspicious:
- a completed batch folder containing fewer than 500 physical files
- duplicates being skipped while total logical memories processed still advances
- Cloud mode still requiring a hidden/default working root even though the visible main flow no longer asks for it

### 13.3 Behavior that previously was buggy and was fixed

Recently fixed issues that future agents should not accidentally reintroduce:
- mid-batch pause persistence treating the active partial batch as completed
- stale “continuing to next batch” progress helper text lingering after resume
- Cloud-mode resume preserving processed indices but restarting remaining work at `Batch_01` instead of preserving staging batch continuity

### 13.4 Areas likely to regress

Most regression-prone areas are:
- renderer state transitions around resume/restart/continue-later
- path and folder-validation logic in main process
- Cloud-mode staging and destination relationships
- manifest semantics and batch continuity logic in Python
- support/log export hooks between main and renderer

### 13.5 Current implementation caveats future agents should respect

Current caveats worth knowing:
- The Next Steps modal is generic help content, not a strict reflection of the Cloud auto-upload pipeline.
- The renderer remains monolithic and state-heavy even after helper extraction.
- Historical audits exist outside the repo root, but current code should override outdated plan language if they ever conflict.

### 13.6 Current open questions / non-final areas

These are not future-feature proposals. They are current areas that deserve extra care because the repo still has some ambiguity or maintenance risk around them.

- The canonical build invocation for `assets/bin/memory-organizer` is still not fully codified in this repo. Two PyInstaller spec files exist, and `docs/BUILD.md` explicitly treats the worker build path as only partially confirmed.
- The support-log event wiring at the bottom of `src/renderer.js` looks redundant relative to preload’s existing `onLogsExported` bridge. It works as current code, but it is a fragile place for future renderer cleanup.
- The Next Steps/help surfaces are not fully mode-aware and can lag recent workflow changes. They should be treated as supporting guidance, not as a stronger contract than the runtime code.
- Release metadata is not fully centralized. The About dialog in `main.js` still hardcodes a version string that can drift from `package.json`, which is a small but real source-of-truth mismatch.
- The highest-regression areas remain the monolithic renderer state machine and the monolithic Python pipeline. Changes around resume, staging, destination rules, or manifest semantics should still be treated as high-caution work even when the intended product behavior is clear.

## 14. Recommended agent boundaries

| Agent | Should handle | Should avoid | Most relevant sections of this document |
|---|---|---|---|
| **Coding agent** | Main-process changes, renderer logic changes, Python pipeline changes, test additions, bug fixes, path/resume/report behavior. | Marketing language decisions without product approval; speculative redesigns without grounding in code. | Sections 2 through 13. |
| **UI app agent** | HTML/CSS/UI hierarchy, modal clarity, flow polish, CTA clarity, state-driven UX refinement inside the desktop app. | Backend contract changes, path semantics changes, resume semantics changes unless coordinated with coding agent. | Sections 4, 5, 6, 7, 10, 13. |
| **Website agent** | Public website copy, walkthrough alignment, docs/FAQ consistency with the real product. | Inventing product claims the app does not implement today. | Sections 1, 4, 5, 6, 7, 13. |
| **Marketing agent** | Messaging, positioning, release notes, customer-facing explanations of modes and workflow. | Overstating guarantees such as “exact 500-file batches” or oversimplifying Cloud architecture. | Sections 1, 4, 5, 6, 7, 13. |
| **Release agent** | Packaging checks, build verification, artifact validation, release checklist, updater/license environment sanity. | Changing runtime contracts casually during release prep. | Sections 2, 3, 11, 12, 13. |
| **Security agent** | Renderer/main trust-boundary review, preload/API surface review, IPC exposure review, path-validation and symlink/canonicalization review, logging/privacy review, release-time binary trust review. | Product-copy or UX-only changes that do not materially affect trust boundaries, and speculative platform hardening that is not grounded in the current Electron/Python architecture. | Sections 2.5, 3, 8, 9, 12, 13. |
| **QA agent** | Manual verification plans, regression matrices, scenario-based testing across Computer/Cloud/retry/resume flows. | Treating static modal copy as the only source of product truth without checking code behavior. | Sections 5, 6, 7, 8, 9, 10, 11, 13. |

## Closing note

If a future agent needs to answer “what does DateBack do today,” it should start here, then verify specifics against the current code in:
- `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/main.js`
- `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/src/renderer.js`
- `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/src/renderer.helpers.js`
- `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/python/process_snapchat_memories.py`
- `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/python/batch_resume_logic.py`

Those files define the live product contract more directly than any planning note.
