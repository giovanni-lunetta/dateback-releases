# DateBack v1.0.2 - Security Hardening & Brand Refresh

## 🛡️ Security Hardening Release

v1.0.2 is a **mandatory security update** that addresses critical vulnerabilities identified during a comprehensive security audit. All users should upgrade immediately.

---

## 🔒 Security Fixes (Critical)

### ELEC-001: Arbitrary File Write Prevention
- **Issue**: The `resume-batch` IPC handler accepted file paths from the renderer, allowing potential writes to arbitrary locations.
- **Fix**: Main process now constructs signal file paths internally using hardcoded filenames within validated directories.
- **Impact**: Prevents malicious code from writing files outside approved locations.

### ELEC-002: URL Protocol Whitelist
- **Issue**: `shell.openExternal()` was called directly on URLs without validation, allowing potential execution of dangerous protocols.
- **Fix**: New `openExternalSafely()` helper enforces strict protocol whitelist (`http:`, `https:`, `mailto:` only).
- **Coverage**: Applied to all URL opening paths (IPC handlers, navigation events, window handlers).

### IPC Sender Validation
- **New**: `validateSender()` function validates that IPC calls originate from trusted local pages.
- **Coverage**: Applied to ALL 13 IPC handlers including file selection, processing, and licensing.
- **Impact**: Prevents compromised renderer from making unauthorized IPC calls.

### Output Directory Validation
- **New**: Strict validation of output directories before processing begins.
- **Enforcement**: Only user-approved directories (via picker) or default safe locations (`~/Pictures`) are allowed.
- **Impact**: Prevents processing to sensitive system directories.

---

## 🔒 Security Fixes (Medium)

### ELEC-003: Build Size Optimization
- **Issue**: FFmpeg/Python binaries were bundled in BOTH `app.asar` AND `extraResources` (~100MB duplication).
- **Fix**: Added exclusion pattern to prevent double bundling.
- **Result**: Installer size reduced by ~100MB (233MB → 133MB).

### ELEC-004: XSS Prevention
- **Issue**: Success modal used `innerHTML` to render stats, creating XSS vulnerability.
- **Fix**: Replaced with safe DOM manipulation using `createElement()` and `textContent`.
- **Impact**: Eliminates potential code injection vector.

---

## 🎨 UI/UX Enhancements

### Redesigned Welcome Modal
- **Larger Interface**: Increased modal width to 580px for better readability.
- **Hero Header**: Massive "Welcome to DateBack" title (48px) with prominent app icon.
- **Collapsible Instructions**: Step-by-step guide now in accordion format to reduce visual clutter.
- **Cleaner Design**: Removed redundant step numbers from headings (badges provide numbering).
- **Better Navigation**: "See Full Walkthrough" link now points directly to export guide section.

---

## 🏷️ Brand Consistency

### Standardized Slogan: "Archive Memories the Right Way"
- Updated all user-facing text to use consistent messaging.
- Website hero: "Don't lose your past. Archive memories the right way."
- App interface: "Archive Memories the Right Way"
- Removed inconsistent slogans from previous versions.

---

## 📥 Installation

### New Users
Download the DMG file below and drag DateBack to your Applications folder.

**Platform**: macOS (Apple Silicon arm64)  
**Minimum**: macOS 11.0 Big Sur or later

### Upgrading from v1.0.1
The built-in auto-updater will notify you of this update. Simply click "Download Update" and restart the app after installation completes.

**Note**: This is a **mandatory security update**. Please upgrade as soon as possible.

---

## ✅ What's Fixed

- ✅ **5 Security Vulnerabilities**: All ELEC-00x issues resolved
- ✅ **IPC Security**: All 13 handlers now validate sender origin
- ✅ **Path Validation**: Strict enforcement of approved directories
- ✅ **XSS Prevention**: Safe DOM manipulation throughout
- ✅ **Build Optimization**: 100MB smaller installer

---

## 🚀 Getting Started

1. Request your Snapchat data at [accounts.snapchat.com/accounts/downloadmydata](https://accounts.snapchat.com/accounts/downloadmydata)
2. Wait for Snapchat to email you the download link (typically 10-20 minutes)
3. Download `mydata.zip`
4. Open DateBack and select the ZIP file
5. Click "Start Processing" and let DateBack do the rest!

**Need Help?** Visit our [export guide](https://savemymemories.app/#export-guide) for detailed instructions.

---

## 🔐 Security Status

All DMG files are:
- ✅ **Code Signed** with Developer ID
- ✅ **Notarized** by Apple
- ✅ **Stapled** (notarization ticket embedded)
- ✅ **Verified** via `spctl --assess`

Users can install and run DateBack with **zero security warnings** on macOS.

---

## 📊 Technical Details

### Code Quality Improvements
- `open-url` now uses `parsedUrl.toString()` instead of raw URL string
- `open-folder` returns `{ success: true }` for consistency
- Removed legacy parameterized `resumeBatch(signalFile)` from preload API

### Security Baseline
| Requirement | Status |
|-------------|--------|
| `nodeIntegration: false` | ✅ PASS |
| `contextIsolation: true` | ✅ PASS |
| `sandbox: true` | ✅ PASS |
| IPC validates sender | ✅ PASS (all handlers) |
| IPC validates payload | ✅ PASS (outputDir approved) |
| Auto-updates signed | ✅ PASS |
| macOS hardened runtime | ✅ PASS |

---

## 🙏 Thank You

Thank you for using DateBack! This security update ensures your data remains safe while using our app.

If you encounter any issues, please reach out via our website.
