const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

function loadPreloadApi() {
    const preloadPath = path.resolve(__dirname, '..', 'preload.js');
    let exposedApi = null;
    const ipcInvocations = [];
    const originalLoad = Module._load;

    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === 'electron') {
            return {
                contextBridge: {
                    exposeInMainWorld: (name, api) => {
                        assert.equal(name, 'api');
                        exposedApi = api;
                    }
                },
                ipcRenderer: {
                    invoke: (channel, ...args) => {
                        ipcInvocations.push({ channel, args });
                        return Promise.resolve({ channel, args });
                    },
                    on: () => { },
                    removeListener: () => { }
                }
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    delete require.cache[preloadPath];
    require(preloadPath);
    Module._load = originalLoad;

    assert.ok(exposedApi, 'expected preload to expose window.api');
    return { exposedApi, ipcInvocations };
}

test('free build preload API does not expose license activation methods', () => {
    const { exposedApi } = loadPreloadApi();

    assert.equal(Object.prototype.hasOwnProperty.call(exposedApi, 'validateLicense'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(exposedApi, 'getLicenseStatus'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(exposedApi, 'clearLicense'), false);
});

test('preload API omits retired ZIP search and global listener cleanup methods', () => {
    const { exposedApi } = loadPreloadApi();

    assert.equal(Object.prototype.hasOwnProperty.call(exposedApi, 'selectZip'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(exposedApi, 'findZip'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(exposedApi, 'removeProgressListener'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(exposedApi, 'removeLogListener'), false);
});
