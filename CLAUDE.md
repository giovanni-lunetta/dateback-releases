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

#### 6. Recompile the Python binary

**This must run before every QA or production build.** The bundled `memory-organizer` binary is a frozen copy of the Python source — it does not update automatically when the source changes.

```bash
npm run build:binary:arm64
```

Verify the binary was updated (timestamp should match today):
```bash
ls -lh assets/bin/mac-arm64/memory-organizer
```

Then commit the updated binary:
```bash
git add assets/bin/mac-arm64/memory-organizer
git commit -m "Build: recompile arm64 memory-organizer for vX.Y.Z"
```

#### 6b. Build x64 binary (on M-chip Mac via Rosetta)

Run this from the DateBack_App_Source directory on your M-chip Mac:

```bash
npm run build:binary:x64:rosetta
```

This uses the x86_64-mode virtual environment at `~/.venvs/dateback-x64` (created
via `arch -x86_64 /Library/Frameworks/Python.framework/Versions/3.10/bin/python3 -m venv`
with Pillow==12.0.0, requests==2.32.5, and PyInstaller==6.11.1 installed into it).

If the venv is ever lost (new machine, etc.), recreate it:
```bash
arch -x86_64 /Library/Frameworks/Python.framework/Versions/3.10/bin/python3 -m venv ~/.venvs/dateback-x64
arch -x86_64 ~/.venvs/dateback-x64/bin/pip install "Pillow==12.0.0" "requests==2.32.5" "PyInstaller==6.11.1"
```

Verify architecture:
```bash
file assets/bin/mac-x64/memory-organizer
# Expected: Mach-O 64-bit executable x86_64
```

Also verify `assets/bin/mac-x64/ffmpeg` is present (x86_64). This file does not
change between releases unless FFmpeg is being upgraded.

Commit the x64 binary:
```bash
git add assets/bin/mac-x64/memory-organizer
git commit -m "Build: add x64 memory-organizer for vX.Y.Z"
```

#### 6c. Build Windows binary (via GitHub Actions)

**Prerequisite — `ffmpeg.exe` must exist first:**
```bash
ls assets/bin/win-x64/ffmpeg.exe
```
If missing: download the Windows x64 static build from https://www.gyan.dev/ffmpeg/builds/ ("release essentials" or "release full"), extract, place at `assets/bin/win-x64/ffmpeg.exe`, verify with `file assets/bin/win-x64/ffmpeg.exe` (must say `PE32+ executable (console) x86-64`), commit it, and update `THIRD_PARTY_NOTICES.txt` with the version string from `assets/bin/win-x64/ffmpeg.exe -version`.

**Build `memory-organizer.exe`:**

1. Navigate to the `dateback-releases` GitHub repo → Actions → "Build Windows Binary"
2. Click "Run workflow" → Run
3. Wait ~3–5 minutes for the run to complete
4. Download `memory-organizer.exe` from the run's Artifacts section
5. Place at `assets/bin/win-x64/memory-organizer.exe`
6. Verify: `file assets/bin/win-x64/memory-organizer.exe` → must say `PE32+ executable (console) x86-64`
7. Commit:
   ```bash
   git add assets/bin/win-x64/memory-organizer.exe
   git commit -m "Build: add Windows x64 memory-organizer for vX.Y.Z"
   ```

#### 7. Production build (sign + notarize)

Load Apple credentials from `../.env` (one level up, in `DateBack_Business/`):

```bash
unset APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID
source ../.env && export APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID
```

**Build arm64 DMG:**
```bash
npm run build:mac:arm64
```

Output:
- `dist/DateBack-X.Y.Z-arm64.dmg`
- `dist/latest-mac.yml` (**not** `latest-mac-arm64.yml` — electron-builder always writes `latest-mac.yml` for the first architecture built)

**Verify arm64 binaries inside .app:**
```bash
ls -lh dist/mac-arm64/DateBack.app/Contents/Resources/bin/
file dist/mac-arm64/DateBack.app/Contents/Resources/bin/ffmpeg
file dist/mac-arm64/DateBack.app/Contents/Resources/bin/memory-organizer
# both must say: Mach-O 64-bit executable arm64
```

**Mount and verify arm64 DMG:**
```bash
hdiutil attach dist/DateBack-X.Y.Z-arm64.dmg -nobrowse -quiet
ls -lh "/Volumes/DateBack X.Y.Z-arm64/DateBack.app/Contents/Resources/bin/"
hdiutil detach "/Volumes/DateBack X.Y.Z-arm64" -quiet
```

**Compute arm64 SHA256:**
```bash
shasum -a 256 dist/DateBack-X.Y.Z-arm64.dmg
```

**Save the arm64 YML before x64 overwrites it:**
```bash
cp dist/latest-mac.yml dist/latest-mac-arm64.yml
```

---

**Build x64 DMG:**
```bash
npm run build:mac:x64
```

Output:
- `dist/DateBack-X.Y.Z-x64.dmg` (named `DateBack-X.Y.Z.dmg` on disk — copy to releases dir as `DateBack-X.Y.Z-x64.dmg`)
- `dist/DateBack-X.Y.Z-mac.zip` (x64 app bundle zip — required by electron-updater for x64 auto-update)
- `dist/latest-mac.yml` (overwritten with x64 + arm64 entries; `path:` field references `DateBack-X.Y.Z-mac.zip`)

**Important:** The x64 build also rebuilds the arm64 DMG (different hash from the arm64-only build). After the x64 build completes, update `dist/latest-mac-arm64.yml` to match the new arm64 DMG hash shown in `dist/latest-mac.yml`.

**Verify x64 binaries inside .app:**
```bash
ls -lh dist/mac/DateBack.app/Contents/Resources/bin/
file dist/mac/DateBack.app/Contents/Resources/bin/ffmpeg
file dist/mac/DateBack.app/Contents/Resources/bin/memory-organizer
# both must say: Mach-O 64-bit executable x86_64
```

**Mount and verify x64 DMG:**
```bash
hdiutil attach dist/DateBack-X.Y.Z-x64.dmg -nobrowse -quiet
ls -lh "/Volumes/DateBack X.Y.Z/DateBack.app/Contents/Resources/bin/"
hdiutil detach "/Volumes/DateBack X.Y.Z" -quiet
```

**Compute x64 SHA256:**
```bash
shasum -a 256 dist/DateBack-X.Y.Z-x64.dmg
```

---

**Place all artifacts:**
```bash
mkdir -p /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/releases/vX.Y.Z
mkdir -p /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/latest

# arm64
cp dist/DateBack-X.Y.Z-arm64.dmg /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/releases/vX.Y.Z/
cp dist/latest-mac-arm64.yml      /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/releases/vX.Y.Z/

# x64
cp dist/DateBack-X.Y.Z-x64.dmg   /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/releases/vX.Y.Z/
cp dist/DateBack-X.Y.Z-mac.zip   /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/releases/vX.Y.Z/
cp dist/latest-mac.yml            /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/releases/vX.Y.Z/

# latest (both)
cp dist/DateBack-X.Y.Z-arm64.dmg /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/latest/
cp dist/DateBack-X.Y.Z-x64.dmg   /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/latest/
cp dist/DateBack-X.Y.Z-mac.zip   /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/latest/
cp dist/latest-mac-arm64.yml      /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/latest/
cp dist/latest-mac.yml            /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/latest/
```

**Build Windows x64 NSIS installer:**
```bash
npm run build:win:x64
```

Output:
- `dist/DateBack-X.Y.Z-x64-win.exe`
- `dist/latest.yml` (Windows auto-update metadata)

**Verify:**
```bash
file dist/DateBack-X.Y.Z-x64-win.exe
# Expected: PE32+ executable (console) x86-64
```

**Compute Windows SHA256:**
```bash
shasum -a 256 dist/DateBack-X.Y.Z-x64-win.exe
```

**Place Windows artifacts:**
```bash
cp dist/DateBack-X.Y.Z-x64-win.exe /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/releases/vX.Y.Z/
cp dist/latest.yml                  /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/releases/vX.Y.Z/latest-win.yml

cp dist/DateBack-X.Y.Z-x64-win.exe /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/latest/
cp dist/latest.yml                  /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/latest/latest-win.yml
```

Note: `dist/latest.yml` (Windows) is distinct from `dist/latest-mac.yml` (Mac x64) — no filename conflict.

#### 8. QA build (internal only — do NOT upload to GitHub)

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

#### 9. Tag, push, create GitHub Release

```bash
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z

# GH_TOKEN env var must NOT be set (use keyring auth instead):
unset GH_TOKEN
gh release create vX.Y.Z \
  /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/releases/vX.Y.Z/DateBack-X.Y.Z-arm64.dmg \
  /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/releases/vX.Y.Z/DateBack-X.Y.Z-x64.dmg \
  /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/releases/vX.Y.Z/DateBack-X.Y.Z-mac.zip \
  /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/releases/vX.Y.Z/DateBack-X.Y.Z-x64-win.exe \
  /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/releases/vX.Y.Z/latest-mac-arm64.yml \
  /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/releases/vX.Y.Z/latest-mac.yml \
  --repo giovanni-lunetta/dateback-releases \
  --title "DateBack vX.Y.Z – <short title>" \
  --notes "<release notes>"

# Upload Windows latest.yml — must be named exactly "latest.yml" for electron-updater
# gh release create does not support rename; use gh release upload with a temp copy:
cp /Users/giovanni-lunetta/Business\ Ideas/DateBack_Business/Builds/releases/vX.Y.Z/latest-win.yml /tmp/latest.yml
gh release upload vX.Y.Z /tmp/latest.yml \
  --repo giovanni-lunetta/dateback-releases
rm /tmp/latest.yml
```

Upload all 6 production artifacts (3 installers + 3 YML files). Never upload the QA DMG to GitHub Releases. `electron-updater` on arm64 machines checks `latest-mac-arm64.yml`; on x64 Mac machines it checks `latest-mac.yml`; on Windows x64 machines it checks `latest.yml`.

#### 10. Release notes doc (in-repo)

Create `docs/release-notes-vX.Y.Z.md` following the pattern of previous release notes (see [v1.1.3](docs/release-notes-v1.1.3.md) as the latest template).

Add an entry to `docs/README.md` under the release notes list.

Commit and push:
```bash
git add docs/release-notes-vX.Y.Z.md docs/README.md
git commit -m "Docs: release notes vX.Y.Z"
git push origin main
```

#### 11. Website changelog (DO NOT commit or push)

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

- [ ] Commit hashes for: version bump, arm64 binary build, x64 binary transfer, docs commit
- [ ] Tag pushed (`vX.Y.Z`)
- [ ] GitHub Release URL
- [ ] GitHub release repository visibility is `PUBLIC`
- [ ] `file` evidence that arm64 binaries are `Mach-O 64-bit executable arm64`
- [ ] `file` evidence that x64 binaries are `Mach-O 64-bit executable x86_64`
- [ ] SHA256 of arm64 production DMG
- [ ] SHA256 of x64 production DMG
- [ ] x64 mac.zip uploaded to GitHub Release (required for x64 auto-update)
- [ ] SHA256 of `latest-mac.yml`
- [ ] SHA256 of `latest-mac-arm64.yml`
- [ ] SHA256 of QA DMG
- [ ] Both auto-update YML files uploaded to the GitHub Release
- [ ] Notarization status (arm64 build, x64 build, QA build)
- [ ] Website changelog diff (uncommitted)
- [ ] `memory-organizer` (both arches) built using stock PyInstaller bootloader; GPL exception applies

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
- **Binary arch directories** — production builds use `${arch}` substitution in `extraResources` to pick `assets/bin/mac-arm64/` or `assets/bin/mac-x64/`. The QA config (`build/qa-build.json`) hardcodes `mac-arm64` paths and is always arm64-only — do not add `${arch}` to the QA config.

- **YML filename** — `npm run build:mac:arm64` always produces `dist/latest-mac.yml` (not `latest-mac-arm64.yml`). Copy it to `latest-mac-arm64.yml` immediately after the arm64 build. Then `npm run build:mac:x64` overwrites `latest-mac.yml` and also rebuilds the arm64 DMG with a different hash — update `latest-mac-arm64.yml` from the arm64 entry in the new `latest-mac.yml` before releasing.
- **x64 build rebuilds arm64** — `npm run build:mac:x64` builds both x64 and arm64. The resulting arm64 DMG differs from the one produced by the standalone arm64 build. Always use the arm64 hash from `latest-mac.yml`'s arm64 entry (post-x64-build) when writing `latest-mac-arm64.yml`.

- **x64 binary requires x86_64-mode Python** — Use `npm run build:binary:x64:rosetta` on the M-chip Mac (not plain `build:binary:x64`). The `:rosetta` script uses `arch -x86_64` with the dedicated `~/.venvs/dateback-x64` venv. Plain `python3` on the M-chip Mac produces an arm64 binary regardless of the spec's `target_arch` setting. Always verify with `file assets/bin/mac-x64/memory-organizer`.

- **x64 auto-update zip** — `npm run build:mac:x64` generates `dist/DateBack-X.Y.Z-mac.zip` alongside the DMG. This zip is what `latest-mac.yml`'s `path:` field references and what electron-updater downloads on Intel Macs. Always copy and upload it — it is included in the artifact copy steps and `gh release create` command above.
