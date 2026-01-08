const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('api', {
    // File dialogs
    selectZip: () => ipcRenderer.invoke('select-zip'),
    findZip: () => ipcRenderer.invoke('find-zip'),
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    openFolder: (path) => ipcRenderer.invoke('open-folder', path),
    openUrl: (url) => ipcRenderer.invoke('open-url', url),
    openExternal: (url) => ipcRenderer.invoke('open-external', url),

    // Get default paths
    getDefaults: () => ipcRenderer.invoke('get-defaults'),

    // Processing
    startProcessing: (args) => ipcRenderer.invoke('start-processing', args),
    stopProcessing: () => ipcRenderer.invoke('stop-processing'),
    validateZip: (zipPath) => ipcRenderer.invoke('validate-zip', zipPath),
    resumeBatch: () => ipcRenderer.invoke('resume-batch'),
    getDiskSpace: (path) => ipcRenderer.invoke('get-disk-space', path),
    retryCorrupted: (args) => ipcRenderer.invoke('retry-corrupted', args),
    clearOutputFolder: (args) => ipcRenderer.invoke('clear-output-folder', args),
    checkBatteryStatus: () => ipcRenderer.invoke('check-battery-status'),
    getResumeManifest: (args) => ipcRenderer.invoke('get-resume-manifest', args),

    // License management
    validateLicense: (licenseKey) => ipcRenderer.invoke('validate-license', licenseKey),
    getLicenseStatus: () => ipcRenderer.invoke('get-license-status'),
    clearLicense: () => ipcRenderer.invoke('clear-license'),

    // Progress callbacks
    onProgressUpdate: (callback) => {
        ipcRenderer.on('progress-update', (event, data) => callback(data));
    },
    onLogMessage: (callback) => {
        ipcRenderer.on('log-message', (event, data) => callback(data));
    },
    onLogsExported: (callback) => {
        ipcRenderer.on('show-logs-exported-modal', (event, data) => callback(data));
    },
    // Cleanup functions to prevent memory leaks
    removeProgressListener: () => {
        ipcRenderer.removeAllListeners('progress-update');
    },
    removeLogListener: () => {
        ipcRenderer.removeAllListeners('log-message');
    }
});
