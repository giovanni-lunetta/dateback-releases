# DateBack App Source — Claude Instructions

## Release Process

### Overview

All releases are patch/minor bumps on `main`. No release branches. The GitHub remote is `giovanni-lunetta/dateback-releases` and production releases must be publicly downloadable. The website repo is separate and its changes must never be committed/pushed by the release agent — leave them uncommitted and report the diff.

---

### Step-by-step: cutting a release

#### 1. Pre-flight checks

```bash
git status --short     # must be clean (only untracked dist* dirs allowed)
git branch -v          # must be on main, up to date
unset GH_TOKEN
gh repo view giovanni-lunetta/dateback-releases --json visibility -q .visibility
```

If dirty: stash or commit any in-progress work before proceeding.
The release repository visibility check must print `PUBLIC`; the website download links use GitHub Releases directly and will not work for customers while the repository is private.

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

#### 3. Supply-chain audit + tests — must be green before building

```bash
npm ci
npm audit --omit=dev --audit-level=high   # must show 0 high/critical prod vulnerabilities
pip-audit -r python/requirements.txt      # must show 0 vulnerabilities
npm run test:all      # runs: node --check main.js + renderer files, then node --test
```

Do not proceed if any step fails.

#### 4. Update CHANGELOG.md and THIRD_PARTY_NOTICES.txt

**CHANGELOG.md** — add an entry at the top for the new version. See previous entries for format.

**THIRD_PARTY_NOTICES.txt** — bump the version banner on line 2 to `DateBack vX.Y.Z` and update the `Last Updated` date. Verify listed production npm deps still match `package.json`.

#### 5. Commit the release

```bash
git add package.json package-lock.json CHANGELOG.md THIRD_PARTY_NOTICES.txt
git commit -m "Release: vX.Y.Z"
```

#### 6. Production build (sign + notarize)

Load Apple credentials from `../.env` (one level up, in `DateBack_Business/`):

```bash
unset APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID
source ../.env && export APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID
npm run build:mac
```

Output:
- `dist/DateBack-X.Y.Z-arm64.dmg`
- `dist/latest-mac.yml` (auto-update metadata)

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
mkdir -p /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/releases/vX.Y.Z
mkdir -p /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/latest
cp dist/DateBack-X.Y.Z-arm64.dmg /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/releases/vX.Y.Z/
cp dist/latest-mac.yml /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/releases/vX.Y.Z/
cp dist/DateBack-X.Y.Z-arm64.dmg /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/latest/
cp dist/latest-mac.yml /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/latest/
```

#### 7. QA build (internal only — do NOT upload to GitHub)

The QA config is checked in at `build/qa-build.json`. Do not edit it inline or recreate it in `/tmp`.

Build:
```bash
unset APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID
source ../.env && export APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID
npx electron-builder --config build/qa-build.json --mac
```

Output: `dist-qa/DateBack-X.Y.Z-QA-arm64.dmg`

**Verify binaries in QA .app:**
```bash
ls -lh "dist-qa/mac-arm64/DateBack QA.app/Contents/Resources/bin/"
```

**Verify Info.plist LSEnvironment and bundle ID:**
```bash
hdiutil attach "dist-qa/DateBack-X.Y.Z-QA-arm64.dmg" -nobrowse -quiet
plutil -p "/Volumes/DateBack QA X.Y.Z-arm64/DateBack QA.app/Contents/Info.plist" | grep -E "CFBundleIdentifier|CFBundleName|CFBundleShortVersionString" -A 8
hdiutil detach "/Volumes/DateBack QA X.Y.Z-arm64" -quiet
```

Expected plist values:
- `CFBundleIdentifier` = `com.giovannilunetta.dateback.qa`
- `CFBundleName` = `DateBack QA`

**Place QA artifact:**
```bash
cp dist-qa/DateBack-X.Y.Z-QA-arm64.dmg \
   /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/releases/vX.Y.Z/
```

#### 8. Tag, push, create GitHub Release

```bash
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z

# GH_TOKEN env var must NOT be set (use keyring auth instead):
unset GH_TOKEN
gh release create vX.Y.Z \
  /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/releases/vX.Y.Z/DateBack-X.Y.Z-arm64.dmg \
  /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/releases/vX.Y.Z/latest-mac.yml \
  --repo giovanni-lunetta/dateback-releases \
  --title "DateBack vX.Y.Z – <short title>" \
  --notes "<release notes>"
```

Upload **production DMG and `latest-mac.yml` only**. Never upload the QA DMG to GitHub Releases.

#### 9. Release notes doc (in-repo)

Create `docs/release-notes-vX.Y.Z.md` following the pattern of previous release notes (see [v1.1.3](docs/release-notes-v1.1.3.md) as the latest template).

Add an entry to `docs/README.md` under the release notes list.

Commit and push:
```bash
git add docs/release-notes-vX.Y.Z.md docs/README.md
git commit -m "Docs: release notes vX.Y.Z"
git push origin main
```

#### 10. Website changelog (DO NOT commit or push)

File: `/Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/DateBack_Website/changelog.html`

- Add a new `<details class="changelog-entry" open>` block at the top for the new version.
- Change the previously-latest entry's `<details>` to remove the `open` attribute.
- Leave the file modified but **unstaged/uncommitted**. Report the diff to the user.

Before the website is deployed, verify the public download target:

```bash
unset GH_TOKEN
gh repo view giovanni-lunetta/dateback-releases --json latestRelease,visibility --jq '{visibility:.visibility, latestTag:.latestRelease.tagName}'
```

The output must show `visibility` as `PUBLIC` and `latestTag` as `vX.Y.Z`. Do not deploy website copy that advertises a new free release while GitHub `releases/latest` still points to an older build.

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
- [ ] GitHub release repository visibility is `PUBLIC`
- [ ] `ls` evidence that both DMGs contain `Contents/Resources/bin/memory-organizer` and `Contents/Resources/bin/ffmpeg`
- [ ] SHA256 of production DMG
- [ ] SHA256 of `latest-mac.yml`
- [ ] SHA256 of QA DMG
- [ ] Auto-update metadata asset (`latest-mac.yml`) uploaded to the GitHub Release
- [ ] Notarization status (both builds)
- [ ] Website changelog diff (uncommitted)
- [ ] `memory-organizer` was built using the **stock PyInstaller bootloader** (no custom bootloader recompilation); GPL exception applies

---

### Key paths

| What | Path |
|---|---|
| App source | `/Users/giovanni-lunetta/Business Ideas/DateBack_Business/DateBack_App_Source/` |
| Env vars | `/Users/giovanni-lunetta/Business Ideas/DateBack_Business/.env` |
| Release artifacts | `/Users/giovanni-lunetta/Business Ideas/DateBack_Business/Builds/releases/vX.Y.Z/` |
| Latest artifact | `/Users/giovanni-lunetta/Business Ideas/DateBack_Business/Builds/latest/` |
| Website repo | `/Users/giovanni-lunetta/Business Ideas/DateBack_Business/DateBack_Website/` |
| GitHub remote | `giovanni-lunetta/dateback-releases` |
| Bundle ID (prod) | `com.giovannilunetta.dateback` |
| Bundle ID (QA) | `com.giovannilunetta.dateback.qa` |

---

### Common gotchas

- **`GH_TOKEN` env var** — if set, it overrides keyring auth and causes 401. Always `unset GH_TOKEN` before `gh release create`.
- **QA binaries missing** — `--config` with electron-builder discards the `package.json` build config including `extraResources`. The checked-in `build/qa-build.json` already re-declares the explicit `extraResources` mappings. Never remove them from that file.
- **`dist-qa/` in working tree** — this directory is untracked/gitignored; it being present does not mean the tree is dirty for release purposes.
- **Version in `package-lock.json`** — appears in two places: top-level `"version"` and `packages[""].version`. Both must be bumped.
- **`assets/bin/` contains arm64-only binaries** — `ffmpeg` and `memory-organizer` in `assets/bin/` are arm64 only. The build target must stay `arch: ["arm64"]`. Before adding x86_64 or universal targets, restructure to `assets/bin/arm64/` subdirectories and update `extraResources` in both `package.json` and `build/qa-build.json` to use the `${arch}` template variable.
