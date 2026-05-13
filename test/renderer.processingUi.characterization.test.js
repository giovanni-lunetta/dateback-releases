const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const helpers = require(path.resolve(__dirname, '..', 'src', 'renderer.helpers.js'));

function extractNamedFunctionSource(source, functionName) {
    const asyncSignature = `async function ${functionName}(`;
    const syncSignature = `function ${functionName}(`;
    let start = source.indexOf(asyncSignature);
    if (start < 0) {
        start = source.indexOf(syncSignature);
    }
    assert.ok(start >= 0, `Could not find ${functionName} in renderer.js`);

    const paramsStart = source.indexOf('(', start);
    assert.ok(paramsStart >= 0, `Could not find parameter list for ${functionName}`);

    let parenDepth = 0;
    let bodyStart = -1;
    for (let i = paramsStart; i < source.length; i++) {
        const ch = source[i];
        if (ch === '(') parenDepth += 1;
        if (ch === ')') parenDepth -= 1;
        if (parenDepth === 0) {
            bodyStart = source.indexOf('{', i);
            break;
        }
    }
    assert.ok(bodyStart >= 0, `Could not find opening brace for ${functionName}`);

    let depth = 0;
    for (let i = bodyStart; i < source.length; i++) {
        const ch = source[i];
        if (ch === '{') depth += 1;
        if (ch === '}') depth -= 1;
        if (depth === 0) {
            return source.slice(start, i + 1);
        }
    }

    throw new Error(`Could not extract full function source for ${functionName}`);
}

function createClassList(initialClasses = []) {
    const set = new Set(initialClasses);
    return {
        add(name) {
            set.add(name);
        },
        remove(name) {
            set.delete(name);
        },
        toggle(name, force) {
            if (typeof force === 'boolean') {
                if (force) set.add(name);
                else set.delete(name);
                return force;
            }
            if (set.has(name)) {
                set.delete(name);
                return false;
            }
            set.add(name);
            return true;
        },
        contains(name) {
            return set.has(name);
        }
    };
}

function createElement(initialClasses = []) {
    return {
        classList: createClassList(initialClasses),
        style: {},
        value: '',
        checked: false,
        disabled: false,
        textContent: '',
        innerHTML: '',
        open: false
    };
}

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

async function flushAsync() {
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
}

function buildProcessingUiContext({
    startResult = { success: false, error: 'captured-failure' }
} = {}) {
    const GIB = 1024 * 1024 * 1024;
    const deferredStart = createDeferred();
    const calls = {
        updateAutoUploadUiState: 0,
        updateStartButtonState: 0,
        checkStorage: 0
    };

    const zipPathInput = createElement();
    zipPathInput.value = '/tmp/input.zip';
    const outputPathInput = createElement();
    outputPathInput.value = '/tmp/output';
    const destinationPathInput = createElement();
    destinationPathInput.value = '/tmp/dest';
    const stagingPathInput = createElement();
    stagingPathInput.value = '/tmp/staging';
    const pauseAfterBatchCheckbox = createElement();
    pauseAfterBatchCheckbox.checked = false;

    const cacheGbInput = createElement();
    cacheGbInput.value = '5';
    const cacheLowGbInput = createElement();
    cacheLowGbInput.value = '3';
    const uploadModeSelect = createElement();
    uploadModeSelect.value = 'copy';

    const cacheLowSpaceWarning = createElement(['hidden']);
    const storageWarning = createElement(['hidden']);
    const progressTextContent = createElement();
    const progressEta = createElement();
    const progressFill = createElement(['complete']);
    progressFill.style.width = '45%';
    progressFill.style.background = 'var(--accent-red)';
    const progressBar = createElement(['ready']);
    const progressText = createElement(['processing']);
    const logOutput = createElement();
    logOutput.textContent = 'old logs';
    const btnStop = createElement(['hidden']);
    const btnStart = createElement();
    const btnClearFile = createElement();
    const btnBrowseOutput = createElement();
    const computerModeCheckbox = createElement();
    const cloudModeCheckbox = createElement();
    const btnBrowseDestination = createElement();
    const btnBrowseStaging = createElement();
    const diskUsageAutoRadio = createElement();
    const diskUsageManualRadio = createElement();
    const resumeRestartContainer = createElement(['hidden']);
    const btnOpenFolder = createElement();
    const restartCompleteButton = createElement(['hidden']);

    const context = {
        Date,
        Number,
        GIB,
        navigator: { onLine: true },
        console: { log: () => { }, warn: () => { }, error: () => { } },
        alert: (message) => {
            throw new Error(`Unexpected alert: ${message}`);
        },
        window: {
            api: {
                getDiskSpace: async () => ({ success: true, free: 100 * GIB }),
                checkBatteryStatus: async () => ({ success: true, onBattery: false }),
                startProcessing: async () => deferredStart.promise
            }
        },
        document: {
            getElementById: (id) => {
                if (id === 'progress-text-content') return progressTextContent;
                if (id === 'btn-restart-complete') return restartCompleteButton;
                return createElement();
            }
        },
        zipPathInput,
        outputPathInput,
        destinationPathInput,
        stagingPathInput,
        pauseAfterBatchCheckbox,
        cacheGbInput,
        cacheLowGbInput,
        uploadModeSelect,
        cacheLowSpaceWarning,
        storageWarning,
        progressTextContent,
        progressEta,
        progressFill,
        progressBar,
        progressText,
        logOutput,
        btnStop,
        btnStart,
        btnClearFile,
        btnBrowseOutput,
        computerModeCheckbox,
        cloudModeCheckbox,
        btnBrowseDestination,
        btnBrowseStaging,
        diskUsageAutoRadio,
        diskUsageManualRadio,
        resumeRestartContainer,
        btnOpenFolder,
        currentOutputDir: '/tmp/output',
        resolveRunModeFlagsHelper: helpers.resolveRunModeFlags,
        buildStartProcessingArgsHelper: helpers.buildStartProcessingArgs,
        computeProcessingUiStateHelper: helpers.computeProcessingUiState,
        validateCloudDestinationForCurrentMode: () => ({ valid: true, message: '' }),
        updateSyncFolderWarning: () => { },
        isAllowedCloudFolder: () => false,
        showOfflineWarning: async () => true,
        resolveAutoCacheForStart: async () => ({
            cacheGb: 5,
            cacheLowGb: 3,
            freeGb: 100,
            reserveGb: 10,
            volumePath: '/tmp/output',
            lowSpaceWarning: false
        }),
        computeAutoUploadPreflight: (cacheGb, freeBytes) => ({
            freeBytes,
            freeGb: freeBytes / GIB,
            safetyBufferGb: 0,
            requiredGb: cacheGb,
            requiredBytes: cacheGb * GIB
        }),
        roundOneDecimal: (value) => Math.round(value * 10) / 10,
        showDiskSpaceBlockingModal: async () => { },
        showStorageWarningModal: async () => true,
        formatBytes: (bytes) => `${bytes}B`,
        showBatteryWarning: async () => true,
        revealRecoveryUi: (hint = '') => {
            progressEta.textContent = hint;
        },
        updateAutoUploadUiState: () => {
            calls.updateAutoUploadUiState += 1;
        },
        updateStartButtonState: () => {
            calls.updateStartButtonState += 1;
        },
        checkStorage: async () => {
            calls.checkStorage += 1;
        },
        getStorageMode: () => 'COMPUTER',
        getDiskUsageMode: () => 'automatic',
        syncStorageModeFromControls: () => 'COMPUTER',
        currentMemoryCount: 0,
        etaTimestamps: [],
        lastProgressCount: 0,
        lastProgressTime: 0,
        lastUploadUiUpdateAt: 0,
        lastStorageEstimate: null,
        hasProcessedBefore: false,
        expiredLinkAlertShown: false,
        stoppedByUser: false,
        isProcessing: false,
        startProcessingInFlight: false
    };

    const rendererSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer.js'), 'utf8');
    const getEffectiveOutputDirSource = extractNamedFunctionSource(rendererSource, 'getEffectiveOutputDir');
    const friendlyErrorHintSource = extractNamedFunctionSource(rendererSource, 'friendlyErrorHint');
    const enterNeedsAttentionStateSource = extractNamedFunctionSource(rendererSource, 'enterNeedsAttentionState');
    const applyProcessingUiStateSource = extractNamedFunctionSource(rendererSource, 'applyProcessingUiState');
    const startProcessingRoutineSource = extractNamedFunctionSource(rendererSource, 'startProcessingRoutine');
    const vmContext = vm.createContext(context);
    const script = new vm.Script(`
const resolveRunModeFlagsHelper = this.resolveRunModeFlagsHelper;
const buildStartProcessingArgsHelper = this.buildStartProcessingArgsHelper;
const computeProcessingUiStateHelper = this.computeProcessingUiStateHelper;
const GIB = this.GIB;
${getEffectiveOutputDirSource}
${friendlyErrorHintSource}
${enterNeedsAttentionStateSource}
${applyProcessingUiStateSource}
${startProcessingRoutineSource}
this.__startProcessingRoutine = startProcessingRoutine;
`);
    script.runInContext(vmContext);

    return {
        vmContext,
        calls,
        elements: {
            btnStart,
            btnStop,
            btnClearFile,
            btnBrowseOutput,
            computerModeCheckbox,
            cloudModeCheckbox,
            pauseAfterBatchCheckbox,
            btnBrowseDestination,
            btnBrowseStaging,
            cacheGbInput,
            cacheLowGbInput,
            uploadModeSelect,
            diskUsageAutoRadio,
            diskUsageManualRadio,
            resumeRestartContainer,
            progressFill,
            progressBar,
            progressText,
            progressTextContent,
            progressEta,
            logOutput
        },
        deferredStart,
        resolveWithDefault() {
            deferredStart.resolve(startResult);
        }
    };
}

test('processing UI transition: entering running state sets expected locks/visibility/resets', async () => {
    const { vmContext, elements, deferredStart } = buildProcessingUiContext();

    const routinePromise = vmContext.__startProcessingRoutine(false, 'verify');
    await flushAsync();

    assert.equal(vmContext.isProcessing, true);
    assert.equal(elements.btnStart.classList.contains('hidden'), true);
    assert.equal(elements.btnStop.classList.contains('hidden'), false);
    assert.equal(elements.resumeRestartContainer.classList.contains('hidden'), true);
    assert.equal(elements.btnBrowseOutput.disabled, true);
    assert.equal(elements.computerModeCheckbox.disabled, true);
    assert.equal(elements.cloudModeCheckbox.disabled, true);
    assert.equal(elements.pauseAfterBatchCheckbox.disabled, true);
    assert.equal(elements.btnBrowseDestination.disabled, true);
    assert.equal(elements.btnBrowseStaging.disabled, true);
    assert.equal(elements.cacheGbInput.disabled, true);
    assert.equal(elements.cacheLowGbInput.disabled, true);
    assert.equal(elements.uploadModeSelect.disabled, true);
    assert.equal(elements.diskUsageAutoRadio.disabled, true);
    assert.equal(elements.diskUsageManualRadio.disabled, true);
    assert.equal(elements.btnClearFile.disabled, true);
    assert.equal(elements.progressFill.style.background, '');
    assert.equal(elements.progressFill.classList.contains('complete'), false);
    assert.equal(elements.progressBar.classList.contains('ready'), false);
    assert.equal(elements.progressFill.style.width, '0%');
    assert.equal(elements.progressTextContent.textContent, 'Starting...');
    assert.equal(elements.progressEta.textContent, '');
    assert.equal(elements.logOutput.textContent, '');

    deferredStart.resolve({ success: false, error: 'captured-failure' });
    await routinePromise;
});

test('processing UI transition: exiting running state restores controls and final stop visibility', async () => {
    const { vmContext, elements, calls, resolveWithDefault } = buildProcessingUiContext({
        startResult: { success: false, error: 'captured-failure' }
    });

    const routinePromise = vmContext.__startProcessingRoutine(false, 'verify');
    await flushAsync();
    resolveWithDefault();
    await routinePromise;

    assert.equal(vmContext.isProcessing, false);
    assert.equal(elements.btnStop.classList.contains('hidden'), true);
    assert.equal(elements.btnBrowseOutput.disabled, false);
    assert.equal(elements.computerModeCheckbox.disabled, false);
    assert.equal(elements.cloudModeCheckbox.disabled, false);
    assert.equal(elements.pauseAfterBatchCheckbox.disabled, false);
    assert.equal(elements.btnBrowseDestination.disabled, false);
    assert.equal(elements.btnBrowseStaging.disabled, false);
    assert.equal(elements.cacheGbInput.disabled, false);
    assert.equal(elements.cacheLowGbInput.disabled, false);
    assert.equal(elements.uploadModeSelect.disabled, false);
    assert.equal(elements.diskUsageAutoRadio.disabled, false);
    assert.equal(elements.diskUsageManualRadio.disabled, false);
    assert.equal(elements.btnClearFile.disabled, false);
    assert.equal(elements.progressText.classList.contains('processing'), false);
    assert.equal(elements.progressBar.classList.contains('ready'), true);

    // On error, start stays hidden and resume/restart becomes visible.
    assert.equal(elements.btnStart.classList.contains('hidden'), true);
    assert.equal(elements.resumeRestartContainer.classList.contains('hidden'), false);
    assert.equal(calls.updateAutoUploadUiState, 1);
    assert.equal(calls.updateStartButtonState, 0);
    assert.equal(calls.checkStorage, 0);
});
