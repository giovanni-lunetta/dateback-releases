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
    for (let i = paramsStart; i < source.length; i += 1) {
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
    for (let i = bodyStart; i < source.length; i += 1) {
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
        textContent: '',
        classList: {
            add() {},
            remove() {}
        }
    };
}

test('multi-ZIP expand retry search processes the replacement discovery result', async () => {
    const rendererSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer.js'), 'utf8');
    const processZipDiscoveryResultSource = extractNamedFunctionSource(rendererSource, 'processZipDiscoveryResult');
    const showMultiZipCountConfirmationSource = extractNamedFunctionSource(rendererSource, 'showMultiZipCountConfirmation');
    const selectedPaths = [];
    const modalCalls = [];

    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        zipDiscoveryStatus: createElement(),
        zipDiscoveryText: createElement(),
        dropZone: createElement(),
        btnFindZip: { disabled: false },
        window: {
            api: {
                discoverZipSet: async () => ({
                    success: true,
                    totalCount: 1,
                    primaryPath: '/exports/new-primary.zip',
                    companionPaths: [],
                    seedFolder: '/exports',
                    needsOrganizing: false
                })
            }
        },
        setFilePath: async (zipPath) => {
            selectedPaths.push(zipPath);
        },
        handleZipSetConfirmed: async () => {},
        showMultiZipModal: (title, text, subtext, buttons) => {
            modalCalls.push({ title, text, subtext, buttons });
        },
        startZipDiscovery: async () => ({
            success: true,
            totalCount: 1,
            primaryPath: '/exports/new-primary.zip',
            companionPaths: [],
            seedFolder: '/exports',
            needsOrganizing: false
        }),
        __selectedPaths: selectedPaths,
        __modalCalls: modalCalls
    });

    new vm.Script(`
let zipDiscoveryHandled = false;
let zipDiscoveryPromise = null;
let zipDiscoveryResult = null;
let isZipDiscovering = false;
${processZipDiscoveryResultSource}
${showMultiZipCountConfirmationSource}
this.__processZipDiscoveryResult = processZipDiscoveryResult;
`).runInContext(context);

    const processing = context.__processZipDiscoveryResult({
        success: true,
        totalCount: 2,
        primaryPath: '/exports/old-primary.zip',
        companionPaths: ['/exports/old-primary-2.zip'],
        seedFolder: '/exports',
        needsOrganizing: false
    });

    await Promise.resolve();
    const retryButton = context.__modalCalls[0].buttons.find((button) => button.label === 'Retry & Expand Search');
    assert.ok(retryButton, 'expected Retry & Expand Search button');

    await retryButton.onClick();
    await processing;

    assert.deepEqual(context.__selectedPaths, ['/exports/new-primary.zip']);
});
