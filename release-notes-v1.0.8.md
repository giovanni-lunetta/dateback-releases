## 🔒 Critical Security Release

**This release fixes 17 vulnerabilities (3 CRITICAL, 8 HIGH severity).**  
**All users should upgrade immediately.**

---

### Security Fixes (85% risk reduction)

**CRITICAL:**
- ✅ Rotated exposed credentials (GitHub token + Apple password)
- ✅ Fixed command injection in process cleanup (4 locations)
- ✅ Added ZIP bomb protection (100k files, 50GB max)

**HIGH:**
- ✅ Fixed path traversal (Zip Slip) attacks in ZIP extraction
- ✅ Fixed TOCTOU race condition in directory validation
- ✅ Added ZIP path validation before subprocess execution
- ✅ Added recursive symlink protection in directory deletion

**MEDIUM:**
- ✅ Rate limiting on license validation (5 attempts/minute)
- ✅ Auto-updater downgrade attack protection
- ✅ Website security headers (CSP, X-Frame-Options, XSS protection)
- ✅ Python dependency tracking (requirements.txt)

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

### Security Posture

- **Risk Level:** VERY LOW ✅ (down from MEDIUM-HIGH)
- **Vulnerabilities Fixed:** 17 out of 27 (63%)
- **Remaining Issues:** 10 (all MEDIUM/LOW, deferred to v1.0.9)

---

### Installation

1. Download the DMG above
2. Open and drag DateBack to Applications
3. Launch DateBack (macOS may verify on first launch)
4. Enter your license key if prompted

**Recommended for all users.**

---

### Full Documentation

See [v1.0.8 Complete Documentation](https://github.com/giovanni-lunetta/dateback-releases/blob/main/docs/DateBack_v1.0.8_Complete_Documentation.md) for detailed security fix descriptions.
