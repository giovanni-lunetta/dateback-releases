const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const helpers = require(path.resolve(__dirname, '..', 'src', 'renderer.helpers.js'));
globalThis.DateBackRendererHelpers = helpers;

function extractNamedFunctionSource(source, functionName) {
    const signature = `function ${functionName}(`;
    const start = source.indexOf(signature);
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
    return {
        classList: createClassList(initialClasses),
        textContent: '',
        checked: false,
        disabled: false,
        open: false
    };
}

function buildUiStateContext({
    mode,
    processing,
    pauseChecked,
    advancedOpen = false,
    diskUsageMode = 'automatic'
}) {
    const elements = {
        workingFolderHelp: createElement(),
        pauseAfterBatchCheckbox: createElement(),
        computerModeSettings: createElement(),
        cloudDestinationSection: createElement(),
        autoUploadSettings: createElement(),
        handoffHelperRow: createElement(),
        autoUploadAdvancedDetails: createElement(),
        manualCacheSettings: createElement(),
        cacheAutoHint: createElement(),
        autoCachePreview: createElement(),
        cacheLowSpaceWarning: createElement(),
        computerModeCheckbox: createElement(),
        cloudModeCheckbox: createElement(),
        computerModeCard: createElement(),
        cloudModeCard: createElement(),
        computerModeDescription: createElement(),
        computerModeDisabledHint: createElement(),
        cloudModeDescription: createElement(),
        cloudModeDisabledHint: createElement(),
        cloudDestinationError: createElement(),
        syncFolderWarning: createElement()
    };

    elements.pauseAfterBatchCheckbox.checked = pauseChecked;
    elements.autoUploadAdvancedDetails.open = advancedOpen;

    const calls = {
        updateAutoCachePreview: 0,
        updateStorageSummary: 0,
        updateCloudHandoffCopy: 0,
        updateSyncFolderWarning: 0,
        updateStartButtonState: 0
    };

    const context = {
        computeModeVisibilityStateHelper: helpers.computeModeVisibilityState,
        getStorageMode: () => mode,
        getDiskUsageMode: () => diskUsageMode,
        isProcessing: processing,
        ...elements,
        updateAutoCachePreview: () => {
            calls.updateAutoCachePreview += 1;
        },
        updateStorageSummary: () => {
            calls.updateStorageSummary += 1;
        },
        updateCloudHandoffCopy: () => {
            calls.updateCloudHandoffCopy += 1;
        },
        updateSyncFolderWarning: () => {
            calls.updateSyncFolderWarning += 1;
        },
        updateStartButtonState: () => {
            calls.updateStartButtonState += 1;
        }
    };

    return { context, elements, calls };
}

function runUpdateAutoUploadUiState(context) {
    const rendererSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer.js'), 'utf8');
    const applyVisibilityStateSource = extractNamedFunctionSource(rendererSource, 'applyVisibilityState');
    const buildVisibilityInputSource = extractNamedFunctionSource(rendererSource, 'buildVisibilityInput');
    const functionSource = extractNamedFunctionSource(rendererSource, 'updateAutoUploadUiState');
    const vmContext = vm.createContext(context);
    const script = new vm.Script(`
const computeModeVisibilityStateHelper = this.computeModeVisibilityStateHelper;
const isProcessing = this.isProcessing;
const getDiskUsageMode = this.getDiskUsageMode;
const getStorageMode = this.getStorageMode;
${applyVisibilityStateSource}
${buildVisibilityInputSource}
${functionSource}
this.__updateAutoUploadUiState = updateAutoUploadUiState;
`);
    script.runInContext(vmContext);
    vmContext.__updateAutoUploadUiState();
    return vmContext;
}

test('updateAutoUploadUiState glue: NONE mode stopped', () => {
    const { context, elements, calls } = buildUiStateContext({
        mode: 'NONE',
        processing: false,
        pauseChecked: true
    });

    runUpdateAutoUploadUiState(context);

    assert.equal(elements.workingFolderHelp.textContent, 'Select a storage mode below to continue.');
    assert.equal(elements.cloudDestinationSection.classList.contains('hidden'), true);
    assert.equal(elements.computerModeCheckbox.disabled, false);
    assert.equal(elements.cloudModeCheckbox.disabled, false);
    assert.equal(elements.pauseAfterBatchCheckbox.checked, false);
    assert.equal(elements.pauseAfterBatchCheckbox.disabled, true);
    assert.equal(calls.updateAutoCachePreview, 1);
    assert.equal(calls.updateStorageSummary, 1);
    assert.equal(calls.updateStartButtonState, 1);
});

test('updateAutoUploadUiState glue: COMPUTER mode stopped', () => {
    const { context, elements } = buildUiStateContext({
        mode: 'COMPUTER',
        processing: false,
        pauseChecked: true
    });

    runUpdateAutoUploadUiState(context);

    assert.equal(elements.pauseAfterBatchCheckbox.disabled, false);
    assert.equal(elements.pauseAfterBatchCheckbox.checked, true);
    assert.equal(elements.workingFolderHelp.textContent, 'Your processed memories will be saved here.');
    assert.equal(elements.cloudDestinationSection.classList.contains('hidden'), true);
    assert.equal(elements.computerModeCard.classList.contains('selected'), true);
});

test('updateAutoUploadUiState glue: CLOUD mode running', () => {
    const { context, elements, calls } = buildUiStateContext({
        mode: 'CLOUD',
        processing: true,
        pauseChecked: true
    });

    runUpdateAutoUploadUiState(context);

    assert.equal(elements.computerModeCheckbox.disabled, true);
    assert.equal(elements.cloudModeCheckbox.disabled, true);
    assert.equal(elements.pauseAfterBatchCheckbox.disabled, true);
    assert.equal(elements.pauseAfterBatchCheckbox.checked, false);
    assert.equal(elements.workingFolderHelp.textContent, 'This is temporary working space. Your memories will be saved to the Cloud Destination folder below.');
    assert.equal(elements.cloudDestinationSection.classList.contains('hidden'), false);
    assert.equal(calls.updateCloudHandoffCopy, 1);
    assert.equal(calls.updateSyncFolderWarning, 1);
});
