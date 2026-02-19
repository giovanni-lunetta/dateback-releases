# DateBack v1.1.0 - Auto-Upload, Cloud Mode & Security

**Release Date:** February 18, 2026
**Download:** [DateBack-1.1.0-arm64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.1.0/DateBack-1.1.0-arm64.dmg)

---

## ✨ What's New

### Auto-Upload Pipeline (Cloud Mode)

The biggest feature in v1.1.0 is a fully automated **Cloud Mode** that handles the entire memory delivery pipeline without manual intervention:

- **Automatic staging → upload → delete pipeline** — memories are staged locally, uploaded to a destination directory, then cleaned up automatically
- **Cache threshold management** — processing pauses when the staging cache reaches `--cache-gb` (default 5 GB) and resumes once it drops below `--cache-low-gb` (default 3 GB), protecting your local disk
- **Upload modes** — choose `copy` (default) or `move` to control how files reach the destination
- **Retry logic** — configurable `--max-upload-retries` before a fatal exit (default 20)
- **Staging directory control** — optionally specify a custom `--staging-dir` path

### Cloud UI
- Delivery stats in the success modal (uploaded count, upload errors)
- Cloud-specific headline and subtext copy in the success modal
- Cloud storage warning shown when local disk is low during a cloud run
- Mode indicator (COMPUTER / CLOUD / NONE) drives UI state throughout the session

### Security Hardening
- **Renderer document trust verification** — IPC calls are rejected if the renderer document is not trusted
- **IPC sender origin validation** — all handlers now validate `senderFrame.url` against the expected app origin
- `open-folder` handler now correctly approves the validated output directory produced by `start-processing` (previously rejected it)

### Snapchat Processing Improvements
- Substantially expanded memory processing logic with improved error handling across edge cases
- Dict-typed progress events forwarded correctly through IPC (previously dropped)
- Signal file renamed from `.memsavr_resume_signal` → `.dateback_resume_signal`

### UI & UX
- New styles and layout improvements throughout the app
- Pause-after-batch checkbox disabled and unchecked automatically in non-COMPUTER modes
- Improved visibility toggling during processing (running vs. stopped states)
- Stop button visibility correctly controlled by processing state

### Test Suite (65 tests)
- Full characterization test coverage across IPC handlers, renderer helpers, storage checks, processing UI transitions, and success modal
- Renderer helpers extracted into `src/renderer.helpers.js` for testability and separation of concerns
- Unified `npm run test:all` script (`check` + `test`)
- Tests cover security rejection paths, happy paths, and edge cases

---

## 🐛 Bug Fixes

- **`open-folder` rejection after `start-processing`** — the validated output directory is now approved for `open-folder` calls immediately after processing begins ([commit 0e8bed4](https://github.com/giovanni-lunetta/dateback-releases/commit/0e8bed4))

---

## 🔄 Migration Notes

### For Existing Users

**License Keys:**
- ✅ All existing license keys remain valid
- ✅ Activation is preserved automatically

**Settings & Data:**
- ✅ All settings automatically migrated
- ✅ Google Photos connection preserved

**Signal File Rename:**
- The internal resume signal file was renamed from `.memsavr_resume_signal` to `.dateback_resume_signal`
- This only affects in-progress batch runs at the moment of upgrade — if you upgrade mid-batch, simply restart the batch

---

## 📥 Download

### macOS (Apple Silicon)
[DateBack-1.1.0-arm64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.1.0/DateBack-1.1.0-arm64.dmg) (175 MB)

**SHA256:**
```
a5a02f025ce509ff6b90c210fc6e40d49f1462b8a130fa36d26f46faba2d5105
```

### System Requirements
- macOS 11.0 (Big Sur) or later
- Apple Silicon (M1/M2/M3) Mac
- 200 MB free disk space

---

## 🔧 Technical Details

### Key Commits
| Commit | Description |
|--------|-------------|
| `485a000` | Enhance security, Snapchat processing, and UI |
| `545dd66` | Add unified test scripts and stabilize no-force-exit test flow |
| `0e8bed4` | Fix: allow open-folder for validated output dir after start-processing |
| `faf304f` | Repo hygiene: ignore artifacts and remove junk |
| `b9dcae7` | Release: v1.1.0 |

### Changed Files
- `main.js` — IPC security, open-folder fix, session management
- `preload.js` — updated IPC bridge
- `src/renderer.js` — cloud mode UI, storage warnings, mode resolution
- `src/renderer.helpers.js` — extracted renderer helpers (new file)
- `src/index.html` — UI layout updates
- `src/styles.css` — new styles and layout improvements
- `python/cli.py` — auto-upload args, improved progress forwarding
- `python/process_snapchat_memories.py` — expanded processing, signal file rename

---

## 📚 Documentation

- **Website:** [dateback.app](https://dateback.app)
- **Privacy Policy:** [dateback.app/privacy-policy.html](https://dateback.app/privacy-policy.html)
- **Terms of Service:** [dateback.app/terms-of-service.html](https://dateback.app/terms-of-service.html)
- **Support:** support@dateback.app

---

**Previous Version:** [v1.0.9](https://github.com/giovanni-lunetta/dateback-releases/releases/tag/v1.0.9)
**All Releases:** [github.com/giovanni-lunetta/dateback-releases/releases](https://github.com/giovanni-lunetta/dateback-releases/releases)
