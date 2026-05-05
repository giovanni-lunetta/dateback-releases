# DateBack v1.3.1 - Blank-URL ZIP Export Hotfix

**Release Date:** May 5, 2026
**Download:** [DateBack-1.3.1-arm64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.3.1/DateBack-1.3.1-arm64.dmg)

---

## What's Fixed

### Local Media Files in New Snapchat Exports

Some Snapchat exports include media files inside the ZIP under `memories/` while leaving both `Download Link` and `Media Download Url` blank in `json/memories_history.json`. DateBack v1.3.0 treated those rows as skipped before checking the local ZIP media files, which could finish with zero extracted files and no clear error.

DateBack now indexes local ZIP media members by stored timestamp and media type, then uses those local files when download URL fields are blank. Rows with neither a local ZIP media file nor a download URL are reported as missing instead of silently skipped.

### Root JSON Layout

The worker now accepts both `json/memories_history.json` and prefixed `*/json/memories_history.json` layouts.

---

## Download

### macOS (Apple Silicon)
[DateBack-1.3.1-arm64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.3.1/DateBack-1.3.1-arm64.dmg)

**SHA256:**
```
240891de08b98c95bf9c2f2be6ddf4ef71fd0dc593eecded94f024eb592d4573
```

**Auto-update metadata SHA256:**
```
1fe7ca1112fa81268a73d55a78cc2453f49b2ba392c151667c9f0c3b7a5b420e
```

---

## Verification

- Added a regression test for blank download URLs with local `memories/YYYY-MM-DD_UUID-main.*` ZIP files
- Verified the rebuilt `assets/bin/memory-organizer` binary processes the blank-URL ZIP fixture
- Dry-matched the reported real export and found 1,030 local media files claimable from the ZIP

---

**Previous Version:** [v1.3.0](https://github.com/giovanni-lunetta/dateback-releases/releases/tag/v1.3.0)
**All Releases:** [github.com/giovanni-lunetta/dateback-releases/releases](https://github.com/giovanni-lunetta/dateback-releases/releases)
