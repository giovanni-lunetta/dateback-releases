const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const { fileURLToPath } = require('url');
const AdmZip = require('adm-zip');
const checkDiskSpace = require('check-disk-space').default;
const { autoUpdater } = require('electron-updater');
const Logger = require('./src/logger');
const SupportLogs = require('./src/supportLogs');
const { DEFAULT_CACHE_GB, DEFAULT_CACHE_LOW_GB, DEFAULT_MAX_UPLOAD_RETRIES, MAX_ZIP_ENTRIES } = require('./src/constants');
const { sanitizePathInput, getCanonicalPath, isSensitiveRoot, createValidateAndCanonicalizeOutputDir } = require('./src/main/security/paths');
const { openExternalSafely } = require('./src/main/security/urls');

// Load environment variables from .env file only during local development.
if (!app.isPackaged) {
    try {
        require('dotenv').config();
    } catch (_dotenvError) {
        // dotenv is optional in development/test environments.
    }
}

// Configure auto-updater
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowDowngrade = false;  // Prevent downgrade attacks
autoUpdater.allowPrerelease = false; // Only stable releases

let mainWindow;
let pythonProcess = null;
let organizerProcess = null;
let caffeinateProcess = null; // Sleep prevention process
let currentValidatedOutputDir = null; // Store validated output dir for secure resume
let approvedOutputDirs = new Set(); // Track user-approved output directories
let approvedAutoUploadDestinationDirs = new Set(); // Track user-approved cloud destination directories
let approvedAutoUploadStagingDirs = new Set(); // Track user-approved explicit staging directories
let approvedZipFiles = new Set(); // Track exact ZIP files chosen through the file picker
let trustedRendererDocumentKey = null;
let pendingUpdateInfo = null; // Deferred update-available info when a job is running
const TRUSTED_RENDERER_PROTOCOLS = new Set(['file:', 'app:']);
const DEBUG_SECURITY = String(process.env.DATEBACK_DEBUG_SECURITY || '').toLowerCase();
const SECURITY_DEBUG_ENABLED = DEBUG_SECURITY === '1' || DEBUG_SECURITY === 'true' || DEBUG_SECURITY === 'yes' || DEBUG_SECURITY === 'on';

const ORGANIZER_WORKER_STATE_FILE = 'organizer-worker-state.json';
const FOLDER_SELECTION_PURPOSES = new Set(['output', 'destination', 'staging']);

// Support Logs System
let logger = null;
let supportLogs = null;
let lastError = null;
let isQuitting = false;
let lastPythonSampleLogAt = 0; // Rate limit for Python stdout sampling

function respondError(message, errorType) {
    const payload = { success: false, error: message };
    if (errorType) payload.errorType = errorType;
    return payload;
}

function setPythonProcess(proc) {
    pythonProcess = proc;
}

function clearPythonProcess() {
    pythonProcess = null;
}

function setOrganizerProcess(proc) {
    organizerProcess = proc;
}

function clearOrganizerProcess(proc = null) {
    if (!proc || organizerProcess === proc) {
        organizerProcess = null;
        // If a system update arrived while the job was running, show the dialog now
        if (pendingUpdateInfo) {
            const info = pendingUpdateInfo;
            pendingUpdateInfo = null;
            setImmediate(() => showUpdateAvailableDialog(info));
        }
    }
}

function setSessionOutputDir(dirPath) {
    currentValidatedOutputDir = dirPath;
}

function clearSessionOutputDir() {
    currentValidatedOutputDir = null;
}

function restoreSessionOutputDir(previousDir) {
    currentValidatedOutputDir = previousDir;
}

function stopCaffeinateSafely() {
    if (caffeinateProcess) {
        caffeinateProcess.kill();
        caffeinateProcess = null;
    }
}

function startCaffeinateSafely() {
    try {
        if (process.platform === 'win32') {
            caffeinateProcess = spawnProcess('powershell.exe', [
                '-NoProfile', '-NonInteractive', '-Command',
                'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; ' +
                'public class SleepGuard { [DllImport("kernel32.dll")] ' +
                'public static extern uint SetThreadExecutionState(uint f); }\'; ' +
                '[SleepGuard]::SetThreadExecutionState(0x80000001); ' +
                'while($true){Start-Sleep 30}'
            ], { shell: false });
        } else {
            caffeinateProcess = spawnProcess('caffeinate', ['-i'], { shell: false });
        }
        caffeinateProcess.on('error', (err) => {
            console.warn('Could not start sleep prevention:', err.message);
        });
    } catch (e) {
        console.warn('Sleep prevention not available:', e.message);
    }
}

function getAppPath(name) {
    const appGetPath = getMainDep('appGetPath', app.getPath.bind(app));
    return appGetPath(name);
}

function getWorkerStateFilePath() {
    const getWorkerStateFilePathFn = getMainDep(
        'getWorkerStateFilePath',
        () => path.join(getAppPath('userData'), ORGANIZER_WORKER_STATE_FILE)
    );
    return getWorkerStateFilePathFn();
}

function normalizeWorkerMatchToken(value) {
    if (typeof value !== 'string') {
        return '';
    }
    let normalized = value.trim();
    if (!normalized) {
        return '';
    }
    if (path.isAbsolute(normalized)) {
        normalized = getCanonicalPath(normalized);
    }
    normalized = path.normalize(normalized);
    if (process.platform === 'win32') {
        normalized = normalized.toLowerCase();
    }
    return normalized;
}

function buildOrganizerVerificationTokens(organizer) {
    if (!organizer || typeof organizer !== 'object') {
        return [];
    }

    const tokens = [];
    const seen = new Set();
    const addToken = (candidate) => {
        const normalized = normalizeWorkerMatchToken(candidate);
        if (!normalized || seen.has(normalized)) {
            return;
        }
        seen.add(normalized);
        tokens.push(normalized);
    };

    if (typeof organizer.command === 'string' && organizer.command.trim()) {
        addToken(organizer.command);
        addToken(path.basename(organizer.command.trim()));
    }

    if (Array.isArray(organizer.args)) {
        for (const arg of organizer.args) {
            if (typeof arg !== 'string' || !arg.trim()) {
                continue;
            }
            if (path.isAbsolute(arg.trim())) {
                addToken(arg.trim());
                break;
            }
        }
    }

    return tokens;
}

function buildTrackedWorkerState(proc, organizer, extra = {}) {
    const pid = Number(proc?.pid);
    if (!Number.isInteger(pid) || pid <= 0) {
        return null;
    }
    const verificationTokens = buildOrganizerVerificationTokens(organizer);
    if (verificationTokens.length === 0) {
        return null;
    }
    return {
        pid,
        command: typeof organizer?.command === 'string' ? organizer.command : null,
        args: Array.isArray(organizer?.args) ? organizer.args : [],
        verificationTokens,
        updatedAt: new Date().toISOString(),
        ...extra
    };
}

function loadTrackedWorkerStateRecord() {
    const filePath = getWorkerStateFilePath();
    if (!filePath || typeof filePath !== 'string') {
        return { filePath, state: null, parseError: false };
    }

    try {
        if (!fs.existsSync(filePath)) {
            return { filePath, state: null, parseError: false };
        }
        const raw = fs.readFileSync(filePath, 'utf8');
        const state = JSON.parse(raw);
        if (!state || typeof state !== 'object') {
            throw new Error('Worker state file does not contain a JSON object');
        }
        return { filePath, state, parseError: false };
    } catch (error) {
        console.warn('[Cleanup] Could not read worker state file:', error.message);
        return { filePath, state: null, parseError: true };
    }
}

function writeTrackedWorkerState(state) {
    if (!state || typeof state !== 'object') {
        return;
    }

    const filePath = getWorkerStateFilePath();
    if (!filePath || typeof filePath !== 'string') {
        return;
    }

    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
        fs.writeFileSync(filePath, JSON.stringify({
            ...state,
            updatedAt: new Date().toISOString()
        }), 'utf8');
    } catch (error) {
        console.warn('[Cleanup] Could not persist worker state:', error.message);
    }
}

function clearTrackedWorkerState(expectedPid = null) {
    const { filePath, state, parseError } = loadTrackedWorkerStateRecord();
    if (!filePath || typeof filePath !== 'string') {
        return;
    }
    if (!fs.existsSync(filePath)) {
        return;
    }
    if (!parseError && expectedPid !== null && Number(state?.pid) !== Number(expectedPid)) {
        return;
    }

    try {
        fs.unlinkSync(filePath);
    } catch (error) {
        console.warn('[Cleanup] Could not clear worker state file:', error.message);
    }
}

function updateTrackedWorkerState(expectedPid, patch) {
    const { state } = loadTrackedWorkerStateRecord();
    if (!state || Number(state.pid) !== Number(expectedPid)) {
        return;
    }
    writeTrackedWorkerState({
        ...state,
        ...patch
    });
}

function getTrackedWorkerCommandText(pid) {
    const getTrackedWorkerCommandTextFn = getMainDep('getTrackedWorkerCommandText', (targetPid) => {
        const parsedPid = Number(targetPid);
        if (!Number.isInteger(parsedPid) || parsedPid <= 0) {
            return '';
        }
        const spawnSyncFn = getMainDep('spawnSync', spawnSync);

        if (process.platform === 'win32') {
            const result = spawnSyncFn(
                'powershell.exe',
                [
                    '-NoProfile',
                    '-Command',
                    `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${parsedPid}" | Select-Object -First 1; ` +
                    `if ($null -ne $p) { if ($p.CommandLine) { $p.CommandLine }; if ($p.ExecutablePath) { $p.ExecutablePath } }`
                ],
                { shell: false, encoding: 'utf8' }
            );
            if (result.error || result.status !== 0) {
                return '';
            }
            return (result.stdout || '').trim();
        }

        const result = spawnSyncFn('ps', ['-p', String(parsedPid), '-o', 'command='], {
            shell: false,
            encoding: 'utf8'
        });
        if (result.error || result.status !== 0) {
            return '';
        }
        return (result.stdout || '').trim();
    });

    return getTrackedWorkerCommandTextFn(pid);
}

function trackedWorkerStateMatchesCommand(state, commandText) {
    if (!state || !Array.isArray(state.verificationTokens)) {
        return false;
    }
    if (typeof commandText !== 'string' || !commandText.trim()) {
        return false;
    }

    const haystack = process.platform === 'win32'
        ? commandText.toLowerCase()
        : commandText;
    const absoluteTokens = state.verificationTokens.filter((token) => path.isAbsolute(token));
    if (absoluteTokens.length > 0) {
        return absoluteTokens.some((token) => haystack.includes(token));
    }
    return state.verificationTokens.every((token) => haystack.includes(token));
}

function terminateTrackedWorkerProcessTree(pid) {
    const terminateTrackedWorkerProcessTreeFn = getMainDep('terminateTrackedWorkerProcessTree', (targetPid) => {
        const parsedPid = Number(targetPid);
        if (!Number.isInteger(parsedPid) || parsedPid <= 0) {
            return false;
        }
        const spawnSyncFn = getMainDep('spawnSync', spawnSync);

        if (process.platform === 'win32') {
            const result = spawnSyncFn('taskkill', ['/F', '/PID', String(parsedPid), '/T'], {
                shell: false,
                encoding: 'utf8'
            });
            if (result.error) {
                throw result.error;
            }
            return result.status === 0;
        }

        const processKill = getMainDep('processKill', process.kill.bind(process));
        try {
            spawnSyncFn('pkill', ['-TERM', '-P', String(parsedPid)], {
                shell: false,
                encoding: 'utf8'
            });
            processKill(parsedPid, 'SIGTERM');
            return true;
        } catch (error) {
            if (error && error.code === 'ESRCH') {
                return false;
            }
            throw error;
        }
    });

    return terminateTrackedWorkerProcessTreeFn(pid);
}

function persistTrackedWorkerForProcess(proc, organizer, extra = {}) {
    const state = buildTrackedWorkerState(proc, organizer, extra);
    if (state) {
        writeTrackedWorkerState(state);
    }
}

function requestOrganizerShutdown(reason) {
    const activeProc = organizerProcess;
    if (!activeProc) {
        return;
    }

    // Carry the flag on the process object so back-to-back runs can't cross-contaminate.
    activeProc._intentionallyStopped = true;

    const pid = Number(activeProc.pid);
    if (Number.isInteger(pid) && pid > 0) {
        updateTrackedWorkerState(pid, {
            shutdownRequested: true,
            shutdownReason: reason,
            shutdownRequestedAt: new Date().toISOString()
        });
        try {
            terminateTrackedWorkerProcessTree(pid);
        } catch (error) {
            console.warn('[Cleanup] Failed to terminate active organizer during shutdown:', error.message);
            try {
                activeProc.kill('SIGTERM');
            } catch {
                // Best-effort fallback when pid tree termination fails.
            }
        }
    } else if (typeof activeProc.kill === 'function') {
        try {
            activeProc.kill('SIGTERM');
        } catch {
            // Best-effort cleanup.
        }
    }

    clearOrganizerProcess(activeProc);
}

// Security: Normalize renderer document URLs for strict trust checks across dev + packaged builds.
function normalizeRendererDocumentKey(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') {
        return null;
    }
    try {
        const parsed = new URL(rawUrl);
        const protocol = (parsed.protocol || '').toLowerCase();
        if (!TRUSTED_RENDERER_PROTOCOLS.has(protocol)) {
            return null;
        }
        if (protocol === 'file:') {
            let filePath = fileURLToPath(parsed);
            filePath = path.normalize(filePath);
            if (process.platform === 'win32') {
                filePath = filePath.toLowerCase();
            }
            return `file://${filePath}`;
        }

        let pathname = parsed.pathname || '/';
        try {
            pathname = decodeURIComponent(pathname);
        } catch {
            // Keep encoded pathname when decode fails.
        }
        pathname = pathname.replace(/\/+$/, '') || '/';
        return `${protocol}//${parsed.host.toLowerCase()}${pathname}`;
    } catch {
        return null;
    }
}

function redactUrlForLog(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') {
        return '(none)';
    }
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === 'file:') {
            if (SECURITY_DEBUG_ENABLED) {
                return parsed.toString();
            }
            let basename = '';
            try {
                basename = path.basename(fileURLToPath(parsed));
            } catch {
                basename = path.basename(parsed.pathname || '');
            }
            return basename ? `file://.../${basename}` : 'file://...(redacted)';
        }
        return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    } catch {
        return SECURITY_DEBUG_ENABLED ? String(rawUrl) : '(redacted)';
    }
}

function currentMainWindowUrl() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return '';
    }
    return mainWindow.webContents.getURL() || '';
}

function getTrustedRendererDocumentKey() {
    return trustedRendererDocumentKey;
}

function logRejectedIpc(reason, event) {
    const senderUrl = event?.senderFrame?.url || '';
    const mainUrl = currentMainWindowUrl();
    console.error(
        `[SECURITY] Rejected IPC: ${reason}; senderFrame.url=${redactUrlForLog(senderUrl)}; mainWindow.url=${redactUrlForLog(mainUrl)}`
    );
}

// Security: Validate IPC sender origin
function validateSender(event) {
    if (!event || !mainWindow || mainWindow.isDestroyed()) {
        logRejectedIpc('main window unavailable', event);
        return false;
    }

    if (event.sender !== mainWindow.webContents) {
        logRejectedIpc('unexpected webContents', event);
        return false;
    }

    const senderFrame = event.senderFrame;
    const mainFrame = event.sender.mainFrame;
    const senderRoutingId = Number(senderFrame?.routingId);
    const mainRoutingId = Number(mainFrame?.routingId);
    const senderTreeNodeId = Number(senderFrame?.frameTreeNodeId);
    const mainTreeNodeId = Number(mainFrame?.frameTreeNodeId);
    const hasRoutingIds = Number.isFinite(senderRoutingId) && Number.isFinite(mainRoutingId);
    const hasTreeNodeIds = Number.isFinite(senderTreeNodeId) && Number.isFinite(mainTreeNodeId);
    const isMainFrameSender = hasRoutingIds
        ? senderRoutingId === mainRoutingId
        : (hasTreeNodeIds ? senderTreeNodeId === mainTreeNodeId : senderFrame === mainFrame);

    if (!senderFrame || !mainFrame || !isMainFrameSender) {
        logRejectedIpc('non-main-frame sender', event);
        return false;
    }

    const senderUrl = senderFrame.url || event.sender?.getURL?.() || '';
    const senderKey = normalizeRendererDocumentKey(senderUrl);
    const trustedKey = getTrustedRendererDocumentKey() || normalizeRendererDocumentKey(currentMainWindowUrl());
    if (!senderKey || !trustedKey || senderKey !== trustedKey) {
        logRejectedIpc('untrusted frame URL', event);
        return false;
    }
    return true;
}

function isMainTestMode() {
    return process.env.DATEBACK_TEST_MODE === '1' || process.env.NODE_ENV === 'test';
}

function getMainTestOverride(name) {
    if (!isMainTestMode()) {
        return undefined;
    }
    const overrides = globalThis.__DATEBACK_MAIN_TEST_OVERRIDES;
    if (!overrides || typeof overrides !== 'object') {
        return undefined;
    }
    if (!Object.prototype.hasOwnProperty.call(overrides, name)) {
        return undefined;
    }
    return overrides[name];
}

function getMainDep(name, fallback) {
    const override = getMainTestOverride(name);
    return override !== undefined ? override : fallback;
}

function spawnProcess(command, args, options) {
    const spawnFn = getMainDep('spawn', spawn);
    return spawnFn(command, args, options);
}

// Security: Ensure path is inside allowed directory (prevent path traversal)
function isPathInsideDir(filePath, allowedDir) {
    const canonicalFile = getCanonicalPath(filePath);
    const canonicalDir = getCanonicalPath(allowedDir);
    return canonicalFile.startsWith(canonicalDir + path.sep) || canonicalFile === canonicalDir;
}

function normalizeFolderSelectionPurpose(rawPurpose) {
    if (typeof rawPurpose !== 'string') {
        return 'output';
    }
    const purpose = rawPurpose.trim().toLowerCase();
    if (!FOLDER_SELECTION_PURPOSES.has(purpose)) {
        return 'output';
    }
    return purpose;
}

function getApprovedDirectorySetForPurpose(purpose) {
    if (purpose === 'destination') {
        return approvedAutoUploadDestinationDirs;
    }
    if (purpose === 'staging') {
        return approvedAutoUploadStagingDirs;
    }
    return approvedOutputDirs;
}

function getAllApprovedDirectorySets() {
    return [
        approvedOutputDirs,
        approvedAutoUploadDestinationDirs,
        approvedAutoUploadStagingDirs
    ];
}

function approveDirectoryForPurpose(canonicalPath, rawPurpose) {
    const purpose = normalizeFolderSelectionPurpose(rawPurpose);
    getApprovedDirectorySetForPurpose(purpose).add(canonicalPath);
}

function approveZipFile(zipPath) {
    try {
        const canonicalZipPath = getCanonicalPath(zipPath);
        if (canonicalZipPath.toLowerCase().endsWith('.zip')) {
            approvedZipFiles.add(canonicalZipPath);
        }
    } catch {
        // Ignore invalid picker results; later validation will reject them.
    }
}

function isCanonicalInsideHome(canonicalPath) {
    const canonicalHome = getCanonicalPath(app.getPath('home'));
    return canonicalPath === canonicalHome || canonicalPath.startsWith(canonicalHome + path.sep);
}

function isCanonicalInsideApprovedDirectory(canonicalPath) {
    return getAllApprovedDirectorySets().some((approvedSet) => (
        Array.from(approvedSet).some(approvedRoot => isPathInsideDir(canonicalPath, approvedRoot))
    ));
}

function authorizeReadPath(canonicalPath, { allowApprovedZip = false, error }) {
    if (isCanonicalInsideHome(canonicalPath) || isCanonicalInsideApprovedDirectory(canonicalPath)) {
        return { success: true };
    }
    if (allowApprovedZip && approvedZipFiles.has(canonicalPath)) {
        return { success: true };
    }
    return { success: false, error };
}

function findNearestExistingPath(pathToCheck) {
    let checkPath = pathToCheck;
    while (checkPath && checkPath !== '/' && !fs.existsSync(checkPath)) {
        checkPath = path.dirname(checkPath);
    }
    if (!checkPath || checkPath === '') {
        checkPath = '/';
    }
    return checkPath;
}

async function getDiskFreeBytesForPath(pathToCheck) {
    const checkPath = findNearestExistingPath(pathToCheck);

    if (fs.promises && typeof fs.promises.statfs === 'function') {
        const stats = await fs.promises.statfs(checkPath);
        const blockSize = Number(stats.bsize ?? stats.frsize ?? 0);
        const availableBlocks = Number(stats.bavail ?? stats.bfree ?? 0);
        const freeBytes = blockSize * availableBlocks;
        if (Number.isFinite(freeBytes) && freeBytes >= 0) {
            return { freeBytes, volumePath: checkPath };
        }
    }

    const diskSpace = await checkDiskSpace(checkPath);
    return { freeBytes: diskSpace.free, volumePath: checkPath };
}

function ensureCanonicalWritableDirectory(dirPath, label = 'Directory') {
    if (!dirPath || typeof dirPath !== 'string') {
        throw new Error(`${label} path is required`);
    }
    if (dirPath.includes('\0') || dirPath.includes('\n')) {
        throw new Error(`${label} contains invalid characters`);
    }

    const requestedPath = path.resolve(dirPath);
    if (fs.existsSync(requestedPath)) {
        const requestedStat = fs.lstatSync(requestedPath);
        if (requestedStat.isSymbolicLink()) {
            throw new Error(`${label} cannot be a symbolic link`);
        }
    }

    let canonical = getCanonicalPath(requestedPath);

    if (isSensitiveRoot(canonical)) {
        throw new Error(`${label} must be a subfolder, not a root/system folder`);
    }

    if (!fs.existsSync(canonical)) {
        fs.mkdirSync(canonical, { recursive: true, mode: 0o700 });
    }

    canonical = fs.realpathSync(canonical);
    const stat = fs.lstatSync(canonical);
    if (!stat.isDirectory()) {
        throw new Error(`${label} path is not a directory`);
    }
    if (stat.isSymbolicLink()) {
        throw new Error(`${label} cannot be a symbolic link`);
    }

    const probe = path.join(canonical, `.dateback_write_test_${Date.now()}_${Math.random().toString(16).slice(2)}`);
    fs.writeFileSync(probe, 'ok', { encoding: 'utf8' });
    fs.unlinkSync(probe);

    return canonical;
}

function requireApprovedWritableDirectory(dirPath, label, approvedSet, approvalError) {
    const normalizedPath = sanitizePathInput(dirPath, `${label} path`);

    if (isSensitiveRoot(normalizedPath)) {
        throw new Error(`${label} must be a subfolder, not a root/system folder`);
    }

    const canonicalCandidate = getCanonicalPath(normalizedPath);
    if (!approvedSet.has(canonicalCandidate)) {
        throw new Error(approvalError);
    }

    const canonicalWritable = ensureCanonicalWritableDirectory(normalizedPath, label);
    if (canonicalWritable !== canonicalCandidate && !approvedSet.has(canonicalWritable)) {
        throw new Error(`${label} validation changed after creation. Please choose it again with the folder picker.`);
    }
    return canonicalWritable;
}

function getCanonicalDefaultOutputDir() {
    const homeDir = app.getPath('home');
    const defaultPicDir = path.join(homeDir, 'Pictures', 'SnapchatMemories');
    return getCanonicalPath(defaultPicDir);
}

function authorizeOutputDirForOperation(canonicalOutputDir, options = {}) {
    const {
        rejectSensitiveRoot = false,
        sensitiveRootError = 'Output directory is a restricted system folder.',
        allowDefaultSubpath = false,
        allowApprovedExact = false,
        allowCurrentSessionExact = false,
        unapprovedError = 'Output directory not approved',
        unapprovedLogPrefix = null
    } = options;

    if (rejectSensitiveRoot && isSensitiveRoot(canonicalOutputDir)) {
        return { success: false, response: { success: false, error: sensitiveRootError } };
    }

    const canonicalDefault = allowDefaultSubpath ? getCanonicalDefaultOutputDir() : null;
    const isDefault = !!canonicalDefault && (
        canonicalOutputDir === canonicalDefault ||
        canonicalOutputDir.startsWith(canonicalDefault + path.sep)
    );
    const isUserApproved = allowApprovedExact && approvedOutputDirs.has(canonicalOutputDir);
    const isCurrentSession = allowCurrentSessionExact && currentValidatedOutputDir && canonicalOutputDir === currentValidatedOutputDir;

    if (!isDefault && !isUserApproved && !isCurrentSession) {
        if (unapprovedLogPrefix) {
            console.error(`${unapprovedLogPrefix}: ${canonicalOutputDir}`);
        }
        return { success: false, response: { success: false, error: unapprovedError } };
    }

    return { success: true };
}

function authorizeOpenFolderTarget(canonicalPath) {
    return (
        (currentValidatedOutputDir && isPathInsideDir(canonicalPath, currentValidatedOutputDir)) ||
        getAllApprovedDirectorySets().some((approvedSet) => (
            Array.from(approvedSet).some(approvedRoot => isPathInsideDir(canonicalPath, approvedRoot))
        ))
    );
}

function sanitizeAndCanonicalizePath(rawPath, label) {
    let normalizedPath;
    try {
        normalizedPath = sanitizePathInput(rawPath, label);
    } catch (e) {
        return { success: false, response: { success: false, error: e.message } };
    }
    return { success: true, canonicalPath: getCanonicalPath(normalizedPath) };
}

function authorizeCanonicalOutputDir(canonicalOutputDir, options) {
    const outputAuthorization = authorizeOutputDirForOperation(canonicalOutputDir, options);
    if (!outputAuthorization.success) {
        return { success: false, response: outputAuthorization.response };
    }
    return { success: true };
}

function parseJsonFile(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function canonicalizeManifestOutputDir(outputDirValue) {
    if (typeof outputDirValue !== 'string' || !outputDirValue.trim()) {
        return null;
    }
    try {
        return getCanonicalPath(outputDirValue.trim());
    } catch {
        return null;
    }
}

function loadParentOwnedManifest(parentManifestPath, canonicalOutputDir) {
    if (!fs.existsSync(parentManifestPath)) {
        return { owned: false, legacy: false, manifest: null, error: null };
    }

    try {
        const manifest = parseJsonFile(parentManifestPath);
        const manifestOutputDir = canonicalizeManifestOutputDir(manifest?.output_dir);
        if (!manifestOutputDir || manifestOutputDir !== canonicalOutputDir) {
            return { owned: false, legacy: path.basename(parentManifestPath) === '.batch_progress', manifest: null, error: null };
        }
        return {
            owned: true,
            legacy: path.basename(parentManifestPath) === '.batch_progress',
            manifest,
            error: null
        };
    } catch (error) {
        return { owned: false, legacy: path.basename(parentManifestPath) === '.batch_progress', manifest: null, error };
    }
}

function resolveResumeManifestForOutputDir(canonicalOutputDir) {
    const manifestInOutput = path.join(canonicalOutputDir, '.batch_progress.json');
    const legacyInOutput = path.join(canonicalOutputDir, '.batch_progress');
    const parentDir = path.dirname(canonicalOutputDir);
    const manifestInParent = path.join(parentDir, '.batch_progress.json');
    const legacyInParent = path.join(parentDir, '.batch_progress');

    for (const candidate of [manifestInOutput, legacyInOutput]) {
        if (!fs.existsSync(candidate)) {
            continue;
        }
        return {
            pathToUse: candidate,
            legacy: candidate === legacyInOutput,
            ownedFallback: false
        };
    }

    for (const candidate of [manifestInParent, legacyInParent]) {
        const parentManifest = loadParentOwnedManifest(candidate, canonicalOutputDir);
        if (parentManifest.error) {
            continue;
        }
        if (!parentManifest.owned) {
            continue;
        }
        return {
            pathToUse: candidate,
            legacy: parentManifest.legacy,
            ownedFallback: true
        };
    }

    return {
        pathToUse: null,
        legacy: false,
        ownedFallback: false
    };
}

function computeResumeZipSetFingerprint(primaryZipPath) {
    if (!primaryZipPath) {
        return null;
    }

    const zipPaths = new Set([primaryZipPath]);
    const primaryBase = path.basename(primaryZipPath);
    const primaryMatch = primaryBase.match(/^mydata~(\d+)\.zip$/i);

    if (primaryMatch) {
        const zipDir = path.dirname(primaryZipPath);
        const companionRe = new RegExp(`^mydata~${primaryMatch[1]}-\\d+\\.zip$`, 'i');
        for (const entry of fs.readdirSync(zipDir)) {
            if (!companionRe.test(entry)) {
                continue;
            }
            const companionPath = path.join(zipDir, entry);
            const st = fs.statSync(companionPath);
            if (st.isFile()) {
                zipPaths.add(companionPath);
            }
        }
    }

    return [...zipPaths].sort().map((zipPath) => {
        const st = fs.statSync(zipPath);
        return `${path.basename(zipPath)}|${st.size}|${Math.floor(st.mtimeMs / 1000)}`;
    }).join(';');
}

function getStartOverTargets(canonicalOutputDir) {
    const targets = [];
    if (!fs.existsSync(canonicalOutputDir)) {
        return targets;
    }

    const items = fs.readdirSync(canonicalOutputDir);
    for (const item of items) {
        if (
            item.startsWith('Processed_Memories') ||
            item.startsWith('Corrupted_Memories') ||
            item.startsWith('temp_processing') ||
            item === '.staging' ||
            item === 'detailed_report.json' ||
            item === '.upload_ledger.jsonl' ||
            item === '.batch_progress.json' ||
            item === '.batch_progress' ||
            item.startsWith('.dateback')
        ) {
            targets.push({
                name: item,
                itemPath: path.join(canonicalOutputDir, item)
            });
        }
    }

    return targets;
}

function validateStartOverDirectoryTree(dirPath) {
    const items = fs.readdirSync(dirPath);
    for (const subItem of items) {
        const subPath = path.join(dirPath, subItem);
        const subStat = fs.lstatSync(subPath);
        if (subStat.isSymbolicLink()) {
            throw new Error(`Cannot clear output folder because it contains a symbolic link: ${subPath}`);
        }
        if (subStat.isDirectory()) {
            validateStartOverDirectoryTree(subPath);
        }
    }
}

function enforceAuthorizedSender(event, unauthorizedResponse) {
    if (!validateSender(event)) {
        return unauthorizedResponse;
    }
    return null;
}

function validateExternalUrlInput(url) {
    if (typeof url !== 'string' || url.length > 2048) {
        return { success: false, error: 'Invalid URL' };
    }
    return null;
}

const validateAndCanonicalizeOutputDir = createValidateAndCanonicalizeOutputDir({
    approvedOutputDirs,
    getCurrentValidatedOutputDir: () => currentValidatedOutputDir
});

async function resolveAndValidateAutoUploadOptions(
    { autoUpload, destinationDir, cacheGb, cacheLowGb, uploadMode, stagingDir, maxUploadRetries },
    canonicalOutputDir,
    { withDiskPreflight = false, isRetry = false, cacheComputation = null } = {}
) {
    const autoUploadEnabled = !!autoUpload;
    const normalizedUploadMode = uploadMode === 'move' ? 'move' : 'copy';
    const resolvedCacheGb = Number.isFinite(Number(cacheGb)) ? Number(cacheGb) : DEFAULT_CACHE_GB;
    const resolvedCacheLowGb = Number.isFinite(Number(cacheLowGb)) ? Number(cacheLowGb) : DEFAULT_CACHE_LOW_GB;
    const resolvedMaxUploadRetries = Number.isFinite(Number(maxUploadRetries)) ? Number(maxUploadRetries) : DEFAULT_MAX_UPLOAD_RETRIES;
    const providedStagingDir = typeof stagingDir === 'string' && stagingDir.trim().length > 0;

    let canonicalDestinationDir = null;
    let canonicalStagingDir = null;

    if (autoUploadEnabled) {
        if (!destinationDir || typeof destinationDir !== 'string' || destinationDir.trim().length === 0) {
            return { success: false, response: { success: false, error: 'Destination directory is required when Auto Upload is enabled.' } };
        }
        if (resolvedCacheGb <= 0) {
            return { success: false, response: { success: false, error: 'Cache GB must be greater than 0.' } };
        }
        if (resolvedCacheLowGb < 0 || resolvedCacheLowGb > resolvedCacheGb) {
            return { success: false, response: { success: false, error: 'Cache Low GB must be between 0 and Cache GB.' } };
        }
        if (isRetry && resolvedMaxUploadRetries <= 0) {
            return { success: false, response: { success: false, error: 'Max upload retries must be greater than 0.' } };
        }

        try {
            canonicalDestinationDir = requireApprovedWritableDirectory(
                destinationDir.trim(),
                'Destination directory',
                approvedAutoUploadDestinationDirs,
                'Destination directory not approved. Please choose it with the folder picker.'
            );
            const stagingCandidate = providedStagingDir
                ? stagingDir.trim()
                : path.join(canonicalOutputDir, '.staging');
            canonicalStagingDir = providedStagingDir
                ? requireApprovedWritableDirectory(
                    stagingCandidate,
                    'Staging directory',
                    approvedAutoUploadStagingDirs,
                    'Staging directory not approved. Please choose it with the folder picker.'
                )
                : ensureCanonicalWritableDirectory(stagingCandidate, 'Staging directory');
        } catch (e) {
            return { success: false, response: { success: false, errorType: 'PATH_VALIDATION', message: e.message, error: e.message } };
        }

        if (canonicalDestinationDir === canonicalStagingDir) {
            return {
                success: false,
                response: {
                    success: false,
                    errorType: 'PATH_VALIDATION',
                    message: 'Destination and staging folders must be different.',
                    error: 'Destination and staging folders must be different.'
                }
            };
        }

        if (isPathInsideDir(canonicalDestinationDir, canonicalStagingDir)) {
            return {
                success: false,
                response: {
                    success: false,
                    errorType: 'PATH_VALIDATION',
                    message: 'Destination folder cannot be inside the staging folder.',
                    error: 'Destination folder cannot be inside the staging folder.'
                }
            };
        }

        if (isPathInsideDir(canonicalStagingDir, canonicalDestinationDir)) {
            return {
                success: false,
                response: {
                    success: false,
                    errorType: 'PATH_VALIDATION',
                    message: 'Staging folder cannot be inside the destination folder.',
                    error: 'Staging folder cannot be inside the destination folder.'
                }
            };
        }

        if (isPathInsideDir(canonicalDestinationDir, canonicalOutputDir)) {
            return {
                success: false,
                response: {
                    success: false,
                    errorType: 'PATH_VALIDATION',
                    message: 'Destination folder cannot be inside the processing output root.',
                    error: 'Destination folder cannot be inside the processing output root.'
                }
            };
        }

        if (isPathInsideDir(canonicalOutputDir, canonicalDestinationDir)) {
            return {
                success: false,
                response: {
                    success: false,
                    errorType: 'PATH_VALIDATION',
                    message: 'Destination folder cannot be a parent of the processing output root.',
                    error: 'Destination folder cannot be a parent of the processing output root.'
                }
            };
        }

        if (withDiskPreflight) {
            const stagingPathForCheck = canonicalStagingDir || path.join(canonicalOutputDir, '.staging');
            try {
                const { freeBytes, volumePath } = await getDiskFreeBytesForPath(stagingPathForCheck);
                const gib = 1024 ** 3;
                const freeGb = freeBytes / gib;
                const safetyBufferGb = Math.max(10, Math.round((freeGb * 0.10) * 10) / 10);
                const requiredGb = resolvedCacheGb + safetyBufferGb;
                const requiredBytes = requiredGb * gib;
                const roundedFreeGb = Math.round(freeGb * 10) / 10;
                const roundedRequiredGb = Math.round(requiredGb * 10) / 10;

                console.log(`[AUTO UPLOAD PREFLIGHT] free=${roundedFreeGb} GB required=${roundedRequiredGb} GB cache=${resolvedCacheGb} GB buffer=${safetyBufferGb} GB stagingPath=${stagingPathForCheck}`);

                if (freeBytes < requiredBytes) {
                    return {
                        success: false,
                        response: {
                            success: false,
                            errorType: 'DISK_SPACE',
                            message: 'Not enough free disk space on the staging volume for Auto Upload Mode.',
                            details: {
                                free_gb: roundedFreeGb,
                                cache_gb: resolvedCacheGb,
                                safety_buffer_gb: safetyBufferGb,
                                required_gb: roundedRequiredGb,
                                path: stagingPathForCheck,
                                volume_path: volumePath
                            }
                        }
                    };
                }
            } catch (e) {
                return {
                    success: false,
                    response: {
                        success: false,
                        errorType: 'DISK_SPACE',
                        message: `Unable to check free disk space for staging volume: ${e.message}`,
                        details: {
                            cache_gb: resolvedCacheGb,
                            path: stagingPathForCheck
                        }
                    }
                };
            }

            if (cacheComputation && cacheComputation.mode === 'automatic') {
                const freeGb = Number(cacheComputation.freeGb);
                const reserveGb = Number(cacheComputation.reserveGb);
                const volumePath = typeof cacheComputation.volumePath === 'string' ? cacheComputation.volumePath : 'unknown';
                const debugLine = `Auto cache computed: free=${freeGb.toFixed(1)} GB, reserve=${reserveGb.toFixed(1)} GB, cache_gb=${resolvedCacheGb}, cache_low_gb=${resolvedCacheLowGb}, volumePath=${volumePath}`;
                console.log(debugLine);
                if (logger) {
                    logger.debug('Auto cache computed', {
                        freeGb,
                        reserveGb,
                        cacheGb: resolvedCacheGb,
                        cacheLowGb: resolvedCacheLowGb,
                        volumePath
                    });
                }
            }
        }
    }

    return {
        success: true,
        options: {
            autoUploadEnabled,
            normalizedUploadMode,
            resolvedCacheGb,
            resolvedCacheLowGb,
            resolvedMaxUploadRetries,
            providedStagingDir,
            canonicalDestinationDir,
            canonicalStagingDir
        }
    };
}

function buildOrganizerArgsForStart({
    canonicalZipPath,
    canonicalOutputDir,
    pauseBetweenBatches,
    resumeMode,
    autoUploadOptions
}) {
    const cliArgs = [
        '--zip', canonicalZipPath,
        '--output', canonicalOutputDir
    ];

    if (pauseBetweenBatches) {
        cliArgs.push('--pause-batches');
    }
    if (resumeMode === 'trust') {
        cliArgs.push('--trust-manifest');
    }
    if (autoUploadOptions.autoUploadEnabled) {
        cliArgs.push('--auto-upload');
        cliArgs.push('--destination-dir', autoUploadOptions.canonicalDestinationDir);
        cliArgs.push('--cache-gb', String(autoUploadOptions.resolvedCacheGb));
        cliArgs.push('--cache-low-gb', String(autoUploadOptions.resolvedCacheLowGb));
        cliArgs.push('--upload-mode', autoUploadOptions.normalizedUploadMode);
        if (autoUploadOptions.providedStagingDir) {
            cliArgs.push('--staging-dir', autoUploadOptions.canonicalStagingDir);
        }
    }

    return cliArgs;
}

function buildOrganizerArgsForRetry({
    reportPath,
    canonicalOutputDir,
    autoUploadOptions
}) {
    const retryArgs = [
        '--retry-report', reportPath,
        '--output', canonicalOutputDir
    ];

    if (autoUploadOptions.autoUploadEnabled) {
        retryArgs.push('--auto-upload');
        retryArgs.push('--destination-dir', autoUploadOptions.canonicalDestinationDir);
        retryArgs.push('--cache-gb', String(autoUploadOptions.resolvedCacheGb));
        retryArgs.push('--cache-low-gb', String(autoUploadOptions.resolvedCacheLowGb));
        retryArgs.push('--upload-mode', autoUploadOptions.normalizedUploadMode);
        retryArgs.push('--max-upload-retries', String(autoUploadOptions.resolvedMaxUploadRetries));
        if (autoUploadOptions.providedStagingDir) {
            retryArgs.push('--staging-dir', autoUploadOptions.canonicalStagingDir);
        }
    }

    return retryArgs;
}

function prepareStartOrganizerRun({
    isDev,
    cliArgs,
    pauseBetweenBatches,
    autoUploadEnabled,
    cleanupOrphanedProcessesFn,
    resolveOrganizerCommandFn
}) {
    // CLEANUP: Kill any orphaned processes before starting new one
    cleanupOrphanedProcessesFn();
    const organizer = resolveOrganizerCommandFn(isDev, cliArgs);

    const processEnv = buildOrganizerProcessEnv(organizer.ffmpegPath);

    // Add logging directory if logger is initialized
    if (logger) {
        processEnv.DATEBACK_LOG_DIR = logger.getLogDirectory();
        logger.info('Starting processing', {
            pauseBetweenBatches,
            autoUpload: autoUploadEnabled
        });
    }

    return { organizer, processEnv };
}

function prepareRetryOrganizerRun({
    isDev,
    retryArgs,
    resolveOrganizerCommandFn
}) {
    const organizer = resolveOrganizerCommandFn(isDev, retryArgs);
    const processEnv = buildOrganizerProcessEnv(organizer.ffmpegPath);
    if (logger) {
        processEnv.DATEBACK_LOG_DIR = logger.getLogDirectory();
    }
    return { organizer, processEnv };
}

function buildOrganizerProcessEnv(ffmpegPath) {
    const processEnv = {};
    const copyIfPresent = (name) => {
        if (typeof process.env[name] === 'string') {
            processEnv[name] = process.env[name];
        }
    };

    for (const name of ['PATH', 'Path', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG']) {
        copyIfPresent(name);
    }

    for (const [name, value] of Object.entries(process.env)) {
        if (typeof value !== 'string') {
            continue;
        }
        if (
            name === 'LC_ALL'
            || name.startsWith('LC_')
            || name === 'DATEBACK_LOG_DIR'
            || name.startsWith('DATEBACK_LOG_')
            || name.startsWith('DATEBACK_DEBUG')
        ) {
            processEnv[name] = value;
        }
    }

    processEnv.FFMPEG_PATH = ffmpegPath;
    return processEnv;
}

function validateZipArchive(canonicalZipPath) {
    try {
        if (!canonicalZipPath.toLowerCase().endsWith('.zip')) {
            return { found: false, error: 'Selected file is not a ZIP archive.', count: 0 };
        }

        const fsLstatSync = getMainDep('fsLstatSync', fs.lstatSync.bind(fs));
        const zipStat = fsLstatSync(canonicalZipPath);
        if (!zipStat.isFile() || zipStat.isSymbolicLink()) {
            return { found: false, error: 'ZIP path must be a regular file (symlinks are blocked).', count: 0 };
        }

        const AdmZipCtor = getMainDep('AdmZip', AdmZip);
        const zip = new AdmZipCtor(canonicalZipPath);
        const zipEntries = zip.getEntries();

        // ZIP BOMB PROTECTION
        const MAX_ENTRY_SIZE = 500 * 1024 * 1024;  // 500MB per file
        const MAX_TOTAL_SIZE = 50 * 1024 * 1024 * 1024;  // 50GB total uncompressed

        // Check entry count
        if (zipEntries.length > MAX_ZIP_ENTRIES) {
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
}

function validateZipPathForProcessing(zipPath) {
    let normalizedZipPath;
    let canonicalZipPath;

    try {
        normalizedZipPath = sanitizePathInput(zipPath, 'ZIP path');
        canonicalZipPath = getCanonicalPath(normalizedZipPath);
    } catch (error) {
        return { success: false, response: { success: false, error: error.message } };
    }

    const authorization = authorizeReadPath(canonicalZipPath, {
        allowApprovedZip: true,
        error: 'ZIP path is outside approved locations. Please choose it with the file picker.'
    });
    if (!authorization.success) {
        return {
            success: false,
            response: {
                success: false,
                error: authorization.error,
                errorType: 'PATH_VALIDATION'
            }
        };
    }

    try {
        const zipStat = fs.lstatSync(normalizedZipPath);
        if (!zipStat.isFile() || zipStat.isSymbolicLink()) {
            return { success: false, response: { success: false, error: 'ZIP path must be a regular file, not a symlink' } };
        }
        const realZipPath = fs.realpathSync(normalizedZipPath);
        if (realZipPath !== canonicalZipPath) {
            return { success: false, response: { success: false, error: 'ZIP path changed during validation' } };
        }
    } catch (e) {
        return { success: false, response: { success: false, error: `Cannot access ZIP file: ${e.message}` } };
    }

    return { success: true, canonicalZipPath };
}

// Validate ZIP file
ipcMain.handle('validate-zip', async (event, zipPath) => {
    if (!validateSender(event)) {
        return { found: false, error: 'Unauthorized sender', count: 0 };
    }

    try {
        const normalizedZipPath = sanitizePathInput(zipPath, 'ZIP path');
        const canonicalZipPath = getCanonicalPath(normalizedZipPath);
        const authorization = authorizeReadPath(canonicalZipPath, {
            allowApprovedZip: true,
            error: 'ZIP path is outside approved locations. Please choose it with the file picker.'
        });
        if (!authorization.success) {
            return { found: false, error: authorization.error, count: 0 };
        }
        return validateZipArchive(canonicalZipPath);
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
        const requestedPath = (typeof pathToCheck === 'string' && pathToCheck.trim())
            ? sanitizePathInput(pathToCheck, 'Disk check path')
            : app.getPath('home');
        const canonicalRequestedPath = getCanonicalPath(requestedPath);
        const authorization = authorizeReadPath(canonicalRequestedPath, {
            error: 'Disk check path is outside approved locations.'
        });
        if (!authorization.success) {
            return { success: false, error: authorization.error };
        }
        const { freeBytes } = await getDiskFreeBytesForPath(requestedPath);
        const checkPath = findNearestExistingPath(requestedPath);
        const diskSpace = await checkDiskSpace(checkPath);
        return { success: true, free: freeBytes, size: diskSpace.size };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-disk-free-bytes', async (event, pathToCheck) => {
    if (!validateSender(event)) {
        return { success: false, error: 'Unauthorized sender' };
    }

    try {
        const requestedPath = (typeof pathToCheck === 'string' && pathToCheck.trim())
            ? sanitizePathInput(pathToCheck, 'Disk check path')
            : app.getPath('home');
        const canonicalRequestedPath = getCanonicalPath(requestedPath);
        const authorization = authorizeReadPath(canonicalRequestedPath, {
            error: 'Disk check path is outside approved locations.'
        });
        if (!authorization.success) {
            return { success: false, error: authorization.error };
        }
        const { freeBytes, volumePath } = await getDiskFreeBytesForPath(requestedPath);
        return { success: true, freeBytes, volumePath };
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
                    label: 'About DateBack',
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'About DateBack',
                            message: 'DateBack',
                            detail: `Version: ${getAppVersionString()}

Archive Memories the Right Way

This software uses FFmpeg (https://ffmpeg.org) 
licensed under GPL v2.0+ (includes GPL codecs).

Not affiliated with Snap Inc. 
Snapchat® is a registered trademark of Snap Inc.

© 2026 Giovanni Lunetta
Free for personal, non-commercial use. All rights reserved.`,
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
                        openExternalSafely('mailto:support@dateback.app');
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
                    label: 'Support the Project ☕',
                    click: () => {
                        openExternalSafely('https://www.buymeacoffee.com/giovannilunetta');
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
  Complete source package: https://dateback.app/licenses/ffmpeg-source.zip
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

function getAppVersionString() {
    try {
        const version = typeof app.getVersion === 'function' ? app.getVersion() : '';
        if (typeof version === 'string' && version.trim()) {
            return version.trim();
        }
    } catch (_error) {
        // Fall back to a stable placeholder if Electron cannot provide a version.
    }
    return 'Unknown';
}

// Helper to kill orphaned Python processes from previous runs
function cleanupOrphanedProcesses() {
    console.log('[Cleanup] Checking for tracked organizer worker...');
    try {
        const { state, parseError } = loadTrackedWorkerStateRecord();
        if (!state) {
            if (parseError) {
                clearTrackedWorkerState();
            }
            return;
        }

        const trackedPid = Number(state.pid);
        if (!Number.isInteger(trackedPid) || trackedPid <= 0 || !Array.isArray(state.verificationTokens) || state.verificationTokens.length === 0) {
            clearTrackedWorkerState();
            return;
        }

        const commandText = getTrackedWorkerCommandText(trackedPid);
        if (!commandText) {
            clearTrackedWorkerState(trackedPid);
            console.log(`[Cleanup] Removed stale worker state for pid=${trackedPid}`);
            return;
        }

        if (!trackedWorkerStateMatchesCommand(state, commandText)) {
            clearTrackedWorkerState(trackedPid);
            console.log(`[Cleanup] Worker state pid=${trackedPid} did not match a DateBack organizer command; skipping termination.`);
            return;
        }

        writeTrackedWorkerState({
            ...state,
            cleanupRequestedAt: new Date().toISOString()
        });

        const terminated = terminateTrackedWorkerProcessTree(trackedPid);
        if (terminated === false) {
            clearTrackedWorkerState(trackedPid);
            console.log(`[Cleanup] Tracked worker pid=${trackedPid} was already gone.`);
            return;
        }

        console.log(`✓ Terminated tracked organizer worker pid=${trackedPid}`);
    } catch (e) {
        console.warn('[Cleanup] Error during process cleanup:', e.message);
    }
}

function resolveOrganizerCommand(isDev, baseArgs = []) {
    const binDir = isDev
        ? path.join(__dirname, 'assets', 'bin')
        : path.join(process.resourcesPath, 'bin');
    const ext = process.platform === 'win32' ? '.exe' : '';
    const binaryPath = path.join(binDir, `memory-organizer${ext}`);
    const ffmpegPath = path.join(binDir, `ffmpeg${ext}`);

    if (isDev) {
        const devCliPath = path.join(__dirname, 'python', 'cli.py');
        if (fs.existsSync(devCliPath)) {
            const pythonCmd = process.env.DATEBACK_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
            return {
                command: pythonCmd,
                args: [devCliPath, ...baseArgs],
                ffmpegPath
            };
        }
    }

    return {
        command: binaryPath,
        args: baseArgs,
        ffmpegPath
    };
}

function runOrganizerSubprocess({ organizer, env, mode, sessionOutputDir = null }) {
    return new Promise((resolve) => {
        let settled = false;
        const settle = (payload) => {
            if (settled) return;
            settled = true;
            resolve(payload);
        };

        let proc;
        const previousValidatedOutputDir = currentValidatedOutputDir;
        if (mode === 'start') {
            try {
                proc = spawnProcess(organizer.command, organizer.args, {
                    stdio: ['pipe', 'pipe', 'pipe'], // Enable stdin for resume signals
                    env,
                    shell: false
                });
            } catch (err) {
                if (logger) {
                    logger.error('Python process spawn threw synchronously', { error: err.message, stack: err.stack });
                }
                clearTrackedWorkerState();
                settle({ success: false, error: `Failed to start processing: ${err.message}` });
                return;
            }
            setPythonProcess(proc);
            setOrganizerProcess(proc);
            if (typeof sessionOutputDir === 'string' && sessionOutputDir.trim().length > 0) {
                setSessionOutputDir(sessionOutputDir);
            }
        } else {
            try {
                proc = spawnProcess(organizer.command, organizer.args, {
                    env,
                    shell: false
                });
            } catch (err) {
                clearTrackedWorkerState();
                settle({ success: false, error: err.message });
                return;
            }
            setOrganizerProcess(proc);
        }

        persistTrackedWorkerForProcess(proc, organizer, {
            mode
        });

        let output = '';
        let stats = null;
        let runtimeDiskFull = null;
        let lastOrganizerOutputAt = Date.now();
        let stalledEventSent = false;
        const watchdogMs = Number(process.env.DATEBACK_ORGANIZER_WATCHDOG_MS || (5 * 60 * 1000));
        const watchdogTimer = mode === 'start' && Number.isFinite(watchdogMs) && watchdogMs > 0
            ? setInterval(() => {
                if (stalledEventSent || Date.now() - lastOrganizerOutputAt < watchdogMs) {
                    return;
                }
                stalledEventSent = true;
                if (logger) {
                    logger.warn('Memory organizer appears stalled', { watchdogMs });
                }
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('progress-update', {
                        type: 'stalled',
                        schema_version: 1,
                        message: 'DateBack has not received worker progress recently. It is still waiting for the organizer process.'
                    });
                }
            }, Math.min(watchdogMs, 60 * 1000))
            : null;
        if (watchdogTimer && typeof watchdogTimer.unref === 'function') {
            watchdogTimer.unref();
        }

        proc.stdout.on('data', (data) => {
            lastOrganizerOutputAt = Date.now();
            stalledEventSent = false;
            if (mode === 'start') {
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
                            if (msg.type === 'disk_full') {
                                runtimeDiskFull = { ...msg };
                                mainWindow.webContents.send('progress-update', msg);
                                continue;
                            }
                            if (msg.type === 'error' && msg.errorType === 'DISK_FULL') {
                                runtimeDiskFull = {
                                    type: 'disk_full',
                                    ...(msg.details || {}),
                                    message: msg.message || msg.details?.message || 'DateBack stopped because the drive ran out of space.'
                                };
                                mainWindow.webContents.send('progress-update', runtimeDiskFull);
                                continue;
                            }
                            mainWindow.webContents.send('progress-update', msg);
                        } catch (e) {
                            // Regular log line
                            mainWindow.webContents.send('log-message', line);
                        }
                    }
                }
                return;
            }

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
            lastOrganizerOutputAt = Date.now();
            stalledEventSent = false;
            if (mode === 'start') {
                const stderrOutput = data.toString();

                // Log first 500 chars of stderr
                if (logger) {
                    logger.warn('Python stderr', { output: stderrOutput.substring(0, 500) });
                }

                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('log-message', stderrOutput);
                }
                return;
            }

            output += data.toString();
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('log-message', data.toString());
            }
        });

        proc.on('close', (code) => {
            if (watchdogTimer) {
                clearInterval(watchdogTimer);
            }
            if (mode === 'start') {
                // Log exit code
                if (logger) {
                    logger.info('Python process exited', { exitCode: code, intentionalStop: !!proc._intentionallyStopped });

                    // Track error for error report generation
                    if (code !== 0 && !proc._intentionallyStopped) {
                        lastError = {
                            error: new Error(`Python process exited with code ${code}`),
                            step: 'Memory Processing',
                            context: { pythonExitCode: code }
                        };
                    }
                }

                // Kill caffeinate when processing ends
                stopCaffeinateSafely();
                clearPythonProcess();
                clearOrganizerProcess(proc);
                clearTrackedWorkerState(proc.pid);
                clearSessionOutputDir();

                // Check if this was an intentional stop (user clicked Stop/Cancel/Pause)
                if (proc._intentionallyStopped) {
                    settle({ success: true, stopped: true });
                } else if (runtimeDiskFull) {
                    settle({
                        success: false,
                        errorType: 'DISK_FULL',
                        message: runtimeDiskFull.message || 'DateBack stopped because the drive ran out of space.',
                        details: runtimeDiskFull
                    });
                } else if (code === 0) {
                    settle({ success: true });
                } else {
                    settle({ success: false, error: `Process exited with code ${code}` });
                }
                return;
            }

            clearOrganizerProcess(proc);
            clearTrackedWorkerState(proc.pid);
            if (code === 0) {
                settle({ success: true, message: output, stats });
            } else {
                settle({ success: false, error: output || 'Retry process failed' });
            }
        });

        proc.on('error', (err) => {
            if (watchdogTimer) {
                clearInterval(watchdogTimer);
            }
            if (mode === 'start') {
                // Log spawn error
                if (logger) {
                    logger.error('Python process spawn failed', { error: err.message, stack: err.stack });
                }
                lastError = { error: err, step: 'Spawn Memory Organizer', context: {} };

                // Send error to renderer for user feedback
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('log-message', `❌ Fatal Error: ${err.message}`);
                }
                clearPythonProcess();
                clearOrganizerProcess(proc);
                clearTrackedWorkerState(proc?.pid ?? null);
                restoreSessionOutputDir(previousValidatedOutputDir);
                settle({ success: false, error: `Failed to start processing: ${err.message}` });
                return;
            }

            clearOrganizerProcess(proc);
            clearTrackedWorkerState(proc?.pid ?? null);
            settle({ success: false, error: err.message });
        });
    });
}

function createWindow() {
    trustedRendererDocumentKey = null;
    mainWindow = new BrowserWindow({
        width: 900,
        height: 700,
        minWidth: 800,
        minHeight: 650,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false
        },
        titleBarStyle: 'hiddenInset',
        backgroundColor: '#1a1a2e'
    });

    mainWindow.loadFile('src/index.html');

    // Warn before closing while Python is still running
    mainWindow.on('close', async (event) => {
        if (isQuitting || !organizerProcess) return;
        event.preventDefault();
        const { response } = await dialog.showMessageBox(mainWindow, {
            type: 'warning',
            title: 'Processing in Progress',
            message: 'DateBack is still processing your memories.',
            detail: 'Pause processing first to keep your progress safe. Closing now may lose your most recent batch.',
            buttons: ['Keep Working', 'Close Anyway'],
            defaultId: 0,
            cancelId: 0
        });
        if (response === 1) {
            isQuitting = true;
            app.quit();
        }
    });

    mainWindow.webContents.once('did-finish-load', () => {
        const normalized = normalizeRendererDocumentKey(currentMainWindowUrl());
        if (normalized) {
            trustedRendererDocumentKey = normalized;
            if (SECURITY_DEBUG_ENABLED) {
                console.log(`[SECURITY] Trusted renderer key: ${trustedRendererDocumentKey}`);
            }
        } else if (SECURITY_DEBUG_ENABLED) {
            console.warn(`[SECURITY] did-finish-load URL is not an allowed renderer document: ${redactUrlForLog(currentMainWindowUrl())}`);
        }
    });

    // Security: Prevent navigation to external URLs inside the app
    mainWindow.webContents.on('will-navigate', (event, url) => {
        const trustedKey = getTrustedRendererDocumentKey();
        const targetKey = normalizeRendererDocumentKey(url);
        if (trustedKey && targetKey && targetKey === trustedKey) {
            return;
        }
        if (SECURITY_DEBUG_ENABLED) {
            const reason = !trustedKey
                ? 'no trusted renderer key set'
                : (!targetKey ? 'target URL uses non-trusted protocol/document key' : 'target does not match trusted renderer key');
            console.warn(
                `[SECURITY] Blocked untrusted navigation: ${reason}; target=${redactUrlForLog(url)}; trusted=${trustedKey || '(none)'}`
            );
        }
        event.preventDefault();
        let isFileProtocol = false;
        try {
            isFileProtocol = new URL(url).protocol === 'file:';
        } catch {
            isFileProtocol = false;
        }
        if (!isFileProtocol) {
            openExternalSafely(url);
        }
    });

    // Security: Open external links in system browser (using safe helper)
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        let isFileProtocol = false;
        try {
            isFileProtocol = new URL(url).protocol === 'file:';
        } catch {
            isFileProtocol = false;
        }
        if (isFileProtocol) {
            return { action: 'deny' };
        }
        openExternalSafely(url);
        return { action: 'deny' };
    });

    mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
        callback(false);
    });
}

// Auto-updater event handlers
function showUpdateAvailableDialog(info) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Available',
        message: `Version ${info.version} is available!`,
        detail: 'A new version of DateBack is ready to download. Would you like to download it now?',
        buttons: ['Download', 'Later'],
        defaultId: 0,
        cancelId: 1
    }).then(result => {
        if (result.response === 0) {
            autoUpdater.downloadUpdate();
        }
    }).catch(err => console.error('Update dialog error:', err));
}

autoUpdater.on('update-available', (info) => {
    if (organizerProcess) {
        // A job is running — defer the dialog and notify renderer to show banner
        pendingUpdateInfo = info;
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-available-notification', { version: info.version });
        }
    } else {
        showUpdateAvailableDialog(info);
    }
});

autoUpdater.on('update-not-available', () => {
    // Silent - don't bother users if no update
});

autoUpdater.on('download-progress', (_progressObj) => {
    // No renderer UI for download progress; event is a no-op.
});

autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Ready',
        message: 'Update downloaded successfully!',
        detail: 'The update will be installed when you restart DateBack.',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1
    }).then(result => {
        if (result.response === 0) {
            autoUpdater.quitAndInstall();
        }
    }).catch(err => console.error('Update-downloaded dialog error:', err));
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

    logger.info('DateBack started', {
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
            requestOrganizerShutdown('app_before_quit');
            clearPythonProcess();
            stopCaffeinateSafely();
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
    requestOrganizerShutdown('window_all_closed');
    clearPythonProcess();
    stopCaffeinateSafely();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// IPC Handlers

// Open a dialog that accepts a folder, a single ZIP, or multiple ZIPs
ipcMain.handle('select-zip-or-folder', async (event) => {
    if (!validateSender(event)) {
        return null;
    }
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'openDirectory', 'multiSelections'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    for (const selectedPath of result.filePaths) {
        approveZipFile(selectedPath);
    }
    return result.filePaths;
});

// Discover all ZIPs from the same Snapchat export
ipcMain.handle('discover-zip-set', async (event, { expand = false, folderPath = null } = {}) => {
    if (!validateSender(event)) {
        return { success: false, error: 'Unauthorized sender' };
    }

    const homeDir = app.getPath('home');
    const downloadsDir = app.getPath('downloads');
    const desktopDir = path.join(homeDir, 'Desktop');

    const SENSITIVE_ROOTS = new Set([
        downloadsDir,
        desktopDir,
        path.join(homeDir, 'Documents'),
        path.join(homeDir, 'Pictures'),
    ]);

    let canonicalFolderPath = null;

    // Validate folderPath if provided (must be inside home dir, must exist)
    if (folderPath) {
        try {
            const sanitizedFolder = sanitizePathInput(folderPath, 'Folder path');
            canonicalFolderPath = fs.realpathSync(sanitizedFolder);
            const canonicalHome = getCanonicalPath(homeDir);
            if (canonicalFolderPath !== canonicalHome && !canonicalFolderPath.startsWith(canonicalHome + path.sep)) {
                return { success: false, error: 'Folder must be inside your home directory' };
            }
        } catch (e) {
            return { success: false, error: 'Could not access that folder' };
        }
    }

    const PRIMARY_RE = /^mydata~(\d+)\.zip$/i;

    let primaryFiles = [];
    try {
        const { glob } = require('glob');
        const scanRoot = canonicalFolderPath || (expand ? homeDir : downloadsDir);
        const pattern = canonicalFolderPath || !expand
            ? 'mydata~*.zip'
            : '**/mydata~*.zip';
        const opts = {
            cwd: scanRoot,
            absolute: true,
            maxDepth: canonicalFolderPath ? 1 : (expand ? 5 : 1),
            ignore: ['**/node_modules/**', '**/Library/**', '**/.Trash/**'],
            nocase: true,
        };
        const found = await glob(pattern, opts);
        for (const f of found) {
            const base = path.basename(f);
            if (PRIMARY_RE.test(base)) {
                primaryFiles.push(f);
            }
        }
    } catch (e) {
        console.warn('discover-zip-set scan error:', e.message);
        if (e.code === 'EPERM' || e.code === 'EACCES') {
            return { success: false, error: 'Permission denied — check Privacy & Security → Files and Folders in System Settings and allow DateBack to access your Downloads folder.' };
        }
    }

    if (primaryFiles.length === 0) {
        return { success: false, error: 'No Snapchat export ZIP found' };
    }

    // Pick the most recently modified primary
    primaryFiles.sort((a, b) => fs.statSync(b).mtime - fs.statSync(a).mtime);
    const primaryPath = primaryFiles[0];
    const seedFolder = path.dirname(primaryPath);
    const stem = path.basename(primaryPath, '.zip'); // e.g. mydata~1234

    // Find companions: same folder, same stem, -N.zip suffix
    const escapedStem = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const COMPANION_RE = new RegExp(`^${escapedStem}-\\d+\\.zip$`, 'i');
    let companionPaths = [];
    try {
        const entries = fs.readdirSync(seedFolder);
        for (const entry of entries) {
            if (!COMPANION_RE.test(entry)) continue;
            const full = path.join(seedFolder, entry);
            const st = fs.lstatSync(full);
            if (st.isFile()) companionPaths.push(full);
        }
        companionPaths.sort();
    } catch (e) {
        console.warn('discover-zip-set companion scan error:', e.message);
    }

    const needsOrganizing = SENSITIVE_ROOTS.has(seedFolder);

    // Pre-approve the seedFolder so "Open ZIP Folder" works without a separate picker step
    if (!needsOrganizing) {
        approveDirectoryForPurpose(getCanonicalPath(seedFolder), 'output');
    }

    return {
        success: true,
        primaryPath,
        companionPaths,
        totalCount: 1 + companionPaths.length,
        seedFolder,
        needsOrganizing,
    };
});

// Move a set of Snapchat ZIPs into a new organized folder
ipcMain.handle('organize-zip-set', async (event, { zipPaths, destFolderName } = {}) => {
    const unauthorizedResponse = enforceAuthorizedSender(event, { success: false, error: 'Unauthorized sender' });
    if (unauthorizedResponse) return unauthorizedResponse;

    if (!Array.isArray(zipPaths) || zipPaths.length === 0) {
        return { success: false, error: 'zipPaths must be a non-empty array' };
    }
    if (typeof destFolderName !== 'string' || !destFolderName.trim()) {
        return { success: false, error: 'destFolderName is required' };
    }

    const requestedFolderName = destFolderName.trim();
    if (
        path.isAbsolute(requestedFolderName) ||
        requestedFolderName === '.' ||
        requestedFolderName === '..' ||
        requestedFolderName.includes('/') ||
        requestedFolderName.includes('\\')
    ) {
        return { success: false, error: 'Destination folder name must be a single folder inside Pictures/SnapchatMemories' };
    }

    const homeDir = app.getPath('home');
    const canonicalHome = getCanonicalPath(homeDir);
    const picturesDir = path.join(homeDir, 'Pictures');
    const snapchatRoot = path.join(picturesDir, 'SnapchatMemories');
    const destFolder = path.join(snapchatRoot, requestedFolderName);

    // Security: destination must be inside Pictures/SnapchatMemories
    const canonicalRoot = getCanonicalPath(snapchatRoot);
    let canonical = getCanonicalPath(destFolder);
    if (!canonical.startsWith(canonicalRoot + path.sep)) {
        return { success: false, error: 'Destination must be inside Pictures/SnapchatMemories' };
    }

    try {
        fs.mkdirSync(snapchatRoot, { recursive: true });
        fs.mkdirSync(destFolder, { recursive: true });
        const canonicalCreatedRoot = fs.realpathSync(snapchatRoot);
        canonical = fs.realpathSync(destFolder);
        if (!canonical.startsWith(canonicalCreatedRoot + path.sep)) {
            return { success: false, error: 'Destination must be inside Pictures/SnapchatMemories' };
        }
    } catch (e) {
        return { success: false, error: `Could not create folder: ${e.message}` };
    }

    approveDirectoryForPurpose(canonical, 'output');

    const PRIMARY_RE = /^mydata~\d+\.zip$/i;
    const VALID_ZIP_RE = /^mydata~\d+(-\d+)?\.zip$/i;
    let primaryPath = null;

    const movePlans = [];
    const plannedDestinations = new Set();

    // Validate all source and destination paths before moving anything
    for (const src of zipPaths) {
        if (typeof src !== 'string' || !src.trim()) {
            return { success: false, error: 'Invalid ZIP path: must be a non-empty string' };
        }
        const base = path.basename(src);
        if (!VALID_ZIP_RE.test(base)) {
            return { success: false, error: `Invalid ZIP filename: ${base}` };
        }
        const srcCanonical = getCanonicalPath(src);
        if (!srcCanonical.startsWith(canonicalHome + path.sep)) {
            return { success: false, error: `ZIP path must be inside home directory: ${base}` };
        }
        if (isSensitiveRoot(srcCanonical)) {
            return { success: false, error: `Refusing to move from sensitive root: ${base}` };
        }
        let lstat;
        try {
            lstat = fs.lstatSync(srcCanonical);
        } catch (e) {
            return { success: false, error: `ZIP file not found: ${base}` };
        }
        if (!lstat.isFile()) {
            return { success: false, error: `Not a regular file: ${base}` };
        }
        const dest = path.join(canonical, base);
        if (plannedDestinations.has(dest)) {
            return { success: false, error: `Duplicate ZIP filename in selected set: ${base}` };
        }
        plannedDestinations.add(dest);
        if (fs.existsSync(dest)) {
            return { success: false, error: `Destination ZIP already exists: ${base}` };
        }
        movePlans.push({ srcCanonical, base, dest });
    }

    const movedPairs = []; // Track { dest, src } for rollback
    for (const { srcCanonical, base, dest } of movePlans) {
        try {
            fs.renameSync(srcCanonical, dest);
            movedPairs.push({ dest, src: srcCanonical });
            if (PRIMARY_RE.test(base)) primaryPath = dest;
        } catch (e) {
            // Attempt rollback of already-moved files
            for (const { dest: movedDest, src: origSrc } of movedPairs) {
                try { fs.renameSync(movedDest, origSrc); } catch (_) { /* best effort */ }
            }
            return {
                success: false,
                error: `Could not move ${base}: ${e.message}. ${movedPairs.length} file(s) were moved back.`
            };
        }
    }

    return { success: true, primaryPath, folderPath: canonical, movedCount: movedPairs.length };
});

// Open folder dialog for purpose-specific folder selection
ipcMain.handle('select-folder', async (event, purpose = 'output') => {
    const unauthorizedResponse = enforceAuthorizedSender(event, null);
    if (unauthorizedResponse !== null) {
        return unauthorizedResponse;
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
            approveDirectoryForPurpose(canonical, purpose);
        }
    }

    return selectedPath;
});

// Open folder in Finder
ipcMain.handle('open-folder', async (event, folderPath) => {
    const unauthorizedResponse = enforceAuthorizedSender(event, { success: false, error: 'Unauthorized sender' });
    if (unauthorizedResponse) {
        return unauthorizedResponse;
    }

    const canonicalPathResult = sanitizeAndCanonicalizePath(folderPath, 'Folder path');
    if (!canonicalPathResult.success) {
        return canonicalPathResult.response;
    }
    const canonicalPath = canonicalPathResult.canonicalPath;

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
    const isApproved = authorizeOpenFolderTarget(canonicalPath);

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
    const unauthorizedResponse = enforceAuthorizedSender(event, { success: false, error: 'Unauthorized sender' });
    if (unauthorizedResponse) {
        return unauthorizedResponse;
    }
    const invalidUrlResponse = validateExternalUrlInput(url);
    if (invalidUrlResponse) {
        return invalidUrlResponse;
    }
    return openExternalSafely(url);
});

// Open external URL (e.g., mailto: links for email)
ipcMain.handle('open-external', async (event, url) => {
    const unauthorizedResponse = enforceAuthorizedSender(event, { success: false, error: 'Unauthorized sender' });
    if (unauthorizedResponse) {
        return unauthorizedResponse;
    }
    const invalidUrlResponse = validateExternalUrlInput(url);
    if (invalidUrlResponse) {
        return invalidUrlResponse;
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

    // ZIP discovery is now handled by 'discover-zip-set'; get-defaults no longer auto-sets the ZIP.
    let defaultZip = null;

    return {
        zipPath: defaultZip,
        outputDir: path.join(homeDir, 'Pictures', 'SnapchatMemories')
    };
});

ipcMain.handle('get-app-version', async (event) => {
    if (!validateSender(event)) {
        return null;
    }
    return app.getVersion();
});

// Get resume manifest (for Trust Manifest mode)
ipcMain.handle('get-resume-manifest', async (event, payload = {}) => {
    const unauthorizedResponse = enforceAuthorizedSender(event, { success: false, error: 'Unauthorized sender' });
    if (unauthorizedResponse) {
        return unauthorizedResponse;
    }
    const { outputDir, zipPath } = payload && typeof payload === 'object' ? payload : {};
    const canonicalOutputDirResult = sanitizeAndCanonicalizePath(outputDir, 'Output directory');
    if (!canonicalOutputDirResult.success) {
        return canonicalOutputDirResult.response;
    }
    const canonicalOutputDir = canonicalOutputDirResult.canonicalPath;
    const outputAuthorization = authorizeCanonicalOutputDir(canonicalOutputDir, {
        rejectSensitiveRoot: true,
        sensitiveRootError: 'Output directory is a restricted system folder.',
        allowDefaultSubpath: true,
        allowApprovedExact: true,
        allowCurrentSessionExact: false,
        unapprovedError: 'Output directory not approved',
        unapprovedLogPrefix: null
    });
    if (!outputAuthorization.success) {
        return outputAuthorization.response;
    }

    const { pathToUse, legacy } = resolveResumeManifestForOutputDir(canonicalOutputDir);

    if (!pathToUse) {
        return { success: true, manifest: null };
    }

    try {
        const data = parseJsonFile(pathToUse);
        let zipMatch;
        if (zipPath && data && data.zip_fingerprint) {
            try {
                const fingerprint = computeResumeZipSetFingerprint(zipPath);
                zipMatch = fingerprint === data.zip_fingerprint;
            } catch (e) {
                zipMatch = undefined;
            }
        }
        return { success: true, manifest: data, legacy, zipMatch };
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
    stopCaffeinateSafely();

    if (pythonProcess) {
        pythonProcess._intentionallyStopped = true; // Flag to prevent error message on process exit
        const activePid = Number(pythonProcess.pid);
        if (Number.isInteger(activePid) && activePid > 0) {
            updateTrackedWorkerState(activePid, {
                stopRequested: true,
                stopReason: 'manual_stop',
                stopRequestedAt: new Date().toISOString()
            });
            try {
                terminateTrackedWorkerProcessTree(activePid);
            } catch (error) {
                pythonProcess.kill('SIGTERM');
            }
        } else {
            pythonProcess.kill('SIGTERM');
        }
        clearPythonProcess();
        return { success: true };
    }
    return { success: false, error: 'No process running' };
});

// Clear output folder (for Start Over functionality)
ipcMain.handle('clear-output-folder', async (event, payload = {}) => {
    const unauthorizedResponse = enforceAuthorizedSender(event, { success: false, error: 'Unauthorized sender' });
    if (unauthorizedResponse) {
        return unauthorizedResponse;
    }
    const { outputDir } = payload && typeof payload === 'object' ? payload : {};
    const canonicalOutputDirResult = sanitizeAndCanonicalizePath(outputDir, 'Output directory');
    if (!canonicalOutputDirResult.success) {
        return canonicalOutputDirResult.response;
    }
    const canonicalOutputDir = canonicalOutputDirResult.canonicalPath;
    const outputAuthorization = authorizeCanonicalOutputDir(canonicalOutputDir, {
        rejectSensitiveRoot: false,
        allowDefaultSubpath: false,
        allowApprovedExact: true,
        allowCurrentSessionExact: true,
        unapprovedError: 'Output directory not approved.',
        unapprovedLogPrefix: '[SECURITY] Rejected unapproved output directory for clearing'
    });
    if (!outputAuthorization.success) {
        return outputAuthorization.response;
    }

    try {
        const startOverTargets = getStartOverTargets(canonicalOutputDir);

        for (const { itemPath } of startOverTargets) {
            const stat = fs.lstatSync(itemPath);
            if (stat.isDirectory() && !stat.isSymbolicLink()) {
                validateStartOverDirectoryTree(itemPath);
            }
        }

        for (const { name, itemPath } of startOverTargets) {
            const stat = fs.lstatSync(itemPath);
            if (stat.isSymbolicLink()) {
                fs.unlinkSync(itemPath);
                console.log(`[START OVER] Unlinked symlink: ${name}`);
            } else if (stat.isDirectory()) {
                fs.rmSync(itemPath, { recursive: true, force: true });
                console.log(`[START OVER] Deleted directory: ${name}`);
            } else {
                fs.unlinkSync(itemPath);
                console.log(`[START OVER] Deleted file: ${name}`);
            }
        }

        const parentDir = path.dirname(canonicalOutputDir);
        for (const filePath of [path.join(parentDir, '.batch_progress.json'), path.join(parentDir, '.batch_progress')]) {
            const parentManifest = loadParentOwnedManifest(filePath, canonicalOutputDir);
            if (!parentManifest.owned || parentManifest.error || !fs.existsSync(filePath)) {
                continue;
            }
            fs.unlinkSync(filePath);
            console.log(`[START OVER] Deleted manifest: ${path.basename(filePath)}`);
        }

        console.log(`[START OVER] Cleared output folder: ${canonicalOutputDir}`);
        return { success: true };
    } catch (error) {
        if (logger && error && typeof error.message === 'string' && error.message.includes('symbolic link')) {
            logger.warn('Blocked recursive delete due to nested symlink', { path: canonicalOutputDir, error: error.message });
        }
        console.error(`[START OVER] Failed to clear output folder: ${error.message}`);
        return { success: false, error: error.message };
    }
});

// Start processing
ipcMain.handle('start-processing', async (event, payload = {}) => {
    const validateSenderFn = getMainDep('validateSender', validateSender);
    if (!validateSenderFn(event)) {
        return { success: false, error: 'Unauthorized sender' };
    }
    const validateZipPathForProcessingFn = getMainDep('validateZipPathForProcessing', validateZipPathForProcessing);
    const validateOutputDirFn = getMainDep('validateAndCanonicalizeOutputDir', validateAndCanonicalizeOutputDir);
    const resolveAutoUploadOptionsFn = getMainDep('resolveAndValidateAutoUploadOptions', resolveAndValidateAutoUploadOptions);
    const buildStartArgsFn = getMainDep('buildOrganizerArgsForStart', buildOrganizerArgsForStart);
    const resolveOrganizerCommandFn = getMainDep('resolveOrganizerCommand', resolveOrganizerCommand);
    const runOrganizerSubprocessFn = getMainDep('runOrganizerSubprocess', runOrganizerSubprocess);
    const cleanupOrphanedProcessesFn = getMainDep('cleanupOrphanedProcesses', cleanupOrphanedProcesses);
    const {
        zipPath,
        outputDir,
        pauseBetweenBatches,
        resumeMode,
        autoUpload,
        destinationDir,
        cacheGb,
        cacheLowGb,
        uploadMode,
        stagingDir,
        cacheComputation
    } = payload && typeof payload === 'object' ? payload : {};
    const outputValidation = validateOutputDirFn(outputDir, {
        allowCurrentSession: false,
        includeSymlinkPathValidationError: true,
        createIfMissing: true,
        unapprovedError: 'Output directory not approved. Please use the folder picker.',
        unapprovedLogPrefix: '[SECURITY] Rejected unapproved output directory',
        sensitiveRootError: null,
        sensitiveRootLog: true
    });
    if (!outputValidation.success) {
        return outputValidation.response;
    }
    const canonicalOutputDir = outputValidation.canonicalOutputDir;

    const autoUploadEnabled = !!autoUpload;
    const manualCloudUploadEnabled = !!pauseBetweenBatches;
    if (autoUploadEnabled && manualCloudUploadEnabled) {
        return {
            success: false,
            errorType: 'MODE_CONFLICT',
            message: 'Choose either Store Memories on Cloud or Store Memories on Computer with Pause after batch (not both).',
            error: 'Choose either Store Memories on Cloud or Store Memories on Computer with Pause after batch (not both).'
        };
    }

    const zipValidation = validateZipPathForProcessingFn(zipPath);
    if (!zipValidation.success) {
        return zipValidation.response;
    }
    const canonicalZipPath = zipValidation.canonicalZipPath;

    const autoUploadValidation = await resolveAutoUploadOptionsFn(
        { autoUpload, destinationDir, cacheGb, cacheLowGb, uploadMode, stagingDir, maxUploadRetries: undefined },
        canonicalOutputDir,
        { withDiskPreflight: true, isRetry: false, cacheComputation }
    );
    if (!autoUploadValidation.success) {
        return autoUploadValidation.response;
    }
    const autoUploadOptions = autoUploadValidation.options;

    return new Promise((resolve) => {
        let settled = false;
        const settle = (payload) => {
            if (settled) return;
            settled = true;
            resolve(payload);
        };

        // Find bundled executables
        const isDev = !app.isPackaged;

        // Reset approved dirs for this run — currentValidatedOutputDir covers open-folder for the session.
        approvedOutputDirs.clear();
        approvedAutoUploadDestinationDirs.clear();
        approvedAutoUploadStagingDirs.clear();
        approvedOutputDirs.add(canonicalOutputDir);
        if (autoUploadOptions && autoUploadOptions.canonicalDestinationDir) {
            approvedAutoUploadDestinationDirs.add(autoUploadOptions.canonicalDestinationDir);
        }
        if (autoUploadOptions && autoUploadOptions.canonicalStagingDir) {
            approvedAutoUploadStagingDirs.add(autoUploadOptions.canonicalStagingDir);
        }

        // Build CLI arguments
        // CRITICAL SECURITY: Pass the CANONICAL paths to the CLI
        const cliArgs = [
            ...buildStartArgsFn({
                canonicalZipPath,
                canonicalOutputDir,
                pauseBetweenBatches,
                resumeMode,
                autoUploadOptions
            })
        ];

        // Process paused check is handled by Python script resume signal logic

        // Start caffeinate only after synchronous start validation has passed.
        startCaffeinateSafely();

        const { organizer, processEnv } = prepareStartOrganizerRun({
            isDev,
            cliArgs,
            pauseBetweenBatches,
            autoUploadEnabled,
            cleanupOrphanedProcessesFn,
            resolveOrganizerCommandFn
        });
        runOrganizerSubprocessFn({
            organizer,
            env: processEnv,
            mode: 'start',
            sessionOutputDir: canonicalOutputDir
        }).then(settle);
    });
});

// Resume batch processing (ELEC-001: Hardened - main process controls file path)
ipcMain.handle('resume-batch', async (event) => {
    const unauthorizedResponse = enforceAuthorizedSender(event, { success: false, error: 'Unauthorized sender' });
    if (unauthorizedResponse) {
        return unauthorizedResponse;
    }

    // Security: Use hardcoded signal filename inside validated output directory
    if (!currentValidatedOutputDir) {
        console.error('[SECURITY] resume-batch called without validated output directory');
        return { success: false, error: 'No active processing session' };
    }

    const signalFile = path.join(currentValidatedOutputDir, '.dateback_resume_signal');

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
ipcMain.handle('retry-corrupted', async (event, {
    outputDir,
    autoUpload,
    destinationDir,
    cacheGb,
    cacheLowGb,
    uploadMode,
    stagingDir,
    maxUploadRetries
} = {}) => {
    const validateSenderFn = getMainDep('validateSender', validateSender);
    if (!validateSenderFn(event)) {
        return { success: false, error: 'Unauthorized sender' };
    }
    const validateOutputDirFn = getMainDep('validateAndCanonicalizeOutputDir', validateAndCanonicalizeOutputDir);
    const resolveAutoUploadOptionsFn = getMainDep('resolveAndValidateAutoUploadOptions', resolveAndValidateAutoUploadOptions);
    const buildRetryArgsFn = getMainDep('buildOrganizerArgsForRetry', buildOrganizerArgsForRetry);
    const resolveOrganizerCommandFn = getMainDep('resolveOrganizerCommand', resolveOrganizerCommand);
    const runOrganizerSubprocessFn = getMainDep('runOrganizerSubprocess', runOrganizerSubprocess);
    const fsExistsSyncFn = getMainDep('fsExistsSync', fs.existsSync.bind(fs));
    const outputValidation = validateOutputDirFn(outputDir, {
        allowCurrentSession: true,
        includeSymlinkPathValidationError: false,
        createIfMissing: false,
        unapprovedError: 'Output directory not approved',
        unapprovedLogPrefix: '[SECURITY] retry-corrupted rejected unapproved outputDir',
        sensitiveRootError: 'Output directory is a restricted system folder.',
        sensitiveRootLog: false
    });
    if (!outputValidation.success) {
        return outputValidation.response;
    }
    const canonicalOutputDir = outputValidation.canonicalOutputDir;

    const autoUploadValidation = await resolveAutoUploadOptionsFn(
        { autoUpload, destinationDir, cacheGb, cacheLowGb, uploadMode, stagingDir, maxUploadRetries },
        canonicalOutputDir,
        { withDiskPreflight: false, isRetry: true, cacheComputation: null }
    );
    if (!autoUploadValidation.success) {
        return autoUploadValidation.response;
    }
    const autoUploadOptions = autoUploadValidation.options;

    return new Promise((resolve) => {
        // Find the detailed_report.json
        const reportPath = path.join(canonicalOutputDir, 'detailed_report.json');

        if (!fsExistsSyncFn(reportPath)) {
            resolve({ success: false, error: 'No detailed_report.json found. Run full processing first.' });
            return;
        }

        const isDev = !app.isPackaged;
        const retryArgs = buildRetryArgsFn({
            reportPath,
            canonicalOutputDir,
            autoUploadOptions
        });
        const { organizer, processEnv } = prepareRetryOrganizerRun({
            isDev,
            retryArgs,
            resolveOrganizerCommandFn
        });
        runOrganizerSubprocessFn({
            organizer,
            env: processEnv,
            mode: 'retry'
        }).then(resolve);
    });
});
