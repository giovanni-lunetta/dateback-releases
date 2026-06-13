const path = require('path');
const fs = require('fs');
const { app } = require('electron');

function sanitizePathInput(value, label = 'Path') {
    if (typeof value !== 'string') {
        throw new Error(`${label} must be a string`);
    }
    const trimmed = value.trim();
    if (!trimmed) {
        throw new Error(`${label} is required`);
    }
    if (trimmed.includes('\0') || trimmed.includes('\n')) {
        throw new Error(`${label} contains invalid characters`);
    }
    return trimmed;
}

// Security: Safely resolve path to canonical form (resolve symlinks)
function getCanonicalPath(filePath) {
    const resolved = path.resolve(filePath);
    try {
        if (fs.existsSync(resolved)) {
            return fs.realpathSync(resolved);
        }
    } catch (e) {
        // Path might not exist yet
    }
    try {
        const missingParts = [];
        let probe = resolved;
        while (probe && probe !== path.dirname(probe) && !fs.existsSync(probe)) {
            missingParts.unshift(path.basename(probe));
            probe = path.dirname(probe);
        }
        if (probe && fs.existsSync(probe)) {
            return path.join(fs.realpathSync(probe), ...missingParts);
        }
    } catch (e) {
        // Fall back to the resolved string when no existing ancestor can be canonicalized.
    }
    return resolved;
}

function isWindowsDriveRootPath(dirPath) {
    if (typeof dirPath !== 'string') {
        return false;
    }
    const normalized = dirPath.trim().replace(/\//g, '\\');
    return /^[a-zA-Z]:\\?$/.test(normalized);
}

function isWindowsShareRootPath(dirPath) {
    if (typeof dirPath !== 'string') {
        return false;
    }
    const normalized = dirPath.trim().replace(/\//g, '\\');
    if (!normalized.startsWith('\\\\')) {
        return false;
    }
    const parts = normalized.replace(/^\\+/, '').split('\\').filter(Boolean);
    return parts.length === 2;
}

function getSensitiveRootError(dirPath) {
    if (isWindowsDriveRootPath(dirPath)) {
        return 'Cannot use Windows drive root. Please create a subfolder (for example, C:\\DateBack_Output).';
    }
    if (isWindowsShareRootPath(dirPath)) {
        return 'Cannot use Windows network share root. Please create a subfolder inside the share.';
    }
    if (typeof dirPath === 'string' && dirPath.startsWith('/Volumes/')) {
        const driveName = path.basename(dirPath);
        return `Cannot use external drive root. Please create a subfolder (e.g., /Volumes/${driveName}/DateBack_Output)`;
    }
    return 'Please select a subfolder, not the root Documents/Downloads folder.';
}

// Security: Deny commonly unsafe roots to prevent accidental home directory wipes
function isSensitiveRoot(dirPath) {
    if (isWindowsDriveRootPath(dirPath) || isWindowsShareRootPath(dirPath)) {
        return true;
    }

    const home = getCanonicalPath(app.getPath('home'));
    const sensitive = [
        home,
        path.join(home, 'Documents'),
        path.join(home, 'Downloads'),
        path.join(home, 'Desktop'),
        path.join(home, 'Pictures'),
        path.join(home, 'Library')
    ];

    // Check system directories (exact match)
    if (sensitive.some(s => s === dirPath)) {
        return true;
    }

    // Check external drive roots (e.g., /Volumes/USB)
    // Require subfolders to avoid permission/write issues
    if (dirPath.startsWith('/Volumes/')) {
        // Count slashes: /Volumes/USB = 2, /Volumes/USB/folder = 3+
        const slashCount = (dirPath.match(/\//g) || []).length;
        if (slashCount <= 2) {
            return true; // Block external drive roots
        }
    }

    return false;
}

// Security: Validate, canonicalize, and authorize an output directory.
// Factory so main.js can supply its session-scoped approval state
// (approvedOutputDirs set, current resume session dir) without this
// module owning that mutable state itself.
function createValidateAndCanonicalizeOutputDir({ approvedOutputDirs, getCurrentValidatedOutputDir }) {
    return function validateAndCanonicalizeOutputDir(outputDir, options = {}) {
        const {
            allowCurrentSession = false,
            includeSymlinkPathValidationError = false,
            createIfMissing = false,
            unapprovedError = 'Output directory not approved. Please use the folder picker.',
            unapprovedLogPrefix = '[SECURITY] Rejected unapproved output directory',
            sensitiveRootError = null,
            sensitiveRootLog = false
        } = options;

        let normalizedOutputDir;
        try {
            normalizedOutputDir = sanitizePathInput(outputDir, 'Output directory');
        } catch (e) {
            return { success: false, response: { success: false, error: e.message } };
        }

        if (isSensitiveRoot(normalizedOutputDir)) {
            if (sensitiveRootLog) {
                console.error(`[SECURITY] Rejected sensitive root output directory: ${normalizedOutputDir}`);
            }
            return {
                success: false,
                response: {
                    success: false,
                    error: sensitiveRootError || getSensitiveRootError(normalizedOutputDir)
                }
            };
        }

        const requestedOutputDir = path.resolve(normalizedOutputDir);
        if (includeSymlinkPathValidationError && fs.existsSync(requestedOutputDir)) {
            try {
                const outputStat = fs.lstatSync(requestedOutputDir);
                if (outputStat.isSymbolicLink()) {
                    return {
                        success: false,
                        response: {
                            success: false,
                            errorType: 'PATH_VALIDATION',
                            message: 'Output directory cannot be a symbolic link.',
                            error: 'Output directory cannot be a symbolic link.'
                        }
                    };
                }
            } catch (e) {
                return { success: false, response: { success: false, error: `Cannot access output directory: ${e.message}` } };
            }
        }

        const canonicalOutputDir = getCanonicalPath(requestedOutputDir);

        if (isSensitiveRoot(canonicalOutputDir)) {
            if (sensitiveRootLog) {
                console.error(`[SECURITY] Rejected sensitive root output directory: ${canonicalOutputDir}`);
            }

            const errorMsg = sensitiveRootError || getSensitiveRootError(canonicalOutputDir);

            return { success: false, response: { success: false, error: errorMsg } };
        }

        const isUserApproved = approvedOutputDirs.has(canonicalOutputDir);
        const homeDir = app.getPath('home');
        const defaultPicDir = path.join(homeDir, 'Pictures', 'SnapchatMemories');
        const canonicalDefault = getCanonicalPath(defaultPicDir);
        const isDefault = canonicalOutputDir === canonicalDefault || canonicalOutputDir.startsWith(canonicalDefault + path.sep);
        const isCurrentSession = allowCurrentSession && canonicalOutputDir === getCurrentValidatedOutputDir();

        if (!isDefault && !isUserApproved && !isCurrentSession) {
            if (unapprovedLogPrefix) {
                console.error(`${unapprovedLogPrefix}: ${canonicalOutputDir}`);
            }
            return { success: false, response: { success: false, error: unapprovedError } };
        }

        if (createIfMissing) {
            try {
                if (!fs.existsSync(canonicalOutputDir)) {
                    fs.mkdirSync(canonicalOutputDir, { recursive: true, mode: 0o700 });
                }

                const postCreateCanonical = fs.realpathSync(canonicalOutputDir);
                if (postCreateCanonical !== canonicalOutputDir) {
                    console.error(`[SECURITY] Directory path changed after creation - possible symlink attack`);
                    return {
                        success: false,
                        response: {
                            success: false,
                            error: 'Security validation failed: directory path changed after creation'
                        }
                    };
                }

                const stat = fs.lstatSync(canonicalOutputDir);
                if (!stat.isDirectory()) {
                    return { success: false, response: { success: false, error: 'Output path exists but is not a directory' } };
                }
                if (stat.isSymbolicLink()) {
                    console.error(`[SECURITY] Output path is a symlink - blocked for security`);
                    return { success: false, response: { success: false, error: 'Symbolic links are not allowed for output directory' } };
                }
            } catch (e) {
                console.error(`[SECURITY] Failed to validate/create output directory: ${e.message}`);
                return { success: false, response: { success: false, error: `Cannot access output directory: ${e.message}` } };
            }
        }

        return { success: true, canonicalOutputDir };
    };
}

module.exports = {
    sanitizePathInput,
    getCanonicalPath,
    isSensitiveRoot,
    createValidateAndCanonicalizeOutputDir
};
