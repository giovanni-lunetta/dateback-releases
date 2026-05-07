# DateBack v1.4.0 - Multi-ZIP Recovery

**Release Date:** May 6, 2026
**Download:** [DateBack-1.4.0-arm64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.4.0/DateBack-1.4.0-arm64.dmg)

---

## What's New

### Multi-ZIP Snapchat Exports

DateBack now discovers and processes companion Snapchat export archives such as `mydata~1234-2.zip` and `mydata~1234-3.zip` alongside the primary `mydata~1234.zip`. The app can organize the full ZIP set into the DateBack container folder, index media across all companion ZIPs, and route processing to the correct archive.

### Main and Overlay Pairing

Newer Snapchat exports can store edited memories as top-level sibling files such as `*-main.jpg` / `*-overlay.jpg` and `*-main.mp4` / `*-overlay.jpg`. DateBack now detects those sibling overlays and applies the same recovery path used for overlay ZIP memories.

### Free Download Model

The app no longer requires Polar activation or a license key. Downloads are distributed through GitHub Releases, and Buy Me A Coffee support is optional.

---

## Reliability and Security Fixes

- Trust-manifest resume checks now use a companion-aware ZIP-set fingerprint.
- Multi-ZIP organize operations reject destination escapes and ZIP filename collisions before moving files.
- The retry-search flow now handles expanded ZIP discovery results correctly.
- Companion ZIP routing no longer mutates shared registry state during threaded processing.
- Website release copy, changelog, privacy posture, CSP, and release tests now match the free/no-tracking model.

---

## Download

### macOS (Apple Silicon)
[DateBack-1.4.0-arm64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.4.0/DateBack-1.4.0-arm64.dmg)

**SHA256:**
```
f1492f84b776d34b501f1753d42246193019a3a9e673d461af622ab5e2595797
```

**Auto-update metadata SHA256:**
```
bde198f0f3a52a7ecac3606ff840f034861ef77862016bf851b683a2e421b383
```

---

## Verification

- `npm run test:all` passed: 105/105 Node tests
- `python3 test/python_process_snapchat_memories_runtime_test.py` passed: 41/41 Python runtime tests
- `python3 test/python_batch_resume_logic_test.py` passed: 16/16 resume tests
- `npm audit --omit=dev` reported 0 vulnerabilities
- Production and QA app bundles verified as `Notarized Developer ID`
- Production DMG contains both bundled runtime binaries: `memory-organizer` and `ffmpeg`

---

**Previous Version:** [v1.3.1](https://github.com/giovanni-lunetta/dateback-releases/releases/tag/v1.3.1)
**All Releases:** [github.com/giovanni-lunetta/dateback-releases/releases](https://github.com/giovanni-lunetta/dateback-releases/releases)
