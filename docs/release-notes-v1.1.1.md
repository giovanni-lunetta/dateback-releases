# DateBack v1.1.1 - Startup Fix & Branding Cleanup

**Release Date:** February 20, 2026
**Download:** [DateBack-1.1.1-arm64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.1.1/DateBack-1.1.1-arm64.dmg)

---

## 🐛 Bug Fixes

### Startup Crash Fix (Critical)

**Fixed packaged app startup crash when `.env` is missing.**

In production builds, the app was calling `dotenv.config()` unconditionally at startup. When the `.env` file was absent (as it always is in a packaged distribution), this caused a crash before the app window could open.

The fix adds a guard that only loads `.env` in development environments, making packaged builds safe regardless of whether a `.env` file is present.

- **Affected:** All users on v1.1.0 packaged builds
- **Commit:** [b819614](https://github.com/giovanni-lunetta/dateback-releases/commit/b819614)
- **Test added:** `main.js guards dotenv startup loading`

### Branding Cleanup

Removed the last remaining `MemSavr` references from the Python CLI:
- `cli.py` module docstring updated: `CLI wrapper for MemSavr` → `CLI wrapper for DateBack`
- `argparse` description updated: `MemSavr CLI` → `DateBack CLI`

---

## 🔄 Migration Notes

**License Keys:** All existing keys remain valid.
**Settings & Data:** Automatically preserved — no action required.

---

## 📥 Download

### macOS (Apple Silicon)
[DateBack-1.1.1-arm64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.1.1/DateBack-1.1.1-arm64.dmg) (175 MB)

**SHA256:**
```
bbd2a0287e06a85f0faffc45828823649dbca75cd65af89e449dfb331416f605
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
| `b819614` | Fix: prevent packaged startup crash when dotenv is missing |
| `043a6fc` | Release: v1.1.1 (version bump + branding cleanup) |

### Changed Files
- `main.js` — dotenv guard (dev-only load)
- `package.json` — version 1.1.1
- `package-lock.json` — version 1.1.1
- `python/cli.py` — MemSavr → DateBack branding
- `test/main.dotenv.guard.test.js` — new test (added in b819614)

---

## 📚 Documentation

- **Website:** [dateback.app](https://dateback.app)
- **Support:** support@dateback.app

---

**Previous Version:** [v1.1.0](https://github.com/giovanni-lunetta/dateback-releases/releases/tag/v1.1.0)
**All Releases:** [github.com/giovanni-lunetta/dateback-releases/releases](https://github.com/giovanni-lunetta/dateback-releases/releases)
