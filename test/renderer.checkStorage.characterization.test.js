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

    const bodyStart = source.indexOf('{', start);
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
    const element = {
        classList: createClassList(initialClasses),
        textContent: '',
        innerHTML: '',
        className: '',
        checked: false,
        disabled: false,
        value: '',
        style: {},
        closest: () => null
    };
    return element;
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function buildCheckStorageContext({
    mode,
    count,
    pauseAfterBatchChecked = false,
    preflightResult = null,
    preflightError = null,
    diskSpaceFree = 50 * 1024 * 1024 * 1024
}) {
    const GIB = 1024 * 1024 * 1024;
    const AVG_FILE_BYTES = 8 * 1024 * 1024;
    const STORAGE_ESTIMATE_LOG_THROTTLE_MS = 500;

    const storageCheckSection = createElement(['hidden']);
    const storageCount = createElement();
    const storageRequired = createElement();
    const storageAvailable = createElement();
    const storageWarning = createElement(['hidden']);
    const cacheLowSpaceWarning = createElement(['hidden']);
    const pauseAfterBatchCheckbox = createElement();
    pauseAfterBatchCheckbox.checked = pauseAfterBatchChecked;
    const outputPathInput = createElement();
    outputPathInput.value = '/tmp/output';
    const stagingPathInput = createElement();
    stagingPathInput.value = '/tmp/staging';
    const cacheGbInput = createElement();
    cacheGbInput.value = '5';
    const btnBrowseOutput = createElement();
    const statusIcon = createElement();
    const statBox = createElement();
    storageAvailable.closest = (selector) => (selector === '.stat-box' ? statBox : null);

    const calls = {
        updateStartButtonState: 0
    };

    const context = {
        GIB,
        AVG_FILE_BYTES,
        STORAGE_ESTIMATE_LOG_THROTTLE_MS,
        storageCheckSection,
        storageCount,
        storageRequired,
        storageAvailable,
        storageWarning,
        cacheLowSpaceWarning,
        pauseAfterBatchCheckbox,
        outputPathInput,
        stagingPathInput,
        cacheGbInput,
        btnBrowseOutput,
        currentOutputDir: '/tmp/output',
        storageCheckRequestId: 0,
        isStorageCriticallyLow: false,
        lastStorageEstimate: null,
        lastStorageEstimateLogAt: 0,
        lastStorageEstimateLogKind: null,
        getStorageMode: () => mode,
        getActiveProcessingModeName: () => (mode === 'CLOUD' ? 'Store Memories on Cloud' : mode === 'COMPUTER' ? 'Store Memories on Computer' : 'No Storage Mode Selected'),
        getDiskUsageMode: () => 'automatic',
        evaluateAutoUploadPreflight: async () => {
            if (preflightError) {
                throw preflightError;
            }
            return preflightResult;
        },
        roundOneDecimal: (value) => Math.round(value * 10) / 10,
        formatBytes,
        computeStorageEstimatesHelper: helpers.computeStorageEstimates,
        computeStorageWarningStateHelper: helpers.computeStorageWarningState,
        isDebugStorageEnabled: () => false,
        updateStartButtonState: () => {
            calls.updateStartButtonState += 1;
        },
        window: {
            api: {
                getDefaults: async () => ({ outputDir: '/tmp/default-output' }),
                getDiskSpace: async () => ({ success: true, free: diskSpaceFree })
            }
        },
        document: {
            getElementById: (id) => {
                if (id === 'storage-status-icon') return statusIcon;
                return null;
            }
        }
    };

    async function run() {
        const rendererSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer.js'), 'utf8');
        const getEffectiveOutputDirSource = extractNamedFunctionSource(rendererSource, 'getEffectiveOutputDir');
        const checkStorageSource = extractNamedFunctionSource(rendererSource, 'checkStorage');
        const vmContext = vm.createContext(context);
        const script = new vm.Script(`
const GIB = this.GIB;
const AVG_FILE_BYTES = this.AVG_FILE_BYTES;
const STORAGE_ESTIMATE_LOG_THROTTLE_MS = this.STORAGE_ESTIMATE_LOG_THROTTLE_MS;
const computeStorageEstimatesHelper = this.computeStorageEstimatesHelper;
const computeStorageWarningStateHelper = this.computeStorageWarningStateHelper;
${getEffectiveOutputDirSource}
${checkStorageSource}
this.__checkStorage = checkStorage;
`);
        script.runInContext(vmContext);
        await vmContext.__checkStorage(count);
    }

    return {
        run,
        elements: {
            storageCheckSection,
            storageCount,
            storageRequired,
            storageAvailable,
            storageWarning,
            cacheLowSpaceWarning,
            pauseAfterBatchCheckbox,
            statusIcon,
            statBox,
            btnBrowseOutput
        },
        calls,
        context
    };
}

test('checkStorage: CLOUD mode with enough disk keeps warnings hidden', async () => {
    const GIB = 1024 * 1024 * 1024;
    const preflightResult = {
        ok: true,
        preflight: {
            requiredBytes: 12 * GIB,
            freeBytes: 30 * GIB,
            safetyBufferGb: 10
        },
        cacheGb: 2,
        path: '/tmp/staging',
        volumePath: '/tmp'
    };

    const { run, elements, calls, context } = buildCheckStorageContext({
        mode: 'CLOUD',
        count: 1000,
        pauseAfterBatchChecked: false,
        preflightResult
    });

    await run();

    assert.equal(elements.storageWarning.classList.contains('hidden'), true);
    assert.equal(elements.cacheLowSpaceWarning.classList.contains('hidden'), true);
    assert.equal(elements.storageRequired.textContent, formatBytes(12 * GIB));
    assert.equal(elements.storageAvailable.textContent, formatBytes(30 * GIB));
    assert.equal(calls.updateStartButtonState, 1);
    assert.equal(context.lastStorageEstimate.estimateKind, 'AUTO_PREFLIGHT');
});

test('checkStorage: CLOUD mode with low space shows storage warning (cache warning unchanged)', async () => {
    const GIB = 1024 * 1024 * 1024;
    const preflightResult = {
        ok: false,
        preflight: {
            requiredBytes: 22 * GIB,
            freeBytes: 12 * GIB,
            safetyBufferGb: 10
        },
        cacheGb: 12,
        path: '/tmp/staging',
        volumePath: '/tmp'
    };

    const { run, elements, context } = buildCheckStorageContext({
        mode: 'CLOUD',
        count: 1000,
        pauseAfterBatchChecked: false,
        preflightResult
    });

    await run();

    assert.equal(elements.storageWarning.classList.contains('hidden'), false);
    assert.ok(elements.storageWarning.innerHTML.includes('Store on Cloud needs temporary cache + buffer'));
    assert.equal(elements.cacheLowSpaceWarning.classList.contains('hidden'), true);
    assert.equal(context.lastStorageEstimate.estimateKind, 'AUTO_PREFLIGHT');
});

test('checkStorage: COMPUTER mode uses non-cloud estimate and does not surface cloud warnings', async () => {
    const AVG_FILE_BYTES = 8 * 1024 * 1024;
    const count = 25;
    const { run, elements, context } = buildCheckStorageContext({
        mode: 'COMPUTER',
        count,
        pauseAfterBatchChecked: false,
        preflightResult: null,
        diskSpaceFree: 100 * 1024 * 1024 * 1024
    });

    await run();

    assert.equal(elements.storageWarning.classList.contains('hidden'), true);
    assert.equal(elements.cacheLowSpaceWarning.classList.contains('hidden'), true);
    assert.equal(elements.storageRequired.textContent, formatBytes(count * AVG_FILE_BYTES));
    assert.equal(context.lastStorageEstimate.estimateKind, 'STANDARD');
});
