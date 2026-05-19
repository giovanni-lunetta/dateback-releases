# DateBack v1.5.3 - Security & Reliability Fixes

**Release Date:** May 18, 2026
**Downloads:** [GitHub Releases — v1.5.3](https://github.com/giovanni-lunetta/dateback-releases/releases/tag/v1.5.3)

---

## What's New

### Security Fixes

**Retry output path traversal — constrained filename generation**

The retry workflow derives a filename stem from the `Date` field stored in `detailed_report.json`. A maliciously crafted report entry could have produced an absolute path or a name containing path separators, causing the retry output file to be written outside the intended output directory. The date field is now validated against an allowlist regex before use; entries with unsafe values are recorded as errors rather than written.

**Logger secret redaction — broadened key matching**

Several common secret-bearing property names (`access_token`, `refresh_token`, `Authorization`, `client_secret`, nested `PASSWORD`, and bare `key`) were not matched by the previous exact-match list. A pattern-based approach now covers these and related variants (e.g. `api_key`, `session`, `cookie`, `signature`, `private_key`) regardless of casing or word-boundary style.

### Bug Fixes

**Malformed Saved Media rows — crash prevention**

If a `memories_history.json` file contained non-object entries in the `Saved Media` array (e.g. a bare string or number), the worker would throw an `AttributeError` during processing. Malformed rows are now filtered and counted before the main loop; a warning is printed and the count is reported in the final stats.

**Legacy non-ZIP HEAD failure — silent skip removed**

In non-ZIP mode, when the remote file size HEAD request returned no response, the entry was silently marked as `Skipped`. The entry is now forwarded to the download attempt path instead, giving it a chance to be retrieved even when the HEAD check fails.

**Retry stats stdout — raw CDN tokens removed from pipe**

The retry completion message sent over stdout to the Electron main process now contains only the scalar stats (success/error/duplicate counts). The full per-entry results list, which could include raw Snapchat CDN query tokens, is no longer serialised over the IPC pipe.

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
- `npm audit --omit=dev` reported 0 vulnerabilities
- `pip-audit -r python/requirements.txt` reported 0 vulnerabilities
- arm64 app bundle verified: `memory-organizer` and `ffmpeg` both `Mach-O 64-bit executable arm64`
- x64 app bundle verified: `memory-organizer` and `ffmpeg` both `Mach-O 64-bit executable x86_64`
- arm64 DMG notarized: Developer ID Application: GIOVANNI ANTHONY LUNETTA (ZK25MD36ZM)
- x64 DMG notarized: Developer ID Application: GIOVANNI ANTHONY LUNETTA (ZK25MD36ZM)
- Windows binary: `memory-organizer.exe` and `ffmpeg.exe` both `PE32+ executable (console) x86-64`

---

**Previous Version:** [v1.5.2](https://github.com/giovanni-lunetta/dateback-releases/releases/tag/v1.5.2)
**All Releases:** [github.com/giovanni-lunetta/dateback-releases/releases](https://github.com/giovanni-lunetta/dateback-releases/releases)
