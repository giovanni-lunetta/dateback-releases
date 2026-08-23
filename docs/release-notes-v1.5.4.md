# DateBack v1.5.4 - Memory Dates, Security Fixes & Reliability

**Release Date:** August 23, 2026
**Downloads:** [GitHub Releases — v1.5.4](https://github.com/giovanni-lunetta/dateback-releases/releases/tag/v1.5.4)

---

## What's New

### Fixed

**Memories now sort correctly in Photos — embedded date metadata written for the first time**

Filenames and file-system dates always showed the correct recovered date, but apps like Photos sort by the date embedded *inside* the media file itself (JPEG EXIF `DateTimeOriginal`/`DateTimeDigitized`/`DateTime`, and the MP4 `creation_time` container tag) — which DateBack never wrote. Photos would silently fall back to the import date, so memories landed under "today" instead of their real date. Every processing path now writes this embedded date, including Retry Corrupted Files: JPEGs get a lossless in-place EXIF patch (no recompression, no quality loss), and MP4s get the `creation_time` tag either baked into the existing overlay-merge ffmpeg pass (free) or via a lossless `-c copy` remux for plain (non-overlay) videos.

**`select-folder` sender-authorization sentinel collision**

A shared helper used `null` as both the "authorized" and "rejected" return value for one IPC handler, so its `if (result !== null)` check could never trip — the authorization check ran and logged, but its result was silently discarded. Now returns a real rejection object like every other handler.

**Renderer race conditions and missing guards**

- The `'complete'` progress event could pop the "all done" success modal over a run the user had just clicked Stop on, if the stop and finish raced.
- A malformed progress/complete event from the worker process could throw inside the renderer (missing `count`/`total`/`stats`) or write `NaN%`/`Infinity%` into the progress bar.
- The post-stop cleanup poll had no timeout — a hung worker process could leave the UI stuck indefinitely. Both the Stop-confirm and Pause-After-Batch flows are now bounded and share one de-duplicated helper.
- `start-processing` and `retry-corrupted` had no mutex against each other or themselves; a fast double-activation could spawn two organizer processes against the same output directory concurrently.

### Security

- Logger secret-key redaction now catches camelCase-compound keys (`authToken`, `sessionToken`, `clientSecret`, `bearerToken`, `idToken`, `cookieValue`, etc.) that the existing snake_case/kebab-case pattern missed; `redactPath` now also redacts `.zip` export filenames alongside the media extensions it already covered.
- Python `safe_extract` now checks for a symlinked path ancestor before creating a directory, not after (hardening).
- The CDN redirect-target allowlist no longer trusts the bare `cloudfront.net` suffix — redirect hops are validated against the same Snapchat-only suffix list as the initial request.
- `validateZipArchive` now rejects an oversized `memories_history.json` ZIP entry before reading it, closing the reachable path for GHSA-xcpc-8h2w-3j85 (adm-zip's uncapped `Buffer.alloc` on a declared entry size) without the breaking adm-zip 0.6.0 bump.
- Dependency updates: `electron-updater` → 6.8.9, `js-yaml` → 4.3.1, `brace-expansion` → 5.0.9 (all within already-satisfied semver ranges — cross-origin redirect header leak, quadratic-DoS, and DoS advisories respectively), Pillow 12.2.0 → 12.3.0 (13 CVEs closed, including a native heap out-of-bounds write reachable via the `resize()`/`paste()` coordinate paths this app calls directly on export-supplied images), new `piexif==1.1.3` dependency for EXIF read/write (MIT license, no known CVEs).

---

## Download

### macOS — Apple Silicon (M1/M2/M3/M4)
[DateBack-1.5.4-arm64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.5.4/DateBack-1.5.4-arm64.dmg)

**SHA256:**
```
feff594a7201e951aad277464af647425901aa035a6260bba0fe24d6532570bd
```

### macOS — Intel Mac (x86_64)
[DateBack-1.5.4-x64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.5.4/DateBack-1.5.4-x64.dmg)

**SHA256:**
```
0b81cfa5d1815ffe0c6a510251d788e46deda1b43e615eec47e970e7606927f2
```

### Windows 10 / 11 (x64)
[DateBack-1.5.4-x64-win.exe](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.5.4/DateBack-1.5.4-x64-win.exe)

**SHA256:**
```
b6469615ba60ab0074f5d174efbaf580dc0d5b3f80921daec2f51115b24815d1
```

---

## Verification

- `npm run test:all` passed: 144/144 Node tests
- Python: 104/104 tests passed (`python_process_snapchat_memories_runtime_test`, `python_batch_resume_logic_test`)
- `npm audit --omit=dev --audit-level=high`: 1 finding remains by version number (`adm-zip`, GHSA-xcpc-8h2w-3j85) — the one reachable call site in this app (`validateZipArchive`'s read of `memories_history.json`) is mitigated with an explicit size guard checked before the vulnerable call; documented, accepted exception rather than the breaking 0.6.0 bump
- `pip-audit -r python/requirements.txt` reported 0 vulnerabilities
- arm64 app bundle verified: `memory-organizer` and `ffmpeg` both `Mach-O 64-bit executable arm64`
- x64 app bundle verified: `memory-organizer` and `ffmpeg` both `Mach-O 64-bit executable x86_64`
- arm64 DMG notarized: Developer ID Application: GIOVANNI ANTHONY LUNETTA (ZK25MD36ZM); `spctl` confirms `accepted`, `source=Notarized Developer ID`
- x64 DMG notarized: same identity; `spctl` confirms `accepted`, `source=Notarized Developer ID`
- QA DMG (arm64) notarized and verified: `com.giovannilunetta.dateback.qa` / `DateBack QA` / `1.5.4`
- Windows binary: `memory-organizer.exe` and `ffmpeg.exe` both `PE32+ executable (console) x86-64`
- Real (non-mocked) end-to-end smoke test run against both the arm64 and x64 frozen `memory-organizer` binaries: confirmed `piexif` correctly bundled and writing valid EXIF into real output JPEGs

---

**Previous Version:** [v1.5.3](https://github.com/giovanni-lunetta/dateback-releases/releases/tag/v1.5.3)
**All Releases:** [github.com/giovanni-lunetta/dateback-releases/releases](https://github.com/giovanni-lunetta/dateback-releases/releases)
