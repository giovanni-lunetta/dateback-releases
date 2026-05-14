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
```

## `memory-organizer`

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

After rebuilding each binary, commit the updated file under its arch directory.

## `ffmpeg`

`ffmpeg` is bundled because the Python pipeline invokes it for media normalization and
video composition. The bundled binary is covered by the FFmpeg/GPL notice in
`THIRD_PARTY_NOTICES.txt`; corresponding source is at
`https://dateback.app/licenses/ffmpeg-source.zip`.

The arm64 `ffmpeg` binary was obtained from evermeet.cx. The x64 binary should be
obtained from the same source. `ffmpeg` does not change between app releases unless
the FFmpeg version is intentionally upgraded.

## QA builds

The QA config (`build/qa-build.json`) hardcodes `assets/bin/mac-arm64/` paths and
always builds arm64. It is unaffected by the `${arch}` macro in `package.json`.

## Platform scope

Production builds target `arm64` (Apple Silicon) and `x64` (Intel Mac) via the
explicit `npm run build:mac:arm64` and `npm run build:mac:x64` scripts. The
release workflow in `CLAUDE.md` documents how both DMGs are built and published
in a single GitHub Release. Add a new `mac-<arch>/` directory and explicit
release-config mapping before introducing any additional target.
