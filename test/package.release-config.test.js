const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const packageJson = require(path.resolve(__dirname, '..', 'package.json'));

test('package metadata matches the free proprietary release model', () => {
    assert.equal(packageJson.version, '1.3.0');
    assert.equal(packageJson.private, true);
    assert.equal(packageJson.license, 'UNLICENSED');
});

test('GitHub release publish config is public-compatible for free downloads', () => {
    assert.deepEqual(packageJson.build.publish, {
        provider: 'github',
        owner: 'giovanni-lunetta',
        repo: 'dateback-releases'
    });
});
