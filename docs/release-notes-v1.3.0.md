# DateBack v1.3.0 - Free Download Model

**Release Date:** May 5, 2026
**Download:** [DateBack-1.3.0-arm64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.3.0/DateBack-1.3.0-arm64.dmg)

---

## What's New

### Free Download, No Activation Key

DateBack is now a free Mac download. The app no longer requires a purchase, account, activation key, or Polar.sh license validation before processing memories.

### License Flow Removed

The Electron main process, preload bridge, renderer, and app HTML no longer expose license activation IPC handlers, license storage, or the activation modal. Local license-key persistence has been removed with the retired payment flow.

### Optional Support Link

The website now directs users to the latest GitHub Release for downloads and offers optional Buy Me A Coffee support. Donations do not unlock features; the app remains free whether or not a user donates.

### Release Metadata Cleanup

Package metadata now reflects a proprietary free-to-use distribution model, and app/website legal copy has been updated to describe the current privacy, terms, and donation behavior.

---

## Migration Notes

No action is required for existing users. Existing app settings, selected folders, resume state, and Google Photos connections are preserved. License keys are no longer required or checked.

---

## Download

### macOS (Apple Silicon)
[DateBack-1.3.0-arm64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.3.0/DateBack-1.3.0-arm64.dmg)

**SHA256:**
```
9645b44fdaeff05268796006d4cb607e65f61d50ac7a2f541c9d4abe859dc133
```

**Auto-update metadata SHA256:**
```
c48a9428742c0d01ffc6007af945966c7b630b3f06878cccb1a6561e658f52d2
```

### System Requirements
- macOS 11.0 (Big Sur) or later
- Apple Silicon (M1/M2/M3/M4) Mac
- 200 MB free disk space

---

## Release Gate

Before deploying website copy that advertises v1.3.0, verify that:
- `giovanni-lunetta/dateback-releases` is public
- GitHub `releases/latest` resolves to `v1.3.0`
- The release includes both `DateBack-1.3.0-arm64.dmg` and `latest-mac.yml`

---

## Changed Files

- `main.js` - removed Polar license validation, local license persistence, and license IPC handlers
- `preload.js` - removed license activation APIs from the renderer bridge
- `src/index.html` - removed license modal markup and Polar CSP allowance
- `src/renderer.js` - removed startup license checks and activation UI logic
- `src/styles.css` - removed license modal styles
- `package.json` - version 1.3.0, proprietary/free metadata, removed Polar-related dependencies
- `package-lock.json` - dependency graph updated after removing Polar-related dependencies
- `LICENSE` and `THIRD_PARTY_NOTICES.txt` - updated app and third-party license notices
- `CLAUDE.md` and `docs/BUILD.md` - release instructions updated for free distribution
- `test/*` - characterization coverage for free-build IPC, preload, renderer, and release metadata

---

## Documentation

- **Website:** [dateback.app](https://dateback.app)
- **Support:** support@dateback.app

---

**Previous Version:** [v1.2.1](https://github.com/giovanni-lunetta/dateback-releases/releases/tag/v1.2.1)
**All Releases:** [github.com/giovanni-lunetta/dateback-releases/releases](https://github.com/giovanni-lunetta/dateback-releases/releases)
