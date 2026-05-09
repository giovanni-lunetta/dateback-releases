# DateBack App Source

DateBack is a macOS Electron desktop app for processing Snapchat Memories exports locally on a user's Mac. The renderer is sandboxed, the preload bridge exposes a narrow IPC API, and the main process spawns the bundled Python worker for ZIP parsing, metadata repair, media organization, and cloud-folder handoff.

## Quick Start

```bash
npm ci
npm start
```

## Verification

```bash
npm run check
npm test
npm run test:all
```

## Release

```bash
npm run build:mac
```

Release signing and notarization credentials are loaded from `../.env`. Never commit `.env`.

## Reference Docs

- `AGENTS.md` - repo-specific coding, QA, and release guidance
- `docs/TESTING.md` - test procedures
- `docs/agent_system/DATEBACK_APP_ARCHITECTURE_AND_WORKFLOW.md` - architecture deep-dive
- `CHANGELOG.md` - release history
- `THIRD_PARTY_NOTICES.txt` - bundled third-party software notices
