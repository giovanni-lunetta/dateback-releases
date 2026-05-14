# DateBack v1.5.0 - Windows & Intel Mac Support

**Release Date:** May 14, 2026
**Downloads:** [GitHub Releases — v1.5.0](https://github.com/giovanni-lunetta/dateback-releases/releases/tag/v1.5.0)

---

## What's New

### Windows 10 / 11 Support

DateBack is now available for Windows 10 and 11 (x64). The Windows release ships as a signed NSIS installer (`DateBack-1.5.0-x64-win.exe`) that installs per-user with no admin rights required. It includes bundled FFmpeg 8.1.1 and the Windows memory-organizer binary — no external dependencies needed.

Windows users may see a SmartScreen prompt on first launch while the app builds download reputation. Clicking **More info → Run anyway** proceeds past it.

### Intel Mac Support

DateBack now ships a dedicated x64 DMG (`DateBack-1.5.0-x64.dmg`) for Intel Mac users (Core i5/i7/i9). The Intel build includes a native x86_64 FFmpeg binary and an x86_64 memory-organizer compiled via Rosetta on Apple Silicon.

### Sleep Prevention on Windows

The Windows build prevents the machine from sleeping during processing using the Win32 `SetThreadExecutionState` API (equivalent to `caffeinate -i` on macOS), keeping long exports alive without requiring screen lock to be disabled.

---

## Security

- Upgraded Pillow 12.0.0 → 12.2.0 (fixes CVE-2026-25990, CVE-2026-40192, CVE-2026-42308, CVE-2026-42309, CVE-2026-42310, CVE-2026-42311)
- Upgraded requests 2.32.5 → 2.33.0 (fixes CVE-2026-25645)

---

## Download

### macOS — Apple Silicon (M1/M2/M3/M4)
[DateBack-1.5.0-arm64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.5.0/DateBack-1.5.0-arm64.dmg)

**SHA256:**
```
337ee858daf9cb51a1bb50da1cf8446a2ee4687769a447dad4948ef8d7334b6f
```

### macOS — Intel Mac (x86_64)
[DateBack-1.5.0-x64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.5.0/DateBack-1.5.0-x64.dmg)

**SHA256:**
```
5a49bdf13604367a2a6b1bdfc06c3494192065d1bd455096823fca028e0121c2
```

### Windows 10 / 11 (x64)
[DateBack-1.5.0-x64-win.exe](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.5.0/DateBack-1.5.0-x64-win.exe)

**SHA256:**
```
4f646385e091a3f6be499b95f35bc8bcce5a729c0d237ff5c264aaedd2933080
```

---

## Verification

- `npm run test:all` passed: 123/123 Node tests
- `npm audit --omit=dev` reported 0 vulnerabilities
- `pip-audit -r python/requirements.txt` reported 0 vulnerabilities
- arm64 app bundle verified: `memory-organizer` and `ffmpeg` both `Mach-O 64-bit executable arm64`
- x64 app bundle verified: `memory-organizer` and `ffmpeg` both `Mach-O 64-bit executable x86_64`
- arm64 DMG notarized: Developer ID Application: GIOVANNI ANTHONY LUNETTA (ZK25MD36ZM)
- x64 DMG notarized: Developer ID Application: GIOVANNI ANTHONY LUNETTA (ZK25MD36ZM)
- Windows binary: `memory-organizer.exe` and `ffmpeg.exe` both `PE32+ executable (console) x86-64`

---

**Previous Version:** [v1.4.4](https://github.com/giovanni-lunetta/dateback-releases/releases/tag/v1.4.4)
**All Releases:** [github.com/giovanni-lunetta/dateback-releases/releases](https://github.com/giovanni-lunetta/dateback-releases/releases)
