# DateBack App Source — Claude Instructions

## Release Process

### Overview

All releases are patch/minor bumps on `main`. No release branches. The GitHub remote is `giovanni-lunetta/dateback-releases` (private). The website repo is separate and its changes must never be committed/pushed by the release agent — leave them uncommitted and report the diff.

---

### Step-by-step: cutting a release

#### 1. Pre-flight checks

```bash
git status --short     # must be clean (only untracked dist* dirs allowed)
git branch -v          # must be on main, up to date
```

If dirty: stash or commit any in-progress work before proceeding.

#### 2. Version bump

Version lives in **two places only** — both must be updated:

- `package.json` → `"version"` field (line ~3)
- `package-lock.json` → top-level `"version"` field AND `packages[""].version` field

`main.js` reads version dynamically via `app.getVersion()` — no hardcode there.

```bash
# Verify after editing
node -e "const p=require('./package.json'); console.log(p.version)"
node -e "const p=require('./package-lock.json'); console.log(p.version, p.packages[''].version)"
```

#### 3. Tests — must be green before building

```bash
npm ci
npm run test:all      # runs: node --check main.js + renderer files, then node --test (69 tests)
```

Do not proceed if any test fails.

#### 4. Commit the version bump

```bash
git add package.json package-lock.json
git commit -m "Release: vX.Y.Z"
```

#### 5. Production build (sign + notarize)

Load Apple credentials from `../.env` (one level up, in `DateBack_Business/`):

```bash
source ../.env && export APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID
npm run build:mac
```

Output: `dist/DateBack-X.Y.Z-arm64.dmg`

**Verify binaries inside the built .app:**
```bash
ls -lh dist/mac-arm64/DateBack.app/Contents/Resources/bin/
# must show: ffmpeg (59 MB) and memory-organizer (26 MB)
```

**Mount and verify DMG:**
```bash
hdiutil attach dist/DateBack-X.Y.Z-arm64.dmg -nobrowse -quiet
ls -lh "/Volumes/DateBack X.Y.Z-arm64/DateBack.app/Contents/Resources/bin/"
hdiutil detach "/Volumes/DateBack X.Y.Z-arm64" -quiet
```

**Compute SHA256:**
```bash
shasum -a 256 dist/DateBack-X.Y.Z-arm64.dmg
```

**Place artifacts:**
```bash
mkdir -p /Users/giovanni-lunetta/DateBack_Business/Builds/releases/vX.Y.Z
cp dist/DateBack-X.Y.Z-arm64.dmg /Users/giovanni-lunetta/DateBack_Business/Builds/releases/vX.Y.Z/
cp dist/DateBack-X.Y.Z-arm64.dmg /Users/giovanni-lunetta/DateBack_Business/Builds/latest/
```

#### 6. QA build (internal only — do NOT upload to GitHub)

Use an external config file so electron-builder config overrides don't silently drop binaries.
The QA config must always include explicit `extraResources` file mappings (not glob).

Write `/tmp/dateback-qa-build.json`:
```json
{
  "appId": "com.giovannilunetta.dateback.qa",
  "productName": "DateBack QA",
  "publish": null,
  "mac": {
    "extendInfo": {
      "LSEnvironment": {
        "DATEBACK_POLAR_ENV": "sandbox",
        "DATEBACK_ALLOW_SANDBOX": "1",
        "POLAR_ORG_ID_SANDBOX": "f8d31d6a-6539-41dc-be45-a0ee5b9ed660"
      }
    },
    "target": { "target": "dmg", "arch": ["arm64"] }
  },
  "extraResources": [
    { "from": "assets/bin/memory-organizer", "to": "bin/memory-organizer" },
    { "from": "assets/bin/ffmpeg", "to": "bin/ffmpeg" }
  ],
  "directories": { "output": "dist-qa" },
  "artifactName": "DateBack-X.Y.Z-QA-sandbox-arm64.dmg"
}
```

Build:
```bash
source ../.env && export APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID
npx electron-builder --config /tmp/dateback-qa-build.json --mac
```

Output: `dist-qa/DateBack-X.Y.Z-QA-sandbox-arm64.dmg`

**Verify binaries in QA .app:**
```bash
ls -lh "dist-qa/mac-arm64/DateBack QA.app/Contents/Resources/bin/"
```

**Verify Info.plist LSEnvironment and bundle ID:**
```bash
hdiutil attach "dist-qa/DateBack-X.Y.Z-QA-sandbox-arm64.dmg" -nobrowse -quiet
plutil -p "/Volumes/DateBack QA X.Y.Z-arm64/DateBack QA.app/Contents/Info.plist" | grep -E "CFBundleIdentifier|CFBundleName|CFBundleShortVersionString|LSEnvironment" -A 8
hdiutil detach "/Volumes/DateBack QA X.Y.Z-arm64" -quiet
```

Expected plist values:
- `CFBundleIdentifier` = `com.giovannilunetta.dateback.qa`
- `CFBundleName` = `DateBack QA`
- `LSEnvironment.DATEBACK_POLAR_ENV` = `sandbox`
- `LSEnvironment.DATEBACK_ALLOW_SANDBOX` = `1`
- `LSEnvironment.POLAR_ORG_ID_SANDBOX` = `f8d31d6a-6539-41dc-be45-a0ee5b9ed660`

**Place QA artifact:**
```bash
cp dist-qa/DateBack-X.Y.Z-QA-sandbox-arm64.dmg \
   /Users/giovanni-lunetta/DateBack_Business/Builds/releases/vX.Y.Z/
```

#### 7. Tag, push, create GitHub Release

```bash
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z

# GH_TOKEN env var must NOT be set (use keyring auth instead):
unset GH_TOKEN
gh release create vX.Y.Z \
  /Users/giovanni-lunetta/DateBack_Business/Builds/releases/vX.Y.Z/DateBack-X.Y.Z-arm64.dmg \
  --repo giovanni-lunetta/dateback-releases \
  --title "DateBack vX.Y.Z – <short title>" \
  --notes "<release notes>"
```

Upload **production DMG only**. Never upload the QA DMG to GitHub Releases.

#### 8. Release notes doc (in-repo)

Create `docs/release-notes-vX.Y.Z.md` following the pattern of previous release notes (see [v1.1.3](docs/release-notes-v1.1.3.md) as the latest template).

Add an entry to `docs/README.md` under the release notes list.

Commit and push:
```bash
git add docs/release-notes-vX.Y.Z.md docs/README.md
git commit -m "Docs: release notes vX.Y.Z"
git push origin main
```

#### 9. Website changelog (DO NOT commit or push)

File: `/Users/giovanni-lunetta/DateBack_Business/DateBack_Website/changelog.html`

- Add a new `<details class="changelog-entry" open>` block at the top for the new version.
- Change the previously-latest entry's `<details>` to remove the `open` attribute.
- Leave the file modified but **unstaged/uncommitted**. Report the diff to the user.

---

### Notarization

Notarization is handled automatically by electron-builder (`"notarize": true` in `package.json` build config). Both production and QA builds are notarized with the same Developer ID (`ZK25MD36ZM`). No manual `notarytool` invocation needed.

Credentials required (from `../.env`):
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

---

### Deliverables checklist

After every release, report:

- [ ] Commit hashes for: version bump, docs commit
- [ ] Tag pushed (`vX.Y.Z`)
- [ ] GitHub Release URL
- [ ] `ls` evidence that both DMGs contain `Contents/Resources/bin/memory-organizer` and `Contents/Resources/bin/ffmpeg`
- [ ] SHA256 of production DMG
- [ ] SHA256 of QA DMG
- [ ] Notarization status (both builds)
- [ ] Website changelog diff (uncommitted)

---

### Key paths

| What | Path |
|---|---|
| App source | `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/` |
| Env vars | `/Users/giovanni-lunetta/DateBack_Business/.env` |
| Release artifacts | `/Users/giovanni-lunetta/DateBack_Business/Builds/releases/vX.Y.Z/` |
| Latest artifact | `/Users/giovanni-lunetta/DateBack_Business/Builds/latest/` |
| Website repo | `/Users/giovanni-lunetta/DateBack_Business/DateBack_Website/` |
| GitHub remote | `giovanni-lunetta/dateback-releases` |
| Bundle ID (prod) | `com.giovannilunetta.dateback` |
| Bundle ID (QA) | `com.giovannilunetta.dateback.qa` |
| Polar sandbox org | `f8d31d6a-6539-41dc-be45-a0ee5b9ed660` |

---

### Common gotchas

- **`GH_TOKEN` env var** — if set, it overrides keyring auth and causes 401. Always `unset GH_TOKEN` before `gh release create`.
- **QA binaries missing** — using `--config` with electron-builder discards `package.json` build config including `extraResources`. The QA config JSON must always re-declare the explicit `extraResources` file mappings.
- **Sandbox API host** — correct host is `sandbox-api.polar.sh` (not `sandbox.polar.sh` which 404s).
- **`dist-qa/` in working tree** — this directory is untracked/gitignored; it being present does not mean the tree is dirty for release purposes.
- **Version in `package-lock.json`** — appears in two places: top-level `"version"` and `packages[""].version`. Both must be bumped.
