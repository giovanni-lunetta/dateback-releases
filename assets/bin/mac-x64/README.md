# mac-x64 binaries

This directory holds the x86_64 macOS runtime binaries bundled into the Intel Mac DMG.

## Required files

- `ffmpeg` — x86_64 Mach-O binary (download from evermeet.cx; see docs/BINARIES.md)
- `memory-organizer` — x86_64 PyInstaller bundle (built on Intel Mac via `npm run build:binary:x64`)

These files are tracked in git. `ffmpeg` is a one-time setup. `memory-organizer` is rebuilt and re-committed on every release.
