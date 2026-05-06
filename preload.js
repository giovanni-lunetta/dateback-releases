const { contextBridge, ipcRenderer } = require('electron');

const progressListeners = new Set();
const logListeners = new Set();
const logsExportedListeners = new Set();

function requireString(value, label) {
    if (typeof value !== 'string') {
        throw new Error(`${label} must be a string`);
    }
    const trimmed = value.trim();
    if (!trimmed) {
        throw new Error(`${label} is required`);
    }
    return trimmed;
}

function normalizeOptionalPath(value) {
    if (typeof value !== 'string') {
        return '';
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }
    if (trimmed.includes('\0') || trimmed.includes('\n')) {
        throw new Error('Path contains invalid characters');
    }
    return trimmed;
}

function normalizeFolderPurpose(value) {
    if (value === undefined || value === null) {
        return 'output';
    }
    if (typeof value !== 'string') {
        throw new Error('Folder purpose must be a string');
    }
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) {
        return 'output';
    }
    if (!['output', 'destination', 'staging'].includes(trimmed)) {
        throw new Error('Folder purpose is not supported');
    }
    return trimmed;
}

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('api', {
    // File dialogs
    selectZip: () => ipcRenderer.invoke('select-zip'),
    findZip: () => ipcRenderer.invoke('find-zip'),
    discoverZipSet: (expand) => ipcRenderer.invoke('discover-zip-set', { expand: !!expand }),
    organizeZipSet: (zipPaths, destFolderName) => ipcRenderer.invoke('organize-zip-set', {
        zipPaths: Array.isArray(zipPaths) ? zipPaths : [],
        destFolderName: typeof destFolderName === 'string' ? destFolderName.trim() : '',
    }),
    selectFolder: (purpose) => ipcRenderer.invoke('select-folder', normalizeFolderPurpose(purpose)),
    openFolder: (path) => ipcRenderer.invoke('open-folder', requireString(path, 'Folder path')),
    openUrl: (url) => ipcRenderer.invoke('open-url', requireString(url, 'URL')),
    openExternal: (url) => ipcRenderer.invoke('open-external', requireString(url, 'URL')),

    // Get default paths
    getDefaults: () => ipcRenderer.invoke('get-defaults'),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),

    // Processing
    startProcessing: (args) => ipcRenderer.invoke('start-processing', args && typeof args === 'object' ? args : {}),
    stopProcessing: () => ipcRenderer.invoke('stop-processing'),
    validateZip: (zipPath) => ipcRenderer.invoke('validate-zip', requireString(zipPath, 'ZIP path')),
    resumeBatch: () => ipcRenderer.invoke('resume-batch'),
    getDiskSpace: (path) => ipcRenderer.invoke('get-disk-space', normalizeOptionalPath(path)),
    getDiskFreeBytes: (path) => ipcRenderer.invoke('get-disk-free-bytes', normalizeOptionalPath(path)),
    retryCorrupted: (args) => ipcRenderer.invoke('retry-corrupted', args && typeof args === 'object' ? args : {}),
    clearOutputFolder: (args) => ipcRenderer.invoke('clear-output-folder', args && typeof args === 'object' ? args : {}),
    checkBatteryStatus: () => ipcRenderer.invoke('check-battery-status'),
    getResumeManifest: (args) => ipcRenderer.invoke('get-resume-manifest', args && typeof args === 'object' ? args : {}),

    // Progress callbacks
    onProgressUpdate: (callback) => {
        if (typeof callback !== 'function') return () => { };
        const listener = (_event, data) => callback(data);
        progressListeners.add(listener);
        ipcRenderer.on('progress-update', listener);
        return () => {
            ipcRenderer.removeListener('progress-update', listener);
            progressListeners.delete(listener);
        };
    },
    onLogMessage: (callback) => {
        if (typeof callback !== 'function') return () => { };
        const listener = (_event, data) => callback(data);
        logListeners.add(listener);
        ipcRenderer.on('log-message', listener);
        return () => {
            ipcRenderer.removeListener('log-message', listener);
            logListeners.delete(listener);
        };
    },
    onLogsExported: (callback) => {
        if (typeof callback !== 'function') return () => { };
        const listener = (_event, data) => callback(data);
        logsExportedListeners.add(listener);
        ipcRenderer.on('show-logs-exported-modal', listener);
        return () => {
            ipcRenderer.removeListener('show-logs-exported-modal', listener);
            logsExportedListeners.delete(listener);
        };
    },
    // Cleanup functions to prevent memory leaks
    removeProgressListener: () => {
        for (const listener of progressListeners) {
            ipcRenderer.removeListener('progress-update', listener);
        }
        progressListeners.clear();
    },
    removeLogListener: () => {
        for (const listener of logListeners) {
            ipcRenderer.removeListener('log-message', listener);
        }
        logListeners.clear();
    }
});
