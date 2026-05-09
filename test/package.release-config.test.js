const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const packageJson = require(path.resolve(__dirname, '..', 'package.json'));
const root = path.resolve(__dirname, '..');

test('package metadata matches the free proprietary release model', () => {
    assert.equal(packageJson.version, '1.4.1');
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

test('third-party notices match current direct production dependencies', () => {
    const notices = fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
    const lock = require(path.join(root, 'package-lock.json'));
    const productionDeps = Object.keys(packageJson.dependencies).sort();
    const directProdSection = notices.slice(
        notices.indexOf('Direct production dependencies:'),
        notices.indexOf('Notable transitive dependency:')
    );

    for (const depName of productionDeps) {
        const resolved = lock.packages[`node_modules/${depName}`];
        assert.ok(resolved, `${depName} should be present in package-lock.json`);
        assert.match(
            notices,
            new RegExp(`- ${depName}@${resolved.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
            `${depName} notice should match package-lock version`
        );
    }

    for (const depName of Object.keys(packageJson.devDependencies || {})) {
        assert.doesNotMatch(
            directProdSection,
            new RegExp(`- ${depName}@`),
            `${depName} should not be listed as a direct production dependency`
        );
    }
});
