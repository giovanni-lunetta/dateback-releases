const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const packageJson = require(path.resolve(__dirname, '..', 'package.json'));
const root = path.resolve(__dirname, '..');

test('package metadata matches the free proprietary release model', () => {
    assert.equal(packageJson.version, '1.5.0');
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

    // Production mac build uses ${arch} macro — resolves to mac-arm64 or mac-x64 per build target
    assert.deepEqual(packageJson.build.mac.extraResources, [
        { from: 'assets/bin/mac-${arch}/memory-organizer', to: 'bin/memory-organizer' },
        { from: 'assets/bin/mac-${arch}/ffmpeg',           to: 'bin/ffmpeg' }
    ]);

    // Production win build uses explicit win-x64 paths with .exe extensions
    assert.deepEqual(packageJson.build.win.extraResources, [
        { from: 'assets/bin/win-x64/memory-organizer.exe', to: 'bin/memory-organizer.exe' },
        { from: 'assets/bin/win-x64/ffmpeg.exe',           to: 'bin/ffmpeg.exe' }
    ]);

    // Top-level extraResources must be removed (moved into platform sections)
    assert.equal(packageJson.build.extraResources, undefined);

    // QA build hardcodes arm64 — QA is always arm64-only and unchanged
    assert.deepEqual(qaBuildConfig.extraResources, [
        { from: 'assets/bin/mac-arm64/memory-organizer', to: 'bin/memory-organizer' },
        { from: 'assets/bin/mac-arm64/ffmpeg', to: 'bin/ffmpeg' }
    ]);
});

test('Windows NSIS installer config targets one-click user install', () => {
    assert.equal(packageJson.build.win.icon, 'assets/DateBack.ico');
    assert.deepEqual(packageJson.build.win.target, { target: 'nsis', arch: ['x64'] });
    assert.equal(packageJson.build.nsis.oneClick, true);
    assert.equal(packageJson.build.nsis.perMachine, false);
    assert.equal(packageJson.build.nsis.createDesktopShortcut, true);
    assert.equal(packageJson.build.nsis.createStartMenuShortcut, true);
});

test('Windows build script and binary build script are present', () => {
    assert.match(packageJson.scripts['build:win:x64'], /electron-builder --win --arch x64/);
    assert.match(packageJson.scripts['build:binary:win'], /PyInstaller memory-organizer-win\.spec/);
});

test('binary policy doc explains tracked release binaries', () => {
    const binaryPolicy = fs.readFileSync(path.join(root, 'docs', 'BINARIES.md'), 'utf8');

    assert.match(binaryPolicy, /deterministic packaging/i);
    assert.match(binaryPolicy, /mac-arm64/);
    assert.match(binaryPolicy, /mac-x64/);
    assert.match(binaryPolicy, /win-x64/);
    assert.match(binaryPolicy, /THIRD_PARTY_NOTICES\.txt/);
    assert.match(binaryPolicy, /build:binary:arm64/);
    assert.match(binaryPolicy, /build:binary:x64/);
    assert.match(binaryPolicy, /build:binary:win/);
    assert.match(binaryPolicy, /PyInstaller cannot cross-compile/i);
});

test('gitignore keeps local agent docs and generated hygiene artifacts out of git', () => {
    const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

    for (const pattern of [
        'AGENTS.md',
        'CLAUDE.md',
        '.env.*',
        '*.jsonl',
        '*.log',
        '__pycache__/',
        'node_modules/',
        '*.sqlite',
        '*.zip',
        '*.p12',
        '*.p8',
        'AuthKey_*.p8',
        'docs/private/',
        '!build/entitlements.mac.plist',
        '!build/qa-build.json'
    ]) {
        assert.ok(gitignore.includes(pattern), `.gitignore should include ${pattern}`);
    }
});

test('public docs avoid personal local filesystem paths', () => {
    for (const fileName of ['README.md', 'docs/README.md', 'docs/TESTING.md', 'docs/BUILD.md', 'docs/BINARIES.md']) {
        const source = fs.readFileSync(path.join(root, fileName), 'utf8');

        assert.equal(source.includes('/Users/'), false, `${fileName} should not expose a personal absolute path`);
        assert.equal(source.includes('DateBack_Business'), false, `${fileName} should not expose the private workspace name`);
        assert.equal(source.includes('Business Ideas'), false, `${fileName} should not expose the private workspace path`);
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
