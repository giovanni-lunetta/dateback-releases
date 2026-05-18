# DateBack Release Process

This public checklist documents the high-level release process without local machine paths or credential locations.

1. Update `package.json` version and add `docs/release-notes-vX.Y.Z.md`.
2. Rebuild bundled helper binaries for every supported platform and architecture.
3. Run `npm run test:all`, `npm audit --omit=dev`, and Python pipeline tests.
4. Build signed/notarized macOS artifacts and Windows artifacts.
5. Verify release artifacts locally before upload.
6. Publish artifacts to GitHub Releases.
7. Verify updater metadata references only uploaded assets.
8. Update the website changelog, homepage release version, install copy, and sitemap.

Credentials must be supplied through the maintainer's local environment and must never be committed.
