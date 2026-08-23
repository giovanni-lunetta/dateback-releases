const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

function createElement() {
    return {
        style: {},
        textContent: '',
        classList: {
            add() {},
            remove() {},
            toggle() {},
            contains() {
                return false;
            }
        }
    };
}

test('handleProgressUpdate clears temporary continue text when real processing resumes', () => {
    const rendererSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer.js'), 'utf8');
    const handleProgressUpdateSource = extractNamedFunctionSource(rendererSource, 'handleProgressUpdate');

    const progressTextContent = createElement();
    const progressEta = createElement();
    const progressFill = createElement();
    const calls = {
        setProgressPhase: [],
        setProgressStatusVisibility: []
    };

    progressEta.textContent = 'DateBack will resume as soon as the next batch starts.';

    const context = vm.createContext({
        Date,
        console: { log() {}, warn() {}, error() {} },
        progressTextContent,
        progressEta,
        progressFill,
        etaTimestamps: [],
        lastProgressCount: 0,
        lastProgressTime: 0,
        setProgressPhase: (...args) => calls.setProgressPhase.push(args),
        setProgressStatusVisibility: (...args) => calls.setProgressStatusVisibility.push(args),
        formatTimeRemaining: (seconds) => `${seconds} sec`,
        showBatchPauseModal: () => {},
        lastUploadUiUpdateAt: 0,
        formatBytes: (value) => `${value}B`,
        enterNeedsAttentionState: () => {},
        showSuccessModal: () => {}
    });

    new vm.Script(`
${handleProgressUpdateSource}
this.__handleProgressUpdate = handleProgressUpdate;
`).runInContext(context);

    context.__handleProgressUpdate({ type: 'progress', count: 250, total: 1000 });

    assert.equal(progressTextContent.textContent, 'Organizing memories: 250 / 1,000');
    assert.equal(progressEta.textContent, '');
    assert.deepEqual(calls.setProgressPhase.at(-1), ['Processing', 'processing']);
    assert.deepEqual(calls.setProgressStatusVisibility.at(-1), [true]);
});

test('handleProgressUpdate uses waiting-for-space copy during cloud auto-pause', () => {
    const rendererSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer.js'), 'utf8');
    const handleProgressUpdateSource = extractNamedFunctionSource(rendererSource, 'handleProgressUpdate');

    const progressTextContent = createElement();
    const progressEta = createElement();
    const progressFill = createElement();
    const calls = {
        setProgressPhase: [],
        setProgressStatusVisibility: []
    };

    const context = vm.createContext({
        Date,
        console: { log() {}, warn() {}, error() {} },
        progressTextContent,
        progressEta,
        progressFill,
        etaTimestamps: [],
        lastProgressCount: 0,
        lastProgressTime: 0,
        setProgressPhase: (...args) => calls.setProgressPhase.push(args),
        setProgressStatusVisibility: (...args) => calls.setProgressStatusVisibility.push(args),
        formatTimeRemaining: (seconds) => `${seconds} sec`,
        showBatchPauseModal: () => {},
        lastUploadUiUpdateAt: 0,
        formatBytes: (value) => `${value}B`,
        enterNeedsAttentionState: () => {},
        showSuccessModal: () => {}
    });

    new vm.Script(`
${handleProgressUpdateSource}
this.__handleProgressUpdate = handleProgressUpdate;
`).runInContext(context);

    context.__handleProgressUpdate({ type: 'auto_pause', staging_gb: 4.8, cache_gb: 5 });

    assert.equal(progressTextContent.textContent, 'Cloud sync needs to catch up before DateBack can continue.');
    assert.equal(progressEta.textContent, 'Temporary staging reached 4.8 GB of 5 GB. Keep your cloud app running, or free space, and DateBack will resume automatically.');
    assert.deepEqual(calls.setProgressPhase.at(-1), ['Waiting for Space', 'paused']);
    assert.deepEqual(calls.setProgressStatusVisibility.at(-1), [true]);
});

test('handleProgressUpdate routes runtime disk_full events into the dedicated out-of-space state', () => {
    const rendererSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer.js'), 'utf8');
    const handleProgressUpdateSource = extractNamedFunctionSource(rendererSource, 'handleProgressUpdate');

    const progressTextContent = createElement();
    const progressEta = createElement();
    const progressFill = createElement();
    let diskFullPayload = null;

    const context = vm.createContext({
        Date,
        console: { log() {}, warn() {}, error() {} },
        progressTextContent,
        progressEta,
        progressFill,
        etaTimestamps: [],
        lastProgressCount: 0,
        lastProgressTime: 0,
        setProgressPhase: () => {},
        setProgressStatusVisibility: () => {},
        formatTimeRemaining: (seconds) => `${seconds} sec`,
        showBatchPauseModal: () => {},
        lastUploadUiUpdateAt: 0,
        formatBytes: (value) => `${value}B`,
        enterNeedsAttentionState: () => {},
        enterRuntimeDiskFullState: (payload) => {
            diskFullPayload = payload;
        },
        showSuccessModal: () => {}
    });

    new vm.Script(`
${handleProgressUpdateSource}
this.__handleProgressUpdate = handleProgressUpdate;
`).runInContext(context);

    context.__handleProgressUpdate({
        type: 'disk_full',
        scope: 'staging',
        path: '/tmp/staging',
        message: 'DateBack stopped because the local staging drive ran out of space.'
    });

    assert.deepEqual(diskFullPayload, {
        type: 'disk_full',
        scope: 'staging',
        path: '/tmp/staging',
        message: 'DateBack stopped because the local staging drive ran out of space.'
    });
});

test('handleProgressUpdate does not show the success modal when stoppedByUser is true', () => {
    const rendererSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer.js'), 'utf8');
    const handleProgressUpdateSource = extractNamedFunctionSource(rendererSource, 'handleProgressUpdate');

    const progressTextContent = createElement();
    const progressEta = createElement();
    const progressFill = createElement();
    let successModalCalls = 0;

    const context = vm.createContext({
        Date,
        console: { log() {}, warn() {}, error() {} },
        progressTextContent,
        progressEta,
        progressFill,
        etaTimestamps: [],
        lastProgressCount: 0,
        lastProgressTime: 0,
        stoppedByUser: true,
        setProgressPhase: () => {},
        setProgressStatusVisibility: () => {},
        formatTimeRemaining: (seconds) => `${seconds} sec`,
        showBatchPauseModal: () => {},
        lastUploadUiUpdateAt: 0,
        formatBytes: (value) => `${value}B`,
        enterNeedsAttentionState: () => {},
        enterRuntimeDiskFullState: () => {},
        showSuccessModal: () => { successModalCalls += 1; }
    });

    new vm.Script(`
${handleProgressUpdateSource}
this.__handleProgressUpdate = handleProgressUpdate;
`).runInContext(context);

    context.__handleProgressUpdate({ type: 'complete', stats: { success: 5, duplicates: 0, errors: 0 } });

    assert.equal(successModalCalls, 0, 'showSuccessModal must not be called when stoppedByUser is true');
});

test('handleProgressUpdate shows the success modal when stoppedByUser is false', () => {
    const rendererSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer.js'), 'utf8');
    const handleProgressUpdateSource = extractNamedFunctionSource(rendererSource, 'handleProgressUpdate');

    const progressTextContent = createElement();
    const progressEta = createElement();
    const progressFill = createElement();
    let successModalStats = null;

    const context = vm.createContext({
        Date,
        console: { log() {}, warn() {}, error() {} },
        progressTextContent,
        progressEta,
        progressFill,
        etaTimestamps: [],
        lastProgressCount: 0,
        lastProgressTime: 0,
        stoppedByUser: false,
        setProgressPhase: () => {},
        setProgressStatusVisibility: () => {},
        formatTimeRemaining: (seconds) => `${seconds} sec`,
        showBatchPauseModal: () => {},
        lastUploadUiUpdateAt: 0,
        formatBytes: (value) => `${value}B`,
        enterNeedsAttentionState: () => {},
        enterRuntimeDiskFullState: () => {},
        showSuccessModal: (stats) => { successModalStats = stats; }
    });

    new vm.Script(`
${handleProgressUpdateSource}
this.__handleProgressUpdate = handleProgressUpdate;
`).runInContext(context);

    context.__handleProgressUpdate({ type: 'complete', stats: { success: 5, duplicates: 0, errors: 0 } });

    assert.deepEqual(successModalStats, { success: 5, duplicates: 0, errors: 0 });
});
