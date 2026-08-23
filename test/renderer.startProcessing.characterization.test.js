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

function toNativeDeep(value) {
    if (Array.isArray(value)) {
        return value.map((item) => toNativeDeep(item));
    }
    if (value && typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value)) {
            out[key] = toNativeDeep(value[key]);
        }
        return out;
    }
    return value;
}

function createElement(initialClasses = ['hidden']) {
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

function buildStartRoutineContext({
    mode,
    isResume = false,
    resumeMode = 'verify',
    pauseChecked = false,
    destinationDir = '/tmp/dest',
    stagingDir = '/tmp/stage',
    uploadMode = 'copy'
}) {
    const GIB = 1024 * 1024 * 1024;
    let capturedArgs = null;

    const zipPathInput = createElement();
    zipPathInput.value = '/tmp/input.zip';
    const outputPathInput = createElement();
    outputPathInput.value = '/tmp/output';
    const pauseAfterBatchCheckbox = createElement();
    pauseAfterBatchCheckbox.checked = pauseChecked;
    const destinationPathInput = createElement();
    destinationPathInput.value = destinationDir;
    const stagingPathInput = createElement();
    stagingPathInput.value = stagingDir;
    const cacheGbInput = createElement();
    cacheGbInput.value = '5';
    const cacheLowGbInput = createElement();
    cacheLowGbInput.value = '3';
    const uploadModeSelect = createElement();
    uploadModeSelect.value = uploadMode;
    const cacheLowSpaceWarning = createElement(['hidden']);
    const storageWarning = createElement(['hidden']);
    const progressTextContent = createElement();
    const progressEta = createElement();
    const progressFill = createElement();
    const progressBar = createElement();
    const progressText = createElement();
    const logOutput = createElement();
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

    const context = {
        GIB,
        Date,
        Number,
        navigator: { onLine: true },
        window: {
            api: {
                getDiskSpace: async () => ({ success: true, free: 10 * GIB }),
                checkBatteryStatus: async () => ({ success: true, onBattery: false }),
                getDiskFreeBytes: async () => ({ success: true, freeBytes: 100 * GIB, volumePath: '/tmp/output' }),
                startProcessing: async (args) => {
                    capturedArgs = args;
                    return { success: false, error: 'captured' };
                }
            }
        },
        document: {
            getElementById: () => createElement()
        },
        console: { log: () => { }, warn: () => { }, error: () => { } },
        alert: (msg) => {
            throw new Error(`Unexpected alert: ${msg}`);
        },
        showStorageWarningModal: async () => false,
        validateCloudDestinationForCurrentMode: () => ({ valid: true, message: '' }),
        updateSyncFolderWarning: () => { },
        isAllowedCloudFolder: () => false,
        showOfflineWarning: async () => true,
        resolveAutoCacheForStart: async () => ({
            cacheGb: 7,
            cacheLowGb: 4,
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
        formatBytes: (bytes) => `${bytes}B`,
        showBatteryWarning: async () => true,
        revealRecoveryUi: (hint = '') => {
            progressEta.textContent = hint;
        },
        updateAutoUploadUiState: () => { },
        updateStartButtonState: () => { },
        checkStorage: async () => { },
        syncStorageModeFromControls: () => mode,
        getStorageMode: () => mode,
        getDiskUsageMode: () => 'automatic',
        resolveRunModeFlagsHelper: helpers.resolveRunModeFlags,
        buildStartProcessingArgsHelper: helpers.buildStartProcessingArgs,
        computeProcessingUiStateHelper: helpers.computeProcessingUiState,
        zipPathInput,
        outputPathInput,
        pauseAfterBatchCheckbox,
        destinationPathInput,
        stagingPathInput,
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
        isProcessing: false,
        startProcessingInFlight: false,
        stoppedByUser: false,
        etaTimestamps: [],
        lastProgressCount: 0,
        lastProgressTime: 0,
        lastUploadUiUpdateAt: 0,
        lastStorageEstimate: null,
        currentMemoryCount: 0,
        hasProcessedBefore: false,
        expiredLinkAlertShown: false
    };

    async function invoke() {
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
        await vmContext.__startProcessingRoutine(isResume, resumeMode);
        return capturedArgs;
    }

    return { invoke };
}

test('startProcessingRoutine args: COMPUTER mode non-resume includes pause and omits resumeMode', async () => {
    const { invoke } = buildStartRoutineContext({
        mode: 'COMPUTER',
        isResume: false,
        pauseChecked: true
    });

    const capturedArgs = toNativeDeep(await invoke());
    assert.deepEqual(capturedArgs, {
        zipPath: '/tmp/input.zip',
        outputDir: '/tmp/output',
        pauseBetweenBatches: true,
        autoUpload: false,
        destinationDir: '',
        cacheGb: undefined,
        cacheLowGb: undefined,
        uploadMode: undefined,
        stagingDir: '',
        cacheComputation: undefined
    });
    assert.equal(Object.prototype.hasOwnProperty.call(capturedArgs, 'resumeMode'), false);
});

test('startProcessingRoutine args: CLOUD mode non-resume includes cloud fields and omits resumeMode', async () => {
    const { invoke } = buildStartRoutineContext({
        mode: 'CLOUD',
        isResume: false,
        pauseChecked: false,
        destinationDir: '/tmp/cloud-dest',
        stagingDir: '/tmp/cloud-stage',
        uploadMode: 'copy'
    });

    const capturedArgs = toNativeDeep(await invoke());
    assert.deepEqual(capturedArgs, {
        zipPath: '/tmp/input.zip',
        outputDir: '/tmp/output',
        pauseBetweenBatches: false,
        autoUpload: true,
        destinationDir: '/tmp/cloud-dest',
        cacheGb: 7,
        cacheLowGb: 4,
        uploadMode: 'copy',
        stagingDir: '/tmp/cloud-stage',
        cacheComputation: {
            mode: 'automatic',
            freeGb: 100,
            reserveGb: 10,
            volumePath: '/tmp/output'
        }
    });
    assert.equal(Object.prototype.hasOwnProperty.call(capturedArgs, 'resumeMode'), false);
});

test('startProcessingRoutine args: resume path includes resumeMode trust', async () => {
    const { invoke } = buildStartRoutineContext({
        mode: 'COMPUTER',
        isResume: true,
        resumeMode: 'trust',
        pauseChecked: false
    });

    const capturedArgs = toNativeDeep(await invoke());
    assert.deepEqual(capturedArgs, {
        zipPath: '/tmp/input.zip',
        outputDir: '/tmp/output',
        pauseBetweenBatches: false,
        autoUpload: false,
        destinationDir: '',
        cacheGb: undefined,
        cacheLowGb: undefined,
        uploadMode: undefined,
        stagingDir: '',
        cacheComputation: undefined,
        resumeMode: 'trust'
    });
});

test('startProcessingRoutine has a synchronous in-flight guard before awaited validation', () => {
    const rendererSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer.js'), 'utf8');
    const startProcessingRoutineSource = extractNamedFunctionSource(rendererSource, 'startProcessingRoutine');
    const firstAwaitIndex = startProcessingRoutineSource.indexOf('await ');
    const guardCheckIndex = startProcessingRoutineSource.indexOf('isProcessing || startProcessingInFlight');
    const guardSetIndex = startProcessingRoutineSource.indexOf('startProcessingInFlight = true');
    const guardClearIndex = startProcessingRoutineSource.lastIndexOf('startProcessingInFlight = false');

    assert.ok(guardCheckIndex >= 0, 'Expected startProcessingRoutine to check the in-flight guard');
    assert.ok(guardSetIndex >= 0, 'Expected startProcessingRoutine to set the in-flight guard synchronously');
    assert.ok(firstAwaitIndex >= 0, 'Expected startProcessingRoutine to contain awaited validation');
    assert.ok(guardSetIndex < firstAwaitIndex, 'Expected in-flight guard to be set before any await');
    assert.ok(guardClearIndex > guardSetIndex, 'Expected in-flight guard to be cleared after the guarded work');
});

test('waitForProcessingToStop times out and invokes onTimeout instead of polling forever', async () => {
    const rendererSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer.js'), 'utf8');
    const waitForProcessingToStopSource = extractNamedFunctionSource(rendererSource, 'waitForProcessingToStop');

    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        setInterval,
        clearInterval,
        Date
    });

    new vm.Script(`
${waitForProcessingToStopSource}
this.__waitForProcessingToStop = waitForProcessingToStop;
`).runInContext(context);

    let stoppedCalls = 0;
    let timeoutCalls = 0;

    context.__waitForProcessingToStop(
        () => true, // isProcessing never becomes false
        () => { stoppedCalls += 1; },
        { intervalMs: 5, timeoutMs: 20, onTimeout: () => { timeoutCalls += 1; } }
    );

    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(stoppedCalls, 0, 'onStopped must not fire when isProcessing never clears');
    assert.equal(timeoutCalls, 1, 'onTimeout must fire exactly once after timeoutMs elapses');
});

test('waitForProcessingToStop calls onStopped as soon as isProcessing clears, without waiting for timeout', async () => {
    const rendererSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer.js'), 'utf8');
    const waitForProcessingToStopSource = extractNamedFunctionSource(rendererSource, 'waitForProcessingToStop');

    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        setInterval,
        clearInterval,
        Date
    });

    new vm.Script(`
${waitForProcessingToStopSource}
this.__waitForProcessingToStop = waitForProcessingToStop;
`).runInContext(context);

    let processing = true;
    let stoppedCalls = 0;
    let timeoutCalls = 0;

    context.__waitForProcessingToStop(
        () => processing,
        () => { stoppedCalls += 1; },
        { intervalMs: 5, timeoutMs: 5000, onTimeout: () => { timeoutCalls += 1; } }
    );

    await new Promise((resolve) => setTimeout(resolve, 12));
    processing = false;
    await new Promise((resolve) => setTimeout(resolve, 12));

    assert.equal(stoppedCalls, 1);
    assert.equal(timeoutCalls, 0);
});
