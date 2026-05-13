const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const packageJson = require(path.resolve(__dirname, '..', 'package.json'));
const root = path.resolve(__dirname, '..');

test('package metadata matches the free proprietary release model', () => {
    assert.equal(packageJson.version, '1.4.4');
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

test('QA build carries the same macOS folder permission usage descriptions as production', () => {
    const qaBuildConfig = require(path.join(root, 'build', 'qa-build.json'));

    assert.deepEqual(qaBuildConfig.mac.extendInfo, packageJson.build.mac.extendInfo);
    assert.match(packageJson.build.mac.extendInfo.NSDownloadsFolderUsageDescription, /Downloads folder/);
    assert.match(packageJson.build.mac.extendInfo.NSDocumentsFolderUsageDescription, /Documents folder/);
    assert.match(packageJson.build.mac.extendInfo.NSDesktopFolderUsageDescription, /Desktop/);
});

test('release configs copy binaries from explicit platform and architecture paths', () => {
    const qaBuildConfig = require(path.join(root, 'build', 'qa-build.json'));

    for (const config of [packageJson.build, qaBuildConfig]) {
        assert.deepEqual(config.extraResources, [
            { from: 'assets/bin/mac-arm64/memory-organizer', to: 'bin/memory-organizer' },
            { from: 'assets/bin/mac-arm64/ffmpeg', to: 'bin/ffmpeg' }
        ]);
    }
});

test('dev-only build helpers are current and outside production dependencies', () => {
    assert.equal(packageJson.dependencies.dotenv, undefined);
    assert.match(packageJson.devDependencies.dotenv, /^\^17\./);
    assert.match(packageJson.devDependencies.electron, /^\^42\./);
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

test('bundled license directory includes Python and Pillow license texts', () => {
    const notices = fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.txt'), 'utf8');

    for (const fileName of ['PYTHON-PSF-LICENSE.txt', 'PILLOW-HPND-LICENSE.txt']) {
        assert.ok(fs.existsSync(path.join(root, 'licenses', fileName)), `${fileName} should be bundled`);
        assert.ok(notices.includes(`licenses/${fileName}`), `${fileName} should be referenced in notices`);
    }
});
