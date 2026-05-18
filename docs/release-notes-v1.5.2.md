# DateBack v1.5.2 - Cloud Mode Resume Fixes

**Release Date:** May 18, 2026
**Downloads:** [GitHub Releases — v1.5.2](https://github.com/giovanni-lunetta/dateback-releases/releases/tag/v1.5.2)

---

## What's New

### Bug Fixes

**Cloud mode resume — verification message false positive**

When resuming a Cloud mode run that had CDN failures in a prior session, the final summary could incorrectly show "All memories recovered!" The check now correctly attributes losses from prior sessions.

**Cloud mode resume — misleading image/video counts**

In Cloud mode, the image and video counts shown in the success summary reflected only the current session instead of the cumulative totals across all sessions. Both counts are now persisted to the batch manifest and accumulated correctly on resume.

**Resume log — spurious "Will continue filling it." message**

On resume, a log line "Will continue filling it." could appear for an incomplete batch that was not actually going to be backfilled. The misleading phrase has been removed.

---

## Download

### macOS — Apple Silicon (M1/M2/M3/M4)
[DateBack-1.5.2-arm64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.5.2/DateBack-1.5.2-arm64.dmg)

**SHA256:**
```
3023e8e58fb7a68336929b1c7f3fa157c42cc42686a32863f1fcdc183432acc0
```

### macOS — Intel Mac (x86_64)
[DateBack-1.5.2-x64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.5.2/DateBack-1.5.2-x64.dmg)

**SHA256:**
```
2321d0a27ee6b1d611bbf38198f3a2e94742c1c735cb7e8087c7c0f6436c0f0f
```

### Windows 10 / 11 (x64)
[DateBack-1.5.2-x64-win.exe](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.5.2/DateBack-1.5.2-x64-win.exe)

**SHA256:**
```
283e977f006428224bc164d95f1fa2ffdb16935dbe8a3081fe0ac2a2dc10d389
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

### Release metadata repair

After publishing v1.5.2, the missing `DateBack-1.5.2-arm64-mac.zip` updater asset was uploaded so the public Mac updater metadata references only available assets.

---

**Previous Version:** [v1.5.1](https://github.com/giovanni-lunetta/dateback-releases/releases/tag/v1.5.1)
**All Releases:** [github.com/giovanni-lunetta/dateback-releases/releases](https://github.com/giovanni-lunetta/dateback-releases/releases)
