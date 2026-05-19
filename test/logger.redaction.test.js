const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
        return {
            app: {
                getPath: () => os.tmpdir(),
                isPackaged: false
            }
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let Logger;
try {
    Logger = require('../src/logger');
} finally {
    Module._load = originalLoad;
}

test('logger redacts common secret key variants case-insensitively', () => {
    const logger = new Logger({ appName: 'DateBack Test' });
    const redacted = logger.redactObject({
        access_token: 'a',
        refresh_token: 'b',
        Authorization: 'Bearer c',
        client_secret: 'd',
        apiKey: 'e',
        nested: { PASSWORD: 'f' },
        key: 'g',
        safe: 'keep'
    });

    assert.equal(redacted.access_token, '<redacted>');
    assert.equal(redacted.refresh_token, '<redacted>');
    assert.equal(redacted.Authorization, '<redacted>');
    assert.equal(redacted.client_secret, '<redacted>');
    assert.equal(redacted.apiKey, '<redacted>');
    assert.equal(redacted.nested.PASSWORD, '<redacted>');
    assert.equal(redacted.key, '<redacted>');
    assert.equal(redacted.safe, 'keep');
});
