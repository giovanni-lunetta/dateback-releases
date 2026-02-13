# DateBack v1.0.4 - GPL Compliance & Critical Bug Fixes

**Release Date:** January 2, 2026  
**Download:** https://github.com/giovanni-lunetta/dateback-releases/releases/tag/v1.0.4  
**Platform:** macOS (Apple Silicon arm64)

---

## 🔒 GPL Compliance Implementation (CRITICAL)

This release corrects a critical licensing compliance issue and ensures DateBack is fully GPL-compliant for commercial distribution.

### The Issue

DateBack v1.0.3 and earlier bundled a GPL-licensed FFmpeg binary but incorrectly claimed it was LGPL v2.1 in multiple places. This was a legal compliance issue that needed immediate correction.

**Background:**
- Bundled FFmpeg binary (v8.0.1) was built with `--enable-gpl`, `--enable-libx264`, and `--enable-libx265`
- This configuration makes the binary GPL v2.0+ (not LGPL)
- GPL requires accurate license statements and source code availability

### What Changed

**1. Created License Files:**
- `licenses/GPL-2.0.txt` - Official GPL v2.0 license text (18 KB)
- `THIRD_PARTY_NOTICES.txt` - Comprehensive third-party attribution with FFmpeg GPL notice

**2. Updated License Statements:**
- `LICENSE` - Replaced LGPL v2.1 claims with accurate GPL v2.0+ statements
- `main.js` - Updated About dialog (v1.0.4, GPL v2.0+) and View Licenses dialog
- Added codec disclosure (libx264, libx265)

**3. Source Code Availability:**
- Created `ffmpeg-8.0.1-gpl-source.zip` (18 MB)
- Includes: FFmpeg n8.0.1, x264, x265 source code
- Includes: BUILD_INFO.txt with full configuration and binary provenance
- Hosted at: https://dateback.app/licenses/ffmpeg-source.zip
- SHA256: `286b5c13bb070eb0bd068beb6754f03e6d2ec8692b9dae063c4719456a3fc80a`

**4. Binary Verification:**
- FFmpeg binary SHA256: `3b586ff896c0339e8fd574c143aaccac23c80789341e22d4202f8013a133d3a4`
- Confirmed GPL build with `--enable-gpl` flag

### Impact

- ✅ Fully GPL-compliant for commercial distribution
- ✅ No LGPL misrepresentation
- ✅ Source code publicly accessible
- ✅ Ready for paid download on dateback.app

### User Experience

- Users see accurate licensing in Help → About DateBack
- Users can download FFmpeg source via Help → View Licenses
- **No functionality changes** - all existing features work exactly as before

---

## 🐛 Critical Bug Fixes

### Resume Feature Fix

**Issue:** "Continue to Next Batch" button in Cloud Mode did not resume processing after batch completion.

**Symptoms:**
- App appeared frozen after clicking "Continue to Next Batch"
- Progress bar showed "Resuming..." indefinitely
- Python process remained stuck in pause loop
- Only workaround was restarting the app

**Root Causes:**

1. **Signal Filename Mismatch**
   - main.js created: `.dateback_resume_signal`
   - Python expected: `.resume_signal`
   - Files never matched, so resume never triggered

2. **Directory Path Mismatch** (Primary Issue)
   - main.js created signal in parent directory: `/Pictures/SnapchatMemories/.dateback_resume_signal`
   - Python looked in subdirectory: `/Pictures/SnapchatMemories/Processed_Memories_2025-12-29/.dateback_resume_signal`
   - Even with matching filenames, paths were different

3. **Missing Import**
   - Python used `concurrent.futures` module without importing it
   - Caused `NameError: name 'concurrent' is not defined`

4. **Syntax Errors**
   - Multiple f-string print statements had escaped quotes: `f\"`
   - Caused `SyntaxError: unterminated string literal`

**Changes Made:**

- **python/process_snapchat_memories.py (Line 16):** Added `import concurrent.futures`
- **python/process_snapchat_memories.py (Line 928):** Fixed signal file path to parent directory
- **python/process_snapchat_memories.py (Lines 1166-1232):** Fixed syntax errors in f-strings
- **python/cli.spec (Line 19):** Added module to PyInstaller bundle

**Impact:**
- Users can now successfully pause and resume batch processing
- "Continue to Next Batch" button works as intended
- Cloud Mode is fully functional for users with limited storage

---

## 📦 Installation

1. Download `DateBack-1.0.4-arm64.dmg` from GitHub releases
2. Open the DMG file
3. Drag DateBack to your Applications folder
4. Launch DateBack and activate with your license key

**Minimum Requirements:** 
- macOS 11 (Big Sur) or later
- Apple Silicon (M1, M2, M3, M4)

---

## 🔐 Security & Privacy

- All local processing (no cloud uploads)
- Code-signed and notarized by Apple
- Zero data collection
- Open source compliance (GPL v2.0+)

---

## 📝 Technical Details

**File Size:** 152 MB  
**FFmpeg Version:** 8.0.1  
**Electron Version:** 39.2.7  
**Build Configuration:** Production with notarization

**Checksums:**
- DateBack DMG: (verify with `shasum -a 256 DateBack-1.0.4-arm64.dmg`)
- FFmpeg Binary: `3b586ff896c0339e8fd574c143aaccac23c80789341e22d4202f8013a133d3a4`
- FFmpeg Source Package: `286b5c13bb070eb0bd068beb6754f03e6d2ec8692b9dae063c4719456a3fc80a`

---

## 🆘 Support

**Issues or Questions?**
- Visit: https://dateback.app
- Email: support@dateback.app

**FFmpeg Source Code:**
- Download: https://dateback.app/licenses/ffmpeg-source.zip
- Upstream: https://github.com/FFmpeg/FFmpeg (tag: n8.0.1)

---

## 📄 License

**DateBack Application:** MIT License  
**FFmpeg (bundled):** GPL v2.0+ (includes GPL-licensed codecs: libx264, libx265)

Full license details and third-party notices are included in the application bundle.

---

**Previous Version:** [v1.0.3](https://github.com/giovanni-lunetta/dateback-releases/releases/tag/v1.0.3)  
**All Releases:** https://github.com/giovanni-lunetta/dateback-releases/releases
