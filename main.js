const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const AdmZip = require('adm-zip');
const checkDiskSpace = require('check-disk-space').default;
const Store = require('electron-store');
const axios = require('axios');
const { autoUpdater } = require('electron-updater');
const Logger = require('./src/logger');
const SupportLogs = require('./src/supportLogs');

// Load environment variables from .env file
require('dotenv').config();

const store = new Store();

// Configure auto-updater
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowDowngrade = false;  // Prevent downgrade attacks
autoUpdater.allowPrerelease = false; // Only stable releases

let mainWindow;
let pythonProcess = null;
let caffeinateProcess = null; // Sleep prevention process
let intentionalStop = false; // Track if user intentionally stopped processing
let currentValidatedOutputDir = null; // Store validated output dir for secure resume
let approvedOutputDirs = new Set(); // Track user-approved output directories

// Rate Limiter for Security (prevent brute-force attacks)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 5; // 5 attempts per minute

function checkRateLimit(identifier) {
    const now = Date.now();
    const record = rateLimitMap.get(identifier);

    if (!record || now > record.resetTime) {
        rateLimitMap.set(identifier, {
            count: 1,
            resetTime: now + RATE_LIMIT_WINDOW
        });
        return true;
    }

    if (record.count >= RATE_LIMIT_MAX) {
        return false;
    }

    record.count++;
    return true;
}

// Cleanup old rate limit entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitMap.entries()) {
        if (now > record.resetTime) {
            rateLimitMap.delete(key);
        }
    }
}, 5 * 60 * 1000);

// Support Logs System
let logger = null;
let supportLogs = null;
let lastError = null;
let isQuitting = false;
let lastPythonSampleLogAt = 0; // Rate limit for Python stdout sampling

// Security: Validate IPC sender origin
function validateSender(event) {
    const senderUrl = event.senderFrame?.url || '';
    // Only accept IPC from our local app pages (file:// protocol)
    if (!senderUrl.startsWith('file://')) {
        console.error(`[SECURITY] Rejected IPC from untrusted origin: ${senderUrl}`);
        return false;
    }
    return true;
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
    return resolved;
}

// Security: Ensure path is inside allowed directory (prevent path traversal)
function isPathInsideDir(filePath, allowedDir) {
    const canonicalFile = getCanonicalPath(filePath);
    const canonicalDir = getCanonicalPath(allowedDir);
    return canonicalFile.startsWith(canonicalDir + path.sep) || canonicalFile === canonicalDir;
}

// Security: Deny commonly unsafe roots to prevent accidental home directory wipes
function isSensitiveRoot(dirPath) {
    const home = app.getPath('home');
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

// Security: Safely open external URLs with protocol whitelist
function openExternalSafely(rawUrl) {
    try {
        const parsedUrl = new URL(rawUrl);
        const allowedProtocols = ['http:', 'https:', 'mailto:'];
        const os = require('os');
        const isDev = !app.isPackaged;


        if (!allowedProtocols.includes(parsedUrl.protocol)) {
            console.error(`[SECURITY] Blocked openExternal with disallowed protocol: ${parsedUrl.protocol}`);
            return { success: false, error: `Protocol ${parsedUrl.protocol} is not allowed` };
        }

        shell.openExternal(parsedUrl.toString());
        return { success: true };
    } catch (e) {
        console.error(`[SECURITY] Invalid URL passed to openExternal: ${rawUrl}`);
        return { success: false, error: 'Invalid URL' };
    }
}



// Validate ZIP file
ipcMain.handle('validate-zip', async (event, zipPath) => {
    if (!validateSender(event)) {
        return { found: false, error: 'Unauthorized sender', count: 0 };
    }

    try {
        const zip = new AdmZip(zipPath);
        const zipEntries = zip.getEntries();

        // ZIP BOMB PROTECTION
        const MAX_ENTRIES = 100000;  // 100k files max
        const MAX_ENTRY_SIZE = 500 * 1024 * 1024;  // 500MB per file
        const MAX_TOTAL_SIZE = 50 * 1024 * 1024 * 1024;  // 50GB total uncompressed

        // Check entry count
        if (zipEntries.length > MAX_ENTRIES) {
            return {
                found: false,
                error: `ZIP contains too many files (${zipEntries.length.toLocaleString()}). Maximum allowed: 100,000 files.`,
                count: 0
            };
        }

        // Check individual file sizes and total size
        let totalSize = 0;
        for (const entry of zipEntries) {
            const size = entry.header.size;
            if (size > MAX_ENTRY_SIZE) {
                return {
                    found: false,
                    error: `ZIP contains file larger than 500MB: ${entry.entryName}`,
                    count: 0
                };
            }
            totalSize += size;
        }

        if (totalSize > MAX_TOTAL_SIZE) {
            const sizeGB = (totalSize / (1024 * 1024 * 1024)).toFixed(2);
            return {
                found: false,
                error: `ZIP total uncompressed size (${sizeGB}GB) exceeds 50GB limit.`,
                count: 0
            };
        }

        // PATH TRAVERSAL PROTECTION (Zip Slip)
        for (const entry of zipEntries) {
            const normalized = path.normalize(entry.entryName);

            // Block path traversal attempts
            if (normalized.includes('..') || path.isAbsolute(normalized)) {
                return {
                    found: false,
                    error: 'ZIP contains invalid file paths (path traversal detected). Please use a legitimate Snapchat export.',
                    count: 0
                };
            }

            // Block dangerous hidden files
            const basename = path.basename(normalized);
            if (basename.match(/^\.(bash|zsh|ssh|gnupg|git)/)) {
                return {
                    found: false,
                    error: 'ZIP contains potentially dangerous system files.',
                    count: 0
                };
            }
        }

        const jsonEntry = zipEntries.find(entry => entry.entryName.endsWith('memories_history.json'));

        let count = 0;
        if (jsonEntry) {
            try {
                const jsonText = jsonEntry.getData().toString('utf8');
                const jsonData = JSON.parse(jsonText);
                if (jsonData['Saved Media']) {
                    count = jsonData['Saved Media'].length;
                }
            } catch (e) {
                console.error('Error parsing JSON:', e);
            }
        }

        return { found: !!jsonEntry, count };
    } catch (error) {
        return { found: false, error: error.message, count: 0 };
    }
});

// Check Disk Space
ipcMain.handle('get-disk-space', async (event, pathToCheck) => {
    if (!validateSender(event)) {
        return { success: false, error: 'Unauthorized sender' };
    }

    try {
        // Traverse up to find nearest existing parent directory
        // This is important for external drives where the target subfolder may not exist yet
        let checkPath = pathToCheck;
        while (checkPath && checkPath !== '/' && !fs.existsSync(checkPath)) {
            checkPath = path.dirname(checkPath);
        }

        // Fallback to root if nothing found
        if (!checkPath || checkPath === '') {
            checkPath = '/';
        }

        const diskSpace = await checkDiskSpace(checkPath);
        return { success: true, free: diskSpace.free, size: diskSpace.size };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Create application menu with About dialog
function createMenu() {
    const template = [
        {
            label: app.name,
            submenu: [
                {
                    label: 'About MemSavr',
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'About MemSavr',
                            message: 'MemSavr',
                            detail: `Version: 1.0.6

Archive Memories the Right Way

This software uses FFmpeg (https://ffmpeg.org) 
licensed under GPL v2.0+ (includes GPL codecs).

Not affiliated with Snap Inc. 
Snapchat® is a registered trademark of Snap Inc.

© 2026 Giovanni Lunetta
Licensed under MIT License`,
                            buttons: ['OK']
                        });
                    }
                },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' }
            ]
        },
        {
            label: 'Window',
            submenu: [
                { role: 'minimize' },
                { role: 'zoom' },
                { type: 'separator' },
                { role: 'front' }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Support',
                    click: () => {
                        openExternalSafely('mailto:support@savemymemories.app');
                    }
                },
                { type: 'separator' },
                {
                    label: 'Export Support Logs…',
                    accelerator: 'CmdOrCtrl+Shift+L',
                    click: async () => {
                        try {
                            if (!logger || !supportLogs) {
                                dialog.showErrorBox('Not Ready', 'Logging system not initialized');
                                return;
                            }

                            const filename = supportLogs.getDefaultZipFilename();
                            const result = await dialog.showSaveDialog(mainWindow, {
                                title: 'Export Support Logs',
                                defaultPath: path.join(app.getPath('desktop'), filename),
                                filters: [{ name: 'ZIP Files', extensions: ['zip'] }]
                            });

                            if (result.canceled || !result.filePath) {
                                return;
                            }

                            await supportLogs.createSupportZip(result.filePath);

                            // Show success and reveal file
                            shell.showItemInFolder(result.filePath);

                            // Send event to renderer to show custom modal
                            if (mainWindow && !mainWindow.isDestroyed()) {
                                mainWindow.webContents.send('show-logs-exported-modal', {
                                    filename: path.basename(result.filePath)
                                });
                            }
                        } catch (error) {
                            if (logger) {
                                logger.error('Failed to export logs from menu', { error: error.message });
                            }
                            dialog.showErrorBox('Export Failed', `Error: ${error.message}`);
                        }
                    }
                },
                {
                    label: 'Reveal Logs Folder',
                    click: () => {
                        if (logger) {
                            shell.openPath(logger.getLogDirectory());
                        } else {
                            dialog.showErrorBox('Not Ready', 'Logging system not initialized');
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'View Licenses',
                    click: async () => {
                        const licenseInfo = `This software uses the following third-party components:

• FFmpeg v8.0.1 - GPL v2.0+
  Includes GPL-licensed codecs (libx264, libx265)
  Source: https://github.com/FFmpeg/FFmpeg
  License: See licenses/GPL-2.0.txt in app bundle
  Complete source package: https://savemymemories.app/licenses/ffmpeg-source.zip
  https://ffmpeg.org

• Electron - MIT License

• Python - PSF License

• Pillow - HPND License

• Requests - Apache 2.0

Full license details are included in the LICENSE file 
bundled with this application.`;

                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'Third-Party Licenses',
                            message: 'Third-Party Licenses',
                            detail: licenseInfo,
                            buttons: ['OK']
                        });
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

// Helper to kill orphaned Python processes from previous runs
function cleanupOrphanedProcesses() {
    console.log('[Cleanup] Checking for orphaned Python processes...');
    try {
        if (process.platform === 'darwin' || process.platform === 'linux') {
            // Kill any running instances of our script/binary
            // Dev mode: process_snapchat_memories.py (use full path for safety)
            try {
                const scriptPath = path.join(__dirname, 'python', 'process_snapchat_memories.py');
                // Use spawn to prevent command injection
                const { spawnSync } = require('child_process');
                spawnSync('pkill', ['-f', scriptPath], { shell: false });
                console.log('✓ Killed orphaned process_snapchat_memories.py');
            } catch (e) { /* No process found */ }

            // Prod mode: memory-organizer binary
            try {
                const { spawnSync } = require('child_process');
                spawnSync('pkill', ['-x', 'memory-organizer'], { shell: false });
                console.log('✓ Killed orphaned memory-organizer binary');
            } catch (e) { /* No process found */ }
        } else if (process.platform === 'win32') {
            try {
                const { spawnSync } = require('child_process');
                spawnSync('taskkill', ['/F', '/IM', 'memory-organizer.exe', '/T'], { shell: false });
            } catch (e) { }
        }
    } catch (e) {
        console.warn('[Cleanup] Error during process cleanup:', e.message);
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 900,
        height: 700,
        minWidth: 800,
        minHeight: 650,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        },
        titleBarStyle: 'hiddenInset',
        backgroundColor: '#1a1a2e'
    });

    mainWindow.loadFile('src/index.html');

    // Security: Prevent navigation to external URLs inside the app
    mainWindow.webContents.on('will-navigate', (event, url) => {
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol !== 'file:') {
            event.preventDefault();
            openExternalSafely(url);
        }
    });

    // Security: Open external links in system browser (using safe helper)
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        openExternalSafely(url);
        return { action: 'deny' };
    });
}

// Auto-updater event handlers
autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Available',
        message: `Version ${info.version} is available!`,
        detail: 'A new version of MemSavr is ready to download. Would you like to download it now?',
        buttons: ['Download', 'Later'],
        defaultId: 0,
        cancelId: 1
    }).then(result => {
        if (result.response === 0) {
            autoUpdater.downloadUpdate();
        }
    });
});

autoUpdater.on('update-not-available', () => {
    // Silent - don't bother users if no update
});

autoUpdater.on('download-progress', (progressObj) => {
    // Send progress to renderer if you want a progress bar
    if (mainWindow) {
        mainWindow.webContents.send('download-progress', progressObj.percent);
    }
});

autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Ready',
        message: 'Update downloaded successfully!',
        detail: 'The update will be installed when you restart MemSavr.',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1
    }).then(result => {
        if (result.response === 0) {
            autoUpdater.quitAndInstall();
        }
    });
});

autoUpdater.on('error', (err) => {
    // Silent error handling - don't interrupt user workflow
    console.error('Auto-updater error:', err);
});

app.whenReady().then(() => {
    createWindow();

    // Initialize support logs system AFTER app is ready
    logger = new Logger('main');
    supportLogs = new SupportLogs(logger);

    logger.info('MemSavr started', {
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch
    });

    // Global exception handlers
    process.on('uncaughtException', (error) => {
        if (logger) logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
        lastError = { error, step: 'Uncaught Exception', context: {} };
    });

    process.on('unhandledRejection', (reason) => {
        const msg = (() => {
            if (typeof reason === 'string') return reason;
            try { return JSON.stringify(reason); } catch { return String(reason); }
        })();
        const err = reason instanceof Error ? reason : new Error(msg);

        if (logger) logger.error('Unhandled Rejection', { error: err.message, stack: err.stack });
        lastError = { error: err, step: 'Unhandled Promise Rejection', context: {} };
    });

    createMenu();

    // Check for updates after window is ready (5 second delay)
    setTimeout(() => {
        autoUpdater.checkForUpdates();
    }, 5000);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('before-quit', (e) => {
    if (isQuitting) return;
    isQuitting = true;

    e.preventDefault();

    (async () => {
        try {
            if (logger) {
                logger.info('App shutting down');

                // Timeout safety net - ensure app quits even if flush hangs
                const timeoutMs = 1500;
                const flushTimeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), timeoutMs));
                const flushPromise = logger.flush().then(() => 'flushed').catch(() => 'flush_error');
                const flushResult = await Promise.race([flushPromise, flushTimeout]);

                if (flushResult === 'timeout') {
                    // Timeout won - log warning
                    logger.warn('Logger flush timed out; quitting anyway', { timeoutMs });
                }

                if (flushResult === 'flush_error') {
                    // Flush failed - log warning
                    logger.warn('Logger flush failed; quitting anyway', { timeoutMs });
                }
            }
        } finally {
            app.quit();
        }
    })();
});

app.on('window-all-closed', () => {
    if (pythonProcess) {
        pythonProcess.kill();
    }
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// IPC Handlers

// Open file dialog for ZIP selection
ipcMain.handle('select-zip', async (event) => {
    if (!validateSender(event)) {
        return null;
    }

    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
            { name: 'ZIP Files', extensions: ['zip'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });
    return result.filePaths[0] || null;
});

// Auto-search for mydata~*.zip files
ipcMain.handle('find-zip', async (event) => {
    if (!validateSender(event)) {
        return { success: false, error: 'Unauthorized sender' };
    }

    try {
        const os = require('os');
        const homeDir = os.homedir();
        const { glob } = require('glob');

        // Search for mydata~*.zip files in home directory
        // Limit depth to avoid performance issues
        const pattern = `${homeDir}/**/mydata~*.zip`;
        const options = {
            maxDepth: 5, // Limit search depth
            ignore: ['**/node_modules/**', '**/Library/**', '**/.Trash/**'], // Skip system folders
            nocase: true
        };

        const files = await glob(pattern, options);

        if (files.length === 0) {
            return { success: false, error: 'No mydata~*.zip files found in your home directory' };
        }

        // Return the most recent file (by modification time)
        const filesWithStats = files.map(f => ({
            path: f,
            mtime: fs.statSync(f).mtime
        }));

        filesWithStats.sort((a, b) => b.mtime - a.mtime);

        return { success: true, path: filesWithStats[0].path };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Open folder dialog for output selection
ipcMain.handle('select-folder', async (event) => {
    if (!validateSender(event)) {
        return null;
    }

    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'createDirectory']
    });

    const selectedPath = result.filePaths[0] || null;

    // Track user-approved directories for security validation
    if (selectedPath) {
        const canonical = getCanonicalPath(selectedPath);

        // Security: Prevention of root directory selection
        if (isSensitiveRoot(canonical)) {
            // We can't easily show UI error here as it returns to renderer, 
            // but we can refuse to create an approval entry, effectively failing later checks.
            console.error(`[SECURITY] refused to approve sensitive root: ${canonical}`);
        } else {
            approvedOutputDirs.add(canonical);
        }
    }

    return selectedPath;
});

// Open folder in Finder
ipcMain.handle('open-folder', async (event, folderPath) => {
    if (!validateSender(event)) {
        return { success: false, error: 'Unauthorized sender' };
    }

    // Security: Validate path existence and type
    const canonicalPath = getCanonicalPath(folderPath);

    try {
        if (!fs.existsSync(canonicalPath)) {
            return { success: false, error: 'Path does not exist' };
        }
        const stat = fs.statSync(canonicalPath);
        if (!stat.isDirectory()) {
            console.error(`[SECURITY] Blocked open-folder for non-directory: ${canonicalPath}`);
            return { success: false, error: 'Target is not a directory' };
        }
    } catch (e) {
        return { success: false, error: 'Invalid path' };
    }

    // Security: Only allow opening approved directories or current session dir
    // We strictly verify the CANONICAL path against our approved set.
    // UX Update: Allow subfolders of approved directories.
    const isApproved =
        (currentValidatedOutputDir && isPathInsideDir(canonicalPath, currentValidatedOutputDir)) ||
        Array.from(approvedOutputDirs).some(approvedRoot => isPathInsideDir(canonicalPath, approvedRoot));

    // We removed the broad "safeDefaults" (Documents/Downloads) to prevent arbitrary file access.
    // Users must strictly pick a folder to "approve" it for opening.

    if (!isApproved) {
        console.error(`[SECURITY] Blocked open-folder for unapproved path: ${canonicalPath}`);
        return { success: false, error: 'Access denied: Folder not in approved list.' };
    }

    shell.openPath(canonicalPath);
    return { success: true };
});

// Open URL in browser (ELEC-002: Whitelist protocols)
ipcMain.handle('open-url', async (event, url) => {
    if (!validateSender(event)) {
        return { success: false, error: 'Unauthorized sender' };
    }
    return openExternalSafely(url);
});

// Open external URL (e.g., mailto: links for email)
ipcMain.handle('open-external', async (event, url) => {
    if (!validateSender(event)) {
        return { success: false, error: 'Unauthorized sender' };
    }
    return openExternalSafely(url);
});

// Get default paths
ipcMain.handle('get-defaults', async (event) => {
    if (!validateSender(event)) {
        return { zipPath: null, outputDir: null, error: 'Unauthorized sender' };
    }

    const homeDir = app.getPath('home');
    const downloadsDir = app.getPath('downloads');

    // Try to find mydata*.zip in Downloads
    const fs = require('fs');
    let defaultZip = null;
    try {
        const files = fs.readdirSync(downloadsDir);
        const zipFiles = files.filter(f => f.startsWith('mydata') && f.endsWith('.zip'));
        if (zipFiles.length > 0) {
            // Get newest
            zipFiles.sort((a, b) => {
                return fs.statSync(path.join(downloadsDir, b)).mtime -
                    fs.statSync(path.join(downloadsDir, a)).mtime;
            });
            defaultZip = path.join(downloadsDir, zipFiles[0]);
        }
    } catch (e) {
        console.warn('Could not scan Downloads for mydata ZIP:', e.message);
    }

    return {
        zipPath: defaultZip,
        outputDir: path.join(homeDir, 'Pictures', 'SnapchatMemories')
    };
});

// Get resume manifest (for Trust Manifest mode)
ipcMain.handle('get-resume-manifest', async (event, { outputDir, zipPath }) => {
    if (!validateSender(event)) {
        return { success: false, error: 'Unauthorized sender' };
    }
    if (!outputDir) {
        return { success: false, error: 'Output directory required' };
    }

    const canonicalOutputDir = getCanonicalPath(outputDir);

    if (isSensitiveRoot(canonicalOutputDir)) {
        return { success: false, error: 'Output directory is a restricted system folder.' };
    }

    const homeDir = app.getPath('home');
    const defaultPicDir = path.join(homeDir, 'Pictures', 'SnapchatMemories');
    const canonicalDefault = getCanonicalPath(defaultPicDir);
    const isDefault = canonicalOutputDir === canonicalDefault || canonicalOutputDir.startsWith(canonicalDefault + path.sep);
    const isUserApproved = approvedOutputDirs.has(canonicalOutputDir);

    if (!isDefault && !isUserApproved) {
        return { success: false, error: 'Output directory not approved' };
    }

    // Manifest is stored in PARENT directory (matches Python logic)
    // NEW: Python now creates Processed_Memories_YYYY-MM-DD inside outputDir,
    // so manifest is in outputDir itself. But OLD runs had different structure.
    // Check BOTH locations for backwards compatibility.

    // Location 1: In the selected output directory itself (NEW behavior)
    const manifestInOutput = path.join(canonicalOutputDir, '.batch_progress.json');
    const legacyInOutput = path.join(canonicalOutputDir, '.batch_progress');

    // Location 2: In parent of output directory (OLD behavior)
    const parentDir = path.dirname(canonicalOutputDir);
    const manifestInParent = path.join(parentDir, '.batch_progress.json');
    const legacyInParent = path.join(parentDir, '.batch_progress');

    // Prefer newer location (in output dir) over old location (in parent)
    let pathToUse = null;
    if (fs.existsSync(manifestInOutput)) {
        pathToUse = manifestInOutput;
    } else if (fs.existsSync(legacyInOutput)) {
        pathToUse = legacyInOutput;
    } else if (fs.existsSync(manifestInParent)) {
        pathToUse = manifestInParent;
    } else if (fs.existsSync(legacyInParent)) {
        pathToUse = legacyInParent;
    }

    if (!pathToUse) {
        return { success: true, manifest: null };
    }

    try {
        const data = JSON.parse(fs.readFileSync(pathToUse, 'utf8'));
        let zipMatch;
        if (zipPath && data && data.zip_fingerprint) {
            try {
                const stat = fs.statSync(zipPath);
                const fingerprint = `${path.basename(zipPath)}|${stat.size}|${Math.floor(stat.mtimeMs / 1000)}`;
                zipMatch = fingerprint === data.zip_fingerprint;
            } catch (e) {
                zipMatch = undefined;
            }
        }
        return { success: true, manifest: data, legacy: pathToUse === legacyInOutput || pathToUse === legacyInParent, zipMatch };
    } catch (error) {
        return { success: false, error: 'Manifest corrupted or unreadable' };
    }
});

// Check battery status for power warning
ipcMain.handle('check-battery-status', async (event) => {
    if (!validateSender(event)) {
        return { success: false, onBattery: false };
    }

    try {
        const { spawnSync } = require('child_process');
        const result = spawnSync('pmset', ['-g', 'batt'], { shell: false, encoding: 'utf8' });
        const output = result.stdout || '';
        const isOnBattery = output.includes("'Battery Power'") || output.includes("discharging");
        const isOnAC = output.includes("'AC Power'") || output.includes("AC attached");
        return {
            success: true,
            onBattery: isOnBattery && !isOnAC
        };
    } catch (e) {
        console.warn('Could not check battery status:', e.message);
        return { success: false, onBattery: false };
    }
});

// Stop processing - kill the running process and caffeinate
ipcMain.handle('stop-processing', async (event) => {
    if (!validateSender(event)) {
        return { success: false, error: 'Unauthorized sender' };
    }
    // Kill caffeinate if running
    if (caffeinateProcess) {
        caffeinateProcess.kill();
        caffeinateProcess = null;
    }

    if (pythonProcess) {
        intentionalStop = true; // Flag to prevent error message on process exit
        pythonProcess.kill('SIGTERM');
        pythonProcess = null;
        return { success: true };
    }
    return { success: false, error: 'No process running' };
});

// Clear output folder (for Start Over functionality)
ipcMain.handle('clear-output-folder', async (event, { outputDir }) => {
    if (!validateSender(event)) {
        return { success: false, error: 'Unauthorized sender' };
    }

    // Security: Validate outputDir is approved
    const canonicalOutputDir = getCanonicalPath(outputDir);
    // User requirement: Only allow explicitly approved dirs or the current session dir
    const isUserApproved = approvedOutputDirs.has(canonicalOutputDir);
    const isCurrentSession = currentValidatedOutputDir && canonicalOutputDir === currentValidatedOutputDir;

    // Re-verify it matches confirmed canonical path
    if (!isUserApproved && !isCurrentSession) {
        console.error(`[SECURITY] Rejected unapproved output directory for clearing: ${canonicalOutputDir}`);
        return { success: false, error: 'Output directory not approved.' };
    }

    try {
        // Find and delete Processed_Memories_* folders within the output directory
        if (fs.existsSync(canonicalOutputDir)) {
            const items = fs.readdirSync(canonicalOutputDir);
            for (const item of items) {
                const itemPath = path.join(canonicalOutputDir, item);
                // Delete Processed_Memories folders (with Batch_* inside), Corrupted_Memories, temp, and report files
                if (item.startsWith('Processed_Memories') ||
                    item.startsWith('Corrupted_Memories') ||
                    item.startsWith('temp_processing') ||
                    item === 'detailed_report.json' ||
                    item.startsWith('.memsavr')) {

                    // SECURITY: Use lstat to check for symlinks and NOT follow them
                    const stat = fs.lstatSync(itemPath);
                    if (stat.isSymbolicLink()) {
                        // Unlink the symlink itself, do NOT delete target
                        fs.unlinkSync(itemPath);
                        console.log(`[START OVER] Unlinked symlink: ${item}`);
                    } else if (stat.isDirectory()) {
                        // SECURITY: Validate directory tree has no symlinks before recursive delete
                        const walkAndValidate = (dir) => {
                            const items = fs.readdirSync(dir);
                            for (const subItem of items) {
                                const subPath = path.join(dir, subItem);
                                const subStat = fs.lstatSync(subPath);  // Use lstat to detect symlinks

                                if (subStat.isSymbolicLink()) {
                                    throw new Error(`Found symlink inside directory: ${subPath}`);
                                }

                                if (subStat.isDirectory()) {
                                    walkAndValidate(subPath);  // Recurse into subdirectories
                                }
                            }
                        };

                        try {
                            walkAndValidate(itemPath);
                            fs.rmSync(itemPath, { recursive: true, force: true });
                            console.log(`[START OVER] Deleted directory: ${item}`);
                        } catch (e) {
                            console.error(`[SECURITY] ${e.message}`);
                            if (logger) {
                                logger.warn('Blocked recursive delete due to symlink', { path: itemPath });
                            }
                            // Just unlink the top-level directory entry (don't recurse)
                            fs.unlinkSync(itemPath);
                        }
                    } else {
                        fs.unlinkSync(itemPath);
                        console.log(`[START OVER] Deleted file: ${item}`);
                    }
                }
            }
        }

        // ALSO delete manifest files from BOTH locations (backwards compatibility)
        // Location 1: In output directory itself (NEW behavior)
        const manifestInOutput = path.join(canonicalOutputDir, '.batch_progress.json');
        const legacyInOutput = path.join(canonicalOutputDir, '.batch_progress');

        // Location 2: In parent directory (OLD behavior)
        const parentDir = path.dirname(canonicalOutputDir);
        const manifestInParent = path.join(parentDir, '.batch_progress.json');
        const legacyInParent = path.join(parentDir, '.batch_progress');

        // Delete from all possible locations
        [manifestInOutput, legacyInOutput, manifestInParent, legacyInParent].forEach(filePath => {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`[START OVER] Deleted manifest: ${path.basename(filePath)}`);
            }
        });

        console.log(`[START OVER] Cleared output folder: ${canonicalOutputDir}`);
        return { success: true };
    } catch (error) {
        console.error(`[START OVER] Failed to clear output folder: ${error.message}`);
        return { success: false, error: error.message };
    }
});

// Start processing
ipcMain.handle('start-processing', async (event, { zipPath, outputDir, pauseBetweenBatches, resumeMode }) => {
    if (!validateSender(event)) {
        return { success: false, error: 'Unauthorized sender' };
    }

    // Security: Validate and approve outputDir using CANONICAL path
    // This ensures that "validated value" == "used value".
    // Try to resolve realpath if it exists (it might not yet).
    let canonicalOutputDir = getCanonicalPath(outputDir);

    // If it doesn't exist, we must check the PARENT's approval or standard paths
    // But for simplicity/security, we only allow if the resolved path is approved/safe.

    // Check if this directory was approved via select-folder
    // Note: We removed the "default location" bypass. Explicit approval only.
    const isUserApproved = approvedOutputDirs.has(canonicalOutputDir);

    // Also allow if strict subpath of an approved dir? 
    // For now, strict equality or "is default location" logic.
    // Re-adding restricted default logic: Allow ~/Pictures/SnapchatMemories specifically.
    const homeDir = app.getPath('home');
    const defaultPicDir = path.join(homeDir, 'Pictures', 'SnapchatMemories');
    // Ensure we compare canonicals. Use isPathInsideDir to allow subfolders of the default location.
    const canonicalDefault = getCanonicalPath(defaultPicDir);

    // SECURITY: Deny sensitive roots even if somehow approved
    if (isSensitiveRoot(canonicalOutputDir)) {
        console.error(`[SECURITY] Rejected sensitive root output directory: ${canonicalOutputDir}`);

        // Provide specific error message based on path type
        let errorMsg;
        if (canonicalOutputDir.startsWith('/Volumes/')) {
            const driveName = path.basename(canonicalOutputDir);
            errorMsg = `Cannot use external drive root. Please create a subfolder (e.g., /Volumes/${driveName}/MemSavr_Output)`;
        } else {
            errorMsg = 'Please select a subfolder, not the root Documents/Downloads folder.';
        }

        return { success: false, error: errorMsg };
    }

    // Allow if it IS the default dir OR a subfolder of it
    const isDefault = canonicalOutputDir === canonicalDefault || canonicalOutputDir.startsWith(canonicalDefault + path.sep);

    if (!isDefault && !isUserApproved) {
        console.error(`[SECURITY] Rejected unapproved output directory: ${canonicalOutputDir}`);
        return { success: false, error: 'Output directory not approved. Please use the folder picker.' };
    }

    // Ensure directory exists (create if needed)
    try {
        if (!fs.existsSync(canonicalOutputDir)) {
            fs.mkdirSync(canonicalOutputDir, { recursive: true, mode: 0o700 });
        }

        // TOCTOU PROTECTION: Re-validate AFTER creation
        const postCreateCanonical = fs.realpathSync(canonicalOutputDir);
        if (postCreateCanonical !== canonicalOutputDir) {
            console.error(`[SECURITY] Directory path changed after creation - possible symlink attack`);
            return {
                success: false,
                error: 'Security validation failed: directory path changed after creation'
            };
        }

        // Use lstat (not stat) to detect if target is a symlink
        const stat = fs.lstatSync(canonicalOutputDir);
        if (!stat.isDirectory()) {
            return { success: false, error: 'Output path exists but is not a directory' };
        }
        if (stat.isSymbolicLink()) {
            console.error(`[SECURITY] Output path is a symlink - blocked for security`);
            return { success: false, error: 'Symbolic links are not allowed for output directory' };
        }
    } catch (e) {
        console.error(`[SECURITY] Failed to validate/create output directory: ${e.message}`);
        return { success: false, error: `Cannot access output directory: ${e.message}` };
    }

    // Store validated output directory for secure resume operations
    currentValidatedOutputDir = canonicalOutputDir;

    return new Promise((resolve, reject) => {
        // Find bundled executables
        const isDev = !app.isPackaged;
        const binDir = isDev
            ? path.join(__dirname, 'assets', 'bin')
            : path.join(process.resourcesPath, 'bin');

        const cliPath = path.join(binDir, 'memory-organizer');
        const ffmpegPath = path.join(binDir, 'ffmpeg');

        // Start caffeinate to prevent sleep during processing (Insomniac Mode)
        try {
            caffeinateProcess = spawn('caffeinate', ['-i']);
            caffeinateProcess.on('error', (err) => {
                console.warn('Could not start caffeinate:', err.message);
            });
        } catch (e) {
            console.warn('Caffeinate not available:', e.message);
        }

        // SECURITY: Validate zipPath before passing to subprocess
        if (!zipPath || typeof zipPath !== 'string') {
            return { success: false, error: 'Invalid ZIP path provided' };
        }

        // Verify ZIP file exists and is a regular file (not symlink)
        try {
            const zipStat = fs.lstatSync(zipPath);
            if (!zipStat.isFile() || zipStat.isSymbolicLink()) {
                return { success: false, error: 'ZIP path must be a regular file, not a symlink' };
            }
        } catch (e) {
            return { success: false, error: `Cannot access ZIP file: ${e.message}` };
        }

        // Resolve to canonical path to prevent symlink tricks
        const canonicalZipPath = fs.realpathSync(zipPath);

        // Block paths with special characters that could cause argument injection
        if (canonicalZipPath.includes('\n') || canonicalZipPath.includes('\0')) {
            return { success: false, error: 'ZIP path contains invalid characters' };
        }

        // Build CLI arguments
        // CRITICAL SECURITY: Pass the CANONICAL paths to the CLI
        const cliArgs = [
            '--zip', canonicalZipPath,  // Use validated canonical path
            '--output', canonicalOutputDir // Use validated canonical path
        ];

        if (pauseBetweenBatches) {
            cliArgs.push('--pause-batches');
        }
        if (resumeMode === 'trust') {
            cliArgs.push('--trust-manifest');
        }

        // Process paused check is handled by Python script resume signal logic

        // CLEANUP: Kill any orphaned processes before starting new one
        cleanupOrphanedProcesses();

        // Prepare process environment with logging directory
        const processEnv = {
            ...process.env,
            FFMPEG_PATH: ffmpegPath
        };

        // Add logging directory if logger is initialized
        if (logger) {
            processEnv.MEMSAVR_LOG_DIR = logger.getLogDirectory();
            logger.info('Starting processing', {
                pauseBetweenBatches
            });
        }

        // Spawn the standalone executable
        pythonProcess = spawn(cliPath, cliArgs, {
            stdio: ['pipe', 'pipe', 'pipe'], // Enable stdin for resume signals
            env: processEnv
        });

        pythonProcess.stdout.on('data', (data) => {
            const lines = data.toString().split('\n').filter(l => l.trim());

            // Log sample (first 3 lines only) for debugging - rate limited to avoid queue overflow
            const now = Date.now();
            if (logger && lines.length > 0 && now - lastPythonSampleLogAt > 2000) {
                lastPythonSampleLogAt = now;
                logger.debug('Python output', { sampleLines: lines.slice(0, 3) });
            }

            for (const line of lines) {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    try {
                        const msg = JSON.parse(line);
                        mainWindow.webContents.send('progress-update', msg);
                    } catch (e) {
                        // Regular log line
                        mainWindow.webContents.send('log-message', line);
                    }
                }
            }
        });

        pythonProcess.stderr.on('data', (data) => {
            const output = data.toString();

            // Log first 500 chars of stderr
            if (logger) {
                logger.warn('Python stderr', { output: output.substring(0, 500) });
            }

            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('log-message', output);
            }
        });

        pythonProcess.on('close', (code) => {
            // Log exit code
            if (logger) {
                logger.info('Python process exited', { exitCode: code, intentionalStop });

                // Track error for error report generation
                if (code !== 0 && !intentionalStop) {
                    lastError = {
                        error: new Error(`Python process exited with code ${code}`),
                        step: 'Memory Processing',
                        context: { pythonExitCode: code }
                    };
                }
            }

            // Kill caffeinate when processing ends
            if (caffeinateProcess) {
                caffeinateProcess.kill();
                caffeinateProcess = null;
            }

            pythonProcess = null;

            // Check if this was an intentional stop (user clicked Stop/Cancel/Pause)
            if (intentionalStop) {
                intentionalStop = false; // Reset for next run
                resolve({ success: true, stopped: true });
            } else if (code === 0) {
                resolve({ success: true });
            } else {
                resolve({ success: false, error: `Process exited with code ${code}` });
            }
        });

        pythonProcess.on('error', (err) => {
            // Log spawn error
            if (logger) {
                logger.error('Python process spawn failed', { error: err.message, stack: err.stack });
            }
            lastError = { error: err, step: 'Spawn Memory Organizer', context: {} };

            // Send error to renderer for user feedback
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('log-message', `❌ Fatal Error: ${err.message}`);
            }
            pythonProcess = null;
            reject(err);
        });
    });
});

// Resume batch processing (ELEC-001: Hardened - main process controls file path)
ipcMain.handle('resume-batch', async (event) => {
    if (!validateSender(event)) {
        return { success: false, error: 'Unauthorized sender' };
    }

    // Security: Use hardcoded signal filename inside validated output directory
    if (!currentValidatedOutputDir) {
        console.error('[SECURITY] resume-batch called without validated output directory');
        return { success: false, error: 'No active processing session' };
    }

    const signalFile = path.join(currentValidatedOutputDir, '.memsavr_resume_signal');

    // Security: Double-check the signal file path is inside the validated directory
    if (!isPathInsideDir(signalFile, currentValidatedOutputDir)) {
        console.error(`[SECURITY] Attempted path traversal in resume-batch: ${signalFile}`);
        return { success: false, error: 'Invalid signal file path' };
    }

    try {
        // Create the signal file to trigger Python to continue
        fs.writeFileSync(signalFile, 'RESUME', 'utf8');

        // Verify the file was created
        if (!fs.existsSync(signalFile)) {
            throw new Error('Signal file was not created');
        }

        return { success: true };
    } catch (err) {
        console.error('[IPC] Failed to create resume signal file:', err);
        return { success: false, error: err.message };
    }
});

// Retry corrupted files
ipcMain.handle('retry-corrupted', async (event, { outputDir }) => {
    if (!validateSender(event)) {
        return { success: false, error: 'Unauthorized sender' };
    }

    // Security: Validate outputDir is approved (same logic as start-processing)
    // Use Canonical path
    let canonicalOutputDir = getCanonicalPath(outputDir);

    if (isSensitiveRoot(canonicalOutputDir)) {
        return { success: false, error: 'Output directory is a restricted system folder.' };
    }

    // If not approved/current, reject
    const isUserApproved = approvedOutputDirs.has(canonicalOutputDir);
    const isCurrentSession = canonicalOutputDir === currentValidatedOutputDir;
    // Also check default path logic if relevant, but let's be strict:
    const homeDir = app.getPath('home');
    const defaultPicDir = getCanonicalPath(path.join(homeDir, 'Pictures', 'SnapchatMemories'));

    // Align with start-processing: allow subfolders of default
    const isDefault = canonicalOutputDir === defaultPicDir || canonicalOutputDir.startsWith(defaultPicDir + path.sep);

    if (!isDefault && !isUserApproved && !isCurrentSession) {
        console.error(`[SECURITY] retry-corrupted rejected unapproved outputDir: ${canonicalOutputDir}`);
        return { success: false, error: 'Output directory not approved' };
    }

    return new Promise((resolve, reject) => {
        const fs = require('fs');

        // Find the detailed_report.json
        const reportPath = path.join(canonicalOutputDir, 'detailed_report.json');

        if (!fs.existsSync(reportPath)) {
            resolve({ success: false, error: 'No detailed_report.json found. Run full processing first.' });
            return;
        }

        const isDev = !app.isPackaged;
        const binDir = isDev
            ? path.join(__dirname, 'assets', 'bin')
            : path.join(process.resourcesPath, 'bin');

        const cliPath = path.join(binDir, 'memory-organizer');

        const proc = spawn(cliPath, [
            '--retry-report', reportPath,
            '--output', canonicalOutputDir // Use canonical path
        ]);

        let output = '';
        let stats = null;

        proc.stdout.on('data', (data) => {
            const text = data.toString();
            output += text;

            // Try to parse JSON progress/complete messages
            for (const line of text.split('\n')) {
                if (line.trim().startsWith('{')) {
                    try {
                        const msg = JSON.parse(line);
                        if (msg.type === 'complete' && msg.stats) {
                            stats = msg.stats;
                        }
                    } catch (e) { }
                }
            }

            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('log-message', text);
            }
        });

        proc.stderr.on('data', (data) => {
            output += data.toString();
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('log-message', data.toString());
            }
        });

        proc.on('close', (code) => {
            if (code === 0) {
                resolve({ success: true, message: output, stats });
            } else {
                resolve({ success: false, error: output || 'Retry process failed' });
            }
        });

        proc.on('error', (err) => {
            resolve({ success: false, error: err.message });
        });
    });
});

// License Management

ipcMain.handle('validate-license', async (event, licenseKey) => {
    if (!validateSender(event)) {
        return { success: false, valid: false, message: 'Unauthorized sender' };
    }

    // Rate limiting to prevent brute-force attacks
    if (!checkRateLimit('license-validation')) {
        return {
            success: false,
            valid: false,
            message: 'Too many validation attempts. Please wait 60 seconds and try again.'
        };
    }

    try {
        // Polar.sh License Validation API (uses JSON data)
        // Documentation: https://docs.polar.sh/api/license-keys

        // Use environment variable in development, fallback to hardcoded production ID
        const orgId = process.env.POLAR_ORG_ID || '4fee54f8-96c3-4302-8c3f-e71fd47da3fb';

        const response = await axios.post('https://api.polar.sh/v1/customer-portal/license-keys/validate', {
            key: licenseKey,
            organization_id: orgId
        }, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });

        // Polar.sh returns 200 OK if valid, with license data
        if (response.status === 200 && response.data.id) {
            // Store the validated license
            store.set('license', {
                key: licenseKey,
                valid: true,
                activatedAt: new Date().toISOString(),
                licenseData: response.data
            });

            return {
                success: true,
                valid: true,
                message: 'License activated successfully!',
                data: response.data
            };
        } else {
            return {
                success: true,
                valid: false,
                message: 'Invalid license key'
            };
        }
    } catch (error) {
        const status = error.response?.status;
        const message = error.message;
        if (status) {
            console.error(`License validation failed (status ${status}): ${message}`);
        } else {
            console.error(`License validation failed: ${message}`);
        }
        return {
            success: false,
            valid: false,
            message: error.response?.data?.error || 'Failed to validate license. Please check your internet connection.'
        };
    }
});

ipcMain.handle('get-license-status', async (event) => {
    if (!validateSender(event)) {
        return { valid: false, trial: false };
    }

    const license = store.get('license');

    if (!license || !license.valid) {
        return { valid: false, trial: false };
    }

    // Optional: Re-validate periodically (uncomment if needed)
    // You can add periodic re-validation here to prevent key sharing

    return {
        valid: true,
        activatedAt: license.activatedAt,
        data: license.licenseData
    };
});

ipcMain.handle('clear-license', async (event) => {
    if (!validateSender(event)) {
        return { success: false, error: 'Unauthorized sender' };
    }

    store.delete('license');
    return { success: true };
});
