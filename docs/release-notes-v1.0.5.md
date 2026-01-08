# MemSavr v1.0.5 - Quality & Performance Release 🚀

**Release Date:** January 3, 2026

This release brings **15 critical improvements** focused on code quality, security, performance, and reliability. Major highlights include 20x faster verification, prevention of data loss scenarios, and true offline ZIP processing.

---

## 🎯 What's New

### Code Quality Improvements (7)
1. **File Size Index Reset** - Prevents stale data across multiple runs
2. **Fast Pass Optimization** - 20x faster verification (<1 second vs ~20 seconds)
3. **ZIP Index Filter** - Excludes non-media files (`.json`, `.py`, `.DS_Store`) from size matching
4. **HEAD Failure Fallback** - Offline ZIP processing resilience with filename matching
5. **Content-Length Handling** - Distinguishes unknown size from zero, fewer false skips
6. **Size Validation Guard** - Only validates when size is known
7. **Diagnostic Logging** - Visible warnings for Content-Length and HEAD failures

### Security & Safety Improvements (4)
8. **ZIP Validation** - Accepts nested paths (e.g., `mydata-snapchat/json/memories_history.json`)
9. **🚨 Output Directory Safety Guard** - Prevents catastrophic data loss by blocking deletion of system directories (`/`, `~`, `~/Documents`, etc.)
10. **License Timeout** - 10-second timeout prevents frozen activation flow
11. **Process Cleanup Safety** - Uses full paths and exact binary names to avoid killing unrelated processes

### Performance Optimizations (3)
12. **ZIP-Only Workflow** - Skips HEAD requests for ZIP processing → true offline capability
13. **Batch Disk Space Checks** - 476x fewer checks (per-batch vs per-file)
14. **HTTP Session Pooling** - 30-50% faster downloads via connection reuse

### Reliability Improvements (1)
15. **Batch Move Conflict Resolution** - Prevents silent file overwrites during batch organization

---

## 📊 Performance Impact

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Fast Pass Verification | ~20 seconds | <1 second | **20x faster** |
| Downloads (network) | Baseline | 30-50% faster | **Connection pooling** |
| Disk Space Checks | 3,819 calls | 8 calls | **476x fewer** |
| ZIP Processing | HEAD requests | Direct lookup | **True offline** |

---

## 🛡️ Critical Fixes

### Data Loss Prevention
- **Output directory safety guard** now prevents accidental deletion of:
  - Root directory (`/`)
  - Home directory (`~`)
  - System folders (`~/Documents`, `~/Downloads`, `~/Desktop`, `~/Library`)
  
Users must select a subfolder (e.g., `~/Documents/MemSavr_Output`) instead of top-level directories.

### Silent Overwrite Prevention
- Files moved to batch folders now avoid silent overwrites
- Duplicate names are renamed with incremental suffixes (`photo_1.jpg`, `photo_2.jpg`)
- Safe resume from incomplete batches

---

## 🔧 Technical Details

**Modified Files:**
- `python/process_snapchat_memories.py` (13 improvements)
- `main.js` (3 security/safety fixes)

**Binary Size:** 15 MB (Python 3.10.4, PyInstaller 6.17.0)

**Platform:** macOS (Apple Silicon)

---

## 📋 Full Changelog

See [Complete Documentation](https://github.com/giovanni-lunetta/memsavr-releases/blob/main/docs/MemSavr_v1.0.5_Complete_Documentation.md) for detailed technical explanations and code examples.

---

## 🚀 Upgrade Notes

**Recommended for all users** - This release includes critical security fixes and significant performance improvements.

**Breaking Changes:** None

**New Requirements:** None

---

**Download the latest version below!** ⬇️
