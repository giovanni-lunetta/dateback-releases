# DateBack v1.5.1 - Security & Bug Fixes

**Release Date:** May 15, 2026
**Downloads:** [GitHub Releases — v1.5.1](https://github.com/giovanni-lunetta/dateback-releases/releases/tag/v1.5.1)

---

## What's New

### Security Hardening

- ZIP path is now authorized against the file-picker approval set before being passed to the subprocess — paths outside the user's home directory must be explicitly chosen with the picker
- Destination and staging directories are checked against the approval set before creation, preventing unapproved directory creation
- Batch output directories (`Batch_01`, etc.) are created without following symlink entries; existing symlinked Batch_ directories are rejected at scan, creation, and retry time
- ZIP central-directory metadata is validated before indexing: 250,000-member cap, 5 TB declared-size cap, and symlink-member blocking
- Duplicate ZIP member paths across multi-part exports are detected and rejected at index time
- Windows drive roots (`C:\`) and network share roots (`\\server\share`) are now explicitly blocked as output directories
- URL query strings and common secret assignments (`token=`, `sig=`, etc.) are redacted from human-readable error reports

### Bug Fixes

- Overlay merge failure now saves the main image instead of writing an error record — users get the photo even when the overlay cannot be composited
- Manifest index replay is bounded by the actual number of memories in the export, preventing runaway expansion from malformed manifests
- Approved-directory Sets are cleared and correctly repopulated at the start of each new run — fixes cloud-mode runs breaking after the first launch of a session
- Logger `redactPath` now strips `/var/folders` and `/Volumes` paths from log output
- Logger `flush()` performs a second drain to capture entries enqueued during the first drain pass
- `getLastTimestamp` in support-logs rewritten with async `fs.promises` (removes sync I/O from thread executor)
- `btnFindZip` handler guards against re-entry while a scan is already running
- Warning modals resolve any prior pending call before opening a new one

---

## Download

### macOS — Apple Silicon (M1/M2/M3/M4)
[DateBack-1.5.1-arm64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.5.1/DateBack-1.5.1-arm64.dmg)

**SHA256:**
```
379cfb49d1df070596c5245593eb6d8f2e21257d507183b332ac15fc921a2b3f
```

### macOS — Intel Mac (x86_64)
[DateBack-1.5.1-x64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.5.1/DateBack-1.5.1-x64.dmg)

**SHA256:**
```
ce2f505d2abcc36c721c8b7f7abf0599ac62d9d620c6063d6c520d79e44f1548
```

### Windows 10 / 11 (x64)
[DateBack-1.5.1-x64-win.exe](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.5.1/DateBack-1.5.1-x64-win.exe)

**SHA256:**
```
213b6f512dcbdfeaf21834bbfdd94fb959df79787de5f3654fcaf11a3d2c705e
```

---

## Verification

- `npm run test:all` passed: 130/130 Node tests
- `npm audit --omit=dev` reported 0 vulnerabilities
- `pip-audit -r python/requirements.txt` reported 0 vulnerabilities
- arm64 app bundle verified: `memory-organizer` and `ffmpeg` both `Mach-O 64-bit executable arm64`
- x64 app bundle verified: `memory-organizer` and `ffmpeg` both `Mach-O 64-bit executable x86_64`
- arm64 DMG notarized: Developer ID Application: GIOVANNI ANTHONY LUNETTA (ZK25MD36ZM)
- x64 DMG notarized: Developer ID Application: GIOVANNI ANTHONY LUNETTA (ZK25MD36ZM)
- Windows binary: `memory-organizer.exe` and `ffmpeg.exe` both `PE32+ executable (console) x86-64`

---

**Previous Version:** [v1.5.0](https://github.com/giovanni-lunetta/dateback-releases/releases/tag/v1.5.0)
**All Releases:** [github.com/giovanni-lunetta/dateback-releases/releases](https://github.com/giovanni-lunetta/dateback-releases/releases)
