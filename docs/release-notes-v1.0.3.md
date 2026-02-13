# DateBack v1.0.3 - Security Hardening & Polish

**Release Date:** December 31, 2025  
**Download:** [DateBack-1.0.3-arm64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.0.3/DateBack-1.0.3-arm64.dmg)

---

## 🔒 Critical Security Updates

### Electron & Dependencies
- **Upgraded Electron** 27.x → 39.2.7 (Fixed CVE GHSA-6r2x-8pq8-9489, GHSA-vmqv-hx8q-j7mg)
- **Upgraded electron-builder** 24.9.1 → 26.0.12
- **Result:** 0 npm audit vulnerabilities

### Security Fixes
- **Fixed XSS vulnerability** in license activation flow
  - Replaced `innerHTML` with safe DOM creation (`document.createElementNS`)
  - Prevents malicious API responses from executing JavaScript
- **Path validation** for IPC handlers
  - Added strict validation to `open-folder` and `retry-corrupted` handlers
  - Only approved output directories or safe defaults (Pictures, Downloads, Documents) can be accessed
  - Prevents unauthorized file access

### Verification
- ✅ `contextIsolation: true` - Renderer isolated from Node.js
- ✅ `nodeIntegration: false` - No Node.js APIs in renderer
- ✅ `sandbox: true` - Chromium sandbox enabled
- ✅ No `webSecurity=false`

---

## ✨ New Features

### Auto-Find Zip
- **New Button:** "Find My Zip Automatically" searches your entire home directory
- **Smart Search:** Finds `mydata~*.zip` files up to 5 levels deep
- **Performance:** Excludes `node_modules`, `Library`, and `.Trash` folders
- **Most Recent:** Returns the newest file if multiple found

### Custom Storage Warnings
- **Styled Modals:** Custom-designed warnings that match the app's dark theme
- **Replaces:** Native macOS alert/confirm dialogs
- **Features:** Red warning titles, centered text, theme-aware styling

### Responsive UI
- **Welcome Screen:** Title scales from 40px to 64px based on window size
- **Formula:** `clamp(2.5rem, 5vw, 4rem)` for perfect scaling

---

## 🎨 UI Polish

### Button Improvements
- **Consistency:** "Continue Anyway" buttons now match "Start Processing" color (teal/green)
- **Layout:** Battery warning buttons reordered (Cancel left, Continue right)

### Visual Refinements
- **Modal Text:** All warning modal text is centered
- **Hover States:** Stat boxes show red hover when storage is low (previously showed blue)
- **Warning Icons:** Changed from green to red for clarity

---

## 🐛 Bug Fixes

### External Drive Storage Detection
- **Issue:** Storage check failed for external drives when subfolder didn't exist yet
- **Fix:** Path traversal logic finds nearest existing parent directory
- **Result:** Correct capacity shown for flash drives and external SSDs

### Warning Icon Colors
- **Issue:** Warning icons displayed green instead of red
- **Fix:** Updated CSS variable `--accent-orange` and icon colors to use `--accent-red`
- **Result:** Consistent red warning indicators

### Stat Box Hover Effects
- **Issue:** Blue hover color appeared instead of red when storage was low
- **Fix:** Modified CSS to exclude low-space/critical states from default blue hover
- **Added:** Red gradient animation for low-space warnings

---

## 📦 Installation

1. Download `DateBack-1.0.3-arm64.dmg`
2. Open the DMG
3. Drag DateBack to Applications
4. Launch & activate with your license key

**Minimum Requirements:** macOS 11+, Apple Silicon (M1/M2/M3)

---

## 🔧 Technical Notes

### Notarization Changes
Starting with v1.0.3, we follow Apple's recommended approach:
- The **app bundle** (DateBack.app) is notarized and stapled
- The DMG is a container with the notarized app inside
- Gatekeeper verifies the app when users open the DMG
- This is the modern, recommended approach for electron-builder v26

### Build Information
- **Size:** 152 MB
- **Code Signed:** Developer ID Application: GIOVANNI ANTHONY LUNETTA (ZK25MD36ZM)
- **Notarized:** Yes (verified with `spctl -a -vvv`)
- **Stapled:** Yes (app bundle)

---

## 📝 Full Changelog

For complete technical documentation and implementation details, see:
- [Complete v1.0.3 Documentation](../docs/DateBack_v1.0.3_Complete_Documentation.md)
- [Implementation Walkthrough](../../../.gemini/antigravity/brain/50b7679a-345a-453c-bf9e-d685cccd49a5/walkthrough.md)

---

## 🆘 Support

- **Email:** support@dateback.app
- **Issues:** Report bugs via email
- **Updates:** Auto-update will notify existing users

---

**Previous Releases:**
- [v1.0.2](https://github.com/giovanni-lunetta/dateback-releases/releases/tag/v1.0.2)
- [v1.0.1](https://github.com/giovanni-lunetta/dateback-releases/releases/tag/v1.0.1)
- [v1.0.0](https://github.com/giovanni-lunetta/dateback-releases/releases/tag/v1.0.0)
