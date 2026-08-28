## 🔒 Security Release

**This release includes a broad set of security hardening improvements following an internal security review.**
**All users should upgrade.**

---

### Security Improvements

- Rotated internal credentials as a precaution
- Hardened process cleanup against unsafe input
- Added protection against maliciously oversized ZIP archives
- Strengthened ZIP extraction safety checks
- Hardened directory validation against race conditions
- Added ZIP path validation before subprocess execution
- Added protection against unsafe symlinks during directory cleanup
- Added rate limiting on license validation
- Added downgrade-attack protection to the auto-updater
- Added standard website security headers
- Improved tracking of Python dependency versions

---

### Website Improvements

**Mobile Fixes:**
- Fixed image overlap in comparison section
- Fixed date pills spanning full image width
- Fixed image centering on mobile devices

**Contact Form:**
- Fixed contact form layout on mobile
- Fixed contact form submission (Page Not Found error)

---

### Download

[DateBack-1.0.8-arm64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.0.8/DateBack-1.0.8-arm64.dmg) (164 MB)

**Apple Silicon (M1/M2/M3) only**

---

### Installation

1. Download the DMG above
2. Open and drag DateBack to Applications
3. Launch DateBack (macOS may verify on first launch)
4. Enter your license key if prompted

**Recommended for all users.**
