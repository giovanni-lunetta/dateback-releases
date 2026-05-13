# Bundled Binary Policy

DateBack keeps two macOS arm64 runtime binaries tracked in git:

- `assets/bin/mac-arm64/memory-organizer`
- `assets/bin/mac-arm64/ffmpeg`

These files remain tracked for deterministic packaging. The production and QA Electron Builder configs copy those exact paths into `Contents/Resources/bin/`, so a checkout can produce the same app bundle without depending on a developer's local PATH, Homebrew state, or a network download during packaging.

## `memory-organizer`

`memory-organizer` is the PyInstaller build of DateBack's Python processing pipeline. Rebuild it from the app repo root with:

```bash
npm run build:binary
```

That script runs:

```bash
python3 -m PyInstaller memory-organizer.spec --noconfirm
cp dist/memory-organizer assets/bin/mac-arm64/memory-organizer
```

After rebuilding, run the normal app verification commands before committing the updated binary.

## `ffmpeg`

`ffmpeg` is bundled because the Python pipeline invokes it for media normalization and video composition. The bundled binary is covered by the FFmpeg/GPL notice in `THIRD_PARTY_NOTICES.txt`, and the corresponding source package is published from the website license area at `https://dateback.app/licenses/ffmpeg-source.zip`.

## Platform Scope

The current packaged desktop app targets Apple Silicon only. The tracked binary directory is therefore intentionally arm64-only: `assets/bin/mac-arm64/`. Add a separate platform/architecture directory and explicit release-config mapping before introducing any additional desktop target.
