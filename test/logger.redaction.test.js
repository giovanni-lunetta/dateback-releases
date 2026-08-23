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

test('logger redacts camelCase-compound secret keys', () => {
    const logger = new Logger({ appName: 'DateBack Test' });
    const redacted = logger.redactObject({
        authToken: '1',
        sessionToken: '2',
        clientSecret: '3',
        bearerToken: '4',
        idToken: '5',
        cookieValue: '6',
        safeCamelKey: 'keep'
    });

    assert.equal(redacted.authToken, '<redacted>');
    assert.equal(redacted.sessionToken, '<redacted>');
    assert.equal(redacted.clientSecret, '<redacted>');
    assert.equal(redacted.bearerToken, '<redacted>');
    assert.equal(redacted.idToken, '<redacted>');
    assert.equal(redacted.cookieValue, '<redacted>');
    assert.equal(redacted.safeCamelKey, 'keep');
});

test('redactPath redacts .zip export filenames like other media files', () => {
    const logger = new Logger({ appName: 'DateBack Test' });
    const redacted = logger.redactPath('Loading /Users/shalyssa/Downloads/mydata~shalyssa123.zip now');
    assert.ok(!redacted.includes('mydata~shalyssa123.zip'), `expected zip filename to be redacted, got: ${redacted}`);
    assert.ok(redacted.includes('<media-file>'), `expected <media-file> placeholder, got: ${redacted}`);
});
