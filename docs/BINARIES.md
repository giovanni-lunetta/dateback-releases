# Bundled Binary Policy

DateBack tracks macOS runtime binaries in git for deterministic packaging. The
production and QA Electron Builder configs copy the exact paths into
`Contents/Resources/bin/`.

## Directory structure

```
assets/bin/
  mac-arm64/   ← Apple Silicon (arm64) binaries
    ffmpeg
    memory-organizer
  mac-x64/     ← Intel Mac (x86_64) binaries
    ffmpeg
    memory-organizer
  win-x64/     ← Windows x64 binaries
    ffmpeg.exe
    memory-organizer.exe
```

## `memory-organizer` / `memory-organizer.exe`

`memory-organizer` is a PyInstaller-frozen copy of the Python pipeline. It must be
rebuilt before every production build because the binary does not update automatically
when source changes.

**arm64** (run on M-chip Mac):
```bash
npm run build:binary:arm64
```

**x64** (run on Intel Mac — PyInstaller cannot cross-compile):
```bash
npm run build:binary:x64
```

**Windows x64** (run via GitHub Actions — see `.github/workflows/build-win-binary.yml`):
```bash
npm run build:binary:win
```

Windows builds require a `windows-latest` GitHub Actions runner. The workflow is
triggered manually from the Actions tab. Download the resulting artifact and place
it at `assets/bin/win-x64/memory-organizer.exe` before building the Windows installer.

After rebuilding each binary, commit the updated file under its arch directory.

## `ffmpeg` / `ffmpeg.exe`

`ffmpeg` is bundled because the Python pipeline invokes it for media normalization and
video composition. The bundled binary is covered by the FFmpeg/GPL notice in
`THIRD_PARTY_NOTICES.txt`; corresponding source is at
`https://dateback.app/licenses/ffmpeg-source.zip`.

**macOS binaries** are obtained from **https://ffmpeg.martin-riedl.de** — download the
"Release Build" (not Snapshot) for each architecture:

- **macOS (Apple Silicon/arm64)** → FFmpeg (ZIP) → `assets/bin/mac-arm64/ffmpeg`
- **macOS (Intel/amd64)** → FFmpeg (ZIP) → `assets/bin/mac-x64/ffmpeg`

**Windows binary** is obtained from **https://www.gyan.dev/ffmpeg/builds/** — download
the "release essentials" or "release full" static build for Windows x64:

- **Windows (x64)** → FFmpeg essentials/full release ZIP → `assets/bin/win-x64/ffmpeg.exe`

Verify architecture with `file assets/bin/win-x64/ffmpeg.exe` (expect `PE32+ executable (console) x86-64`).

`ffmpeg` does not change between app releases unless the FFmpeg version is
intentionally upgraded. When upgrading, replace the binaries for all affected platforms,
update `THIRD_PARTY_NOTICES.txt` with the new versions, and update the source zip at
`dateback.app/licenses/ffmpeg-source.zip`.

## QA builds

The QA config (`build/qa-build.json`) hardcodes `assets/bin/mac-arm64/` paths and
always builds arm64. It is unaffected by the `${arch}` macro in `package.json`.

## Platform scope

Production builds target:
- `arm64` (Apple Silicon) via `npm run build:mac:arm64`
- `x64` (Intel Mac) via `npm run build:mac:x64`
- `x64` (Windows) via `npm run build:win:x64`

The release workflow in `CLAUDE.md` documents how all three installers are built and
published in a single GitHub Release. Add a new `<platform>-<arch>/` directory and
explicit release-config mapping before introducing any additional target.
