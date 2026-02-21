# DateBack v1.1.2 - Polar Sandbox Guard

**Release Date:** February 21, 2026
**Download:** [DateBack-1.1.2-arm64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.1.2/DateBack-1.1.2-arm64.dmg)

---

## ✨ What's New

### Polar Sandbox Validation Mode

Added a double-guarded sandbox mode for internal QA and license validation testing:

- **Default is always production** — `https://api.polar.sh` is used unless both guard flags are explicitly set
- Sandbox is only activated when **both** conditions are true:
  - `DATEBACK_POLAR_ENV=sandbox`
  - `DATEBACK_ALLOW_SANDBOX=1`
- Sandbox org ID is read from `POLAR_ORG_ID_SANDBOX` (with fallbacks)
- Protects against accidental sandbox use in production builds

**Tests added (3 new):**
- `validate-license default config targets production Polar endpoint and fallback org`
- `validate-license sandbox env falls back to production unless allow flag is enabled`
- `validate-license sandbox mode targets sandbox Polar endpoint and sandbox org id when allow flag is set`

---

## 🔄 Migration Notes

No action required for end users. This change is internal — all production behavior is identical to v1.1.1.

**License Keys:** All existing keys remain valid.

---

## 📥 Download

### macOS (Apple Silicon)
[DateBack-1.1.2-arm64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.1.2/DateBack-1.1.2-arm64.dmg) (175 MB)

**SHA256:**
```
3ad25d3dc22eb9b5bf3401e45170589912602d886bd74080cfd057d1b1263a3a
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
| `d6e3385` | Feat: add Polar sandbox validation mode with allow-flag guard |
| `f79b42b` | Release: v1.1.2 |

### Changed Files
- `main.js` — `getPolarLicenseValidationConfig()` with double-flag sandbox guard
- `package.json` — version 1.1.2
- `package-lock.json` — version 1.1.2
- `test/` — 3 new `validate-license` characterization tests

---

## 📚 Documentation

- **Website:** [dateback.app](https://dateback.app)
- **Support:** support@dateback.app

---

**Previous Version:** [v1.1.1](https://github.com/giovanni-lunetta/dateback-releases/releases/tag/v1.1.1)
**All Releases:** [github.com/giovanni-lunetta/dateback-releases/releases](https://github.com/giovanni-lunetta/dateback-releases/releases)
