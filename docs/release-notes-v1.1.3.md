# DateBack v1.1.3 - Build Reliability + Polar Sandbox Support

**Release Date:** March 11, 2026
**Download:** [DateBack-1.1.3-arm64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.1.3/DateBack-1.1.3-arm64.dmg)

---

## What's New

### Explicit Binary Packaging (Build Reliability)

Replaced the directory-glob `extraResources` copy with explicit per-file mappings for `memory-organizer` and `ffmpeg`. This eliminates cases where electron-builder config overrides (such as QA builds using `--config`) silently dropped the binaries, causing `spawn ENOENT` errors at startup.

- `assets/bin/memory-organizer` → `Contents/Resources/bin/memory-organizer`
- `assets/bin/ffmpeg` → `Contents/Resources/bin/ffmpeg`

### Polar Sandbox API Host Fix (QA/Internal Only)

Corrected the Polar sandbox API host from `sandbox.polar.sh` (returned HTTP 404) to `sandbox-api.polar.sh` (correct host). This fix only affects the internal QA build — sandbox mode requires `DATEBACK_ALLOW_SANDBOX=1` and is never active in production builds.

---

## Migration Notes

No action required for end users. Production behavior is identical to v1.1.2. All existing license keys remain valid.

---

## Download

### macOS (Apple Silicon)
[DateBack-1.1.3-arm64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.1.3/DateBack-1.1.3-arm64.dmg) (175 MB)

**SHA256:**
```
62e0e3b3835863f04e1cb4bf26ecb77b0773bb5b37529498dfcef9aaaca09077
```

### System Requirements
- macOS 11.0 (Big Sur) or later
- Apple Silicon (M1/M2/M3) Mac
- 200 MB free disk space

---

## Technical Details

### Key Commits
| Commit | Description |
|--------|-------------|
| `25afc25` | Fix: use correct Polar sandbox API host (sandbox-api.polar.sh) |
| `dfbe70c` | Fix: use explicit file mappings for extraResources bin packaging |
| `aa42e98` | Release: v1.1.3 |

### Changed Files
- `main.js` — `POLAR_SANDBOX_BASE_URL` corrected to `https://sandbox-api.polar.sh`
- `package.json` — `extraResources` explicit file mappings; version 1.1.3
- `package-lock.json` — version 1.1.3
- `test/main.ipc.characterization.test.js` — sandbox URL assertion updated

---

## Documentation

- **Website:** [dateback.app](https://dateback.app)
- **Support:** support@dateback.app

---

**Previous Version:** [v1.1.2](https://github.com/giovanni-lunetta/dateback-releases/releases/tag/v1.1.2)
**All Releases:** [github.com/giovanni-lunetta/dateback-releases/releases](https://github.com/giovanni-lunetta/dateback-releases/releases)
