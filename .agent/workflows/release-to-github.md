---
description: Complete workflow for building, notarizing, and publishing DateBack releases to GitHub
---

# DateBack Release Workflow

This workflow covers the complete process of creating a new DateBack release from build to GitHub publication.

## Prerequisites

Before starting, ensure you have:
- [ ] Updated version number in `package.json`
- [ ] Created release notes file: `release-notes-vX.X.X.md`
- [ ] Apple credentials configured (see `CREDENTIALS.md`)
- [ ] GitHub token set (see `CREDENTIALS.md`)

---

## Step 1: Build the Production DMG

```bash
cd /Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source
npm run build
npm run make
```

This creates the DMG in `out/make/DateBack-X.X.X-arm64.dmg`

---

## Step 2: Sign the DMG

```bash
codesign --force --deep --sign "Developer ID Application: Giovanni Lunetta (P5RF66U92A)" \
  out/make/DateBack-X.X.X-arm64.dmg
```

**Verify signature:**
```bash
codesign -dv --verbose=4 out/make/DateBack-X.X.X-arm64.dmg
```

---

## Step 3: Notarize with Apple

```bash
xcrun notarytool submit out/make/DateBack-X.X.X-arm64.dmg \
  --apple-id giovanni.a.lunetta@gmail.com \
  --team-id P5RF66U92A \
  --password APPLE_APP_SPECIFIC_PASSWORD \
  --wait
```

**Important**: Replace `APPLE_APP_SPECIFIC_PASSWORD` with the actual password from `CREDENTIALS.md`

This will output a submission ID. The `--wait` flag will poll until notarization completes.

---

## Step 4: Staple the Notarization

Once notarization succeeds:

```bash
xcrun stapler staple out/make/DateBack-X.X.X-arm64.dmg
```

**Verify stapling:**
```bash
xcrun stapler validate out/make/DateBack-X.X.X-arm64.dmg
spctl --assess --type open --context context:primary-signature -v out/make/DateBack-X.X.X-arm64.dmg
```

Should show: `accepted` and `source=Notarized Developer ID`

---

## Step 5: Move to Production Build Folder

```bash
mv out/make/DateBack-X.X.X-arm64.dmg ../DateBack_Production_Build/
```

---

## Step 6: Publish to GitHub

Set the GitHub token (see `CREDENTIALS.md` for the token):

```bash
export GH_TOKEN=YOUR_GITHUB_TOKEN
```

Create the release:

```bash
gh release create vX.X.X \
  --repo giovanni-lunetta/dateback-releases \
  --title "DateBack vX.X.X" \
  --notes-file release-notes-vX.X.X.md \
  --latest=true \
  ../DateBack_Production_Build/DateBack-X.X.X-arm64.dmg
```

**Notes:**
- Use `--latest=true` for the newest version
- Use `--latest=false` for older versions or re-releases

---

## Step 7: Verify the Release

Check that the release appears on GitHub:

```bash
gh release list --repo giovanni-lunetta/dateback-releases
```

Visit: https://github.com/giovanni-lunetta/dateback-releases/releases

---

## Quick Reference: All Commands in Sequence

```bash
# 1. Build
cd /Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source
npm run build
npm run make

# 2. Sign
codesign --force --deep --sign "Developer ID Application: Giovanni Lunetta (P5RF66U92A)" \
  out/make/DateBack-X.X.X-arm64.dmg

# 3. Notarize
xcrun notarytool submit out/make/DateBack-X.X.X-arm64.dmg \
  --apple-id giovanni.a.lunetta@gmail.com \
  --team-id P5RF66U92A \
  --password APPLE_APP_SPECIFIC_PASSWORD \
  --wait

# 4. Staple
xcrun stapler staple out/make/DateBack-X.X.X-arm64.dmg

# 5. Move to production
mv out/make/DateBack-X.X.X-arm64.dmg ../DateBack_Production_Build/

# 6. Publish to GitHub
export GH_TOKEN=YOUR_GITHUB_TOKEN
gh release create vX.X.X \
  --repo giovanni-lunetta/dateback-releases \
  --title "DateBack vX.X.X" \
  --notes-file release-notes-vX.X.X.md \
  --latest=true \
  ../DateBack_Production_Build/DateBack-X.X.X-arm64.dmg
```

---

## Troubleshooting

### "No such file or directory" during codesign
- Make sure you're in the correct directory
- Verify the DMG was created in `out/make/`

### Notarization fails
- Check that your Apple ID and password are correct
- Verify your Team ID is correct: `P5RF66U92A`
- Check notarization logs: `xcrun notarytool log SUBMISSION_ID --apple-id giovanni.a.lunetta@gmail.com --team-id P5RF66U92A --password PASSWORD`

### GitHub release fails with "Repository is empty"
- This should not happen anymore - the repository has been initialized with a README
- If it does happen, create a minimal README.md in the repo first

### "Invalid credentials" for GitHub
- Check that your GitHub token is set correctly: `echo $GH_TOKEN`
- Token should start with `ghp_`
- See `CREDENTIALS.md` for the correct token

---

## Best Practices

1. **Always test locally first**: Download the DMG after publishing and test it on a fresh Mac
2. **Keep release notes clear**: Document what changed, what was fixed, and any breaking changes
3. **Version incrementing**: Follow semantic versioning (MAJOR.MINOR.PATCH)
4. **Archive old DMGs**: Keep copies in `DateBack_Production_Build` for reference
5. **Update auto-updater**: Ensure the app can detect and download the new version
