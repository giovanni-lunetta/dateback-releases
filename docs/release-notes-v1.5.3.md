# DateBack v1.5.3 - Security & Reliability Fixes

**Release Date:** May 18, 2026
**Downloads:** [GitHub Releases — v1.5.3](https://github.com/giovanni-lunetta/dateback-releases/releases/tag/v1.5.3)

---

## What's New

### Security Fixes

- Strengthened validation of retry-generated filenames.
- Broadened redaction of sensitive data in diagnostic logs to catch more key-naming variants.

### Bug Fixes

- Malformed entries in a Snapchat export's memory list no longer crash the worker — they're now filtered, counted, and reported in the final stats.
- A failed remote file-size check in non-ZIP mode no longer silently skips the entry; it now proceeds to the download attempt.
- Reduced the amount of raw diagnostic data included in retry completion output sent to the app.

---

## Download

### macOS — Apple Silicon (M1/M2/M3/M4)
[DateBack-1.5.3-arm64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.5.3/DateBack-1.5.3-arm64.dmg)

**SHA256:**
```
25ff55995ead05dfa6d09711bc24136289f4c559cbcbd9046820387b3895086b
```

### macOS — Intel Mac (x86_64)
[DateBack-1.5.3-x64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.5.3/DateBack-1.5.3-x64.dmg)

**SHA256:**
```
a1e9daf8583afbb056c3f8150fd6b72a039f9754440c3064422b771a62ce1cd9
```

### Windows 10 / 11 (x64)
[DateBack-1.5.3-x64-win.exe](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.5.3/DateBack-1.5.3-x64-win.exe)

**SHA256:**
```
409aaf9867d517030d5d1a0ad31cde24e47153958e096aa320376496d54e1fd2
```

---

## Verification

- `npm run test:all` passed: 132/132 Node tests
- Full dependency audit reported 0 outstanding vulnerabilities at release time
- macOS builds are code-signed and notarized by Apple (Developer ID: GIOVANNI ANTHONY LUNETTA)
- Windows binary verified

---

**Previous Version:** [v1.5.2](https://github.com/giovanni-lunetta/dateback-releases/releases/tag/v1.5.2)
**All Releases:** [github.com/giovanni-lunetta/dateback-releases/releases](https://github.com/giovanni-lunetta/dateback-releases/releases)
