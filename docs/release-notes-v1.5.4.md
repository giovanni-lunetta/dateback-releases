# DateBack v1.5.4 - Memory Dates & Reliability Improvements

**Release Date:** August 23, 2026
**Downloads:** [GitHub Releases — v1.5.4](https://github.com/giovanni-lunetta/dateback-releases/releases/tag/v1.5.4)

---

## What's New

### Fixed

**Memories now sort correctly in Photos**

Filenames and file dates always showed the correct recovered date, but apps like Photos sort by the date embedded inside the photo or video file itself — which DateBack wasn't writing. Photos would fall back to showing today's date instead. Every processing path now writes this embedded date, including Retry Corrupted Files, so memories land in the correct place in your library automatically.

**Reliability improvements**

Fixed several edge cases around stopping or pausing an active run, retrying failed files, and handling unexpected data from the background worker process, so the app behaves more predictably during long runs.

### Security

- Hardened an internal folder-selection permission check.
- Broadened redaction of sensitive data in diagnostic logs.
- Strengthened ZIP file validation and extraction safety checks.
- Updated several bundled dependencies to their latest secure versions.

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

- `npm run test:all` passed: 144/144 Node tests, plus the full Python test suite
- Full dependency audit reviewed at release time
- macOS builds are code-signed and notarized by Apple (Developer ID: GIOVANNI ANTHONY LUNETTA)
- Windows binary verified

---

**Previous Version:** [v1.5.3](https://github.com/giovanni-lunetta/dateback-releases/releases/tag/v1.5.3)
**All Releases:** [github.com/giovanni-lunetta/dateback-releases/releases](https://github.com/giovanni-lunetta/dateback-releases/releases)
