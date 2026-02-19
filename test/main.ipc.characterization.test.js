const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const Module = require('node:module');

function bootstrapMainForTests() {
    const mainPath = path.resolve(__dirname, '..', 'main.js');
    const handlers = new Map();
    let latestWebContents = null;
    let dialogOpenResult = { filePaths: [] };
    let axiosPostImpl = async () => {
        throw new Error('Forced axios failure');
    };
    const shellCalls = {
        openPath: [],
        openExternal: [],
        showItemInFolder: []
    };

    const appStub = {
        isPackaged: false,
        name: 'DateBack',
        getPath: (name) => {
            if (name === 'home') return '/home/test';
            if (name === 'downloads') return '/home/test/Downloads';
            return '/home/test';
        },
        getVersion: () => '0.0.0-test',
        whenReady: () => ({ then: (cb) => { if (typeof cb === 'function') cb(); } }),
        on: () => { },
        quit: () => { }
    };

    class BrowserWindowStub {
        constructor() {
            this.webContents = {
                send: () => { },
                getURL: () => 'file:///Users/test/DateBack_App_Source/src/index.html',
                once: (_event, cb) => { if (typeof cb === 'function') cb(); },
                on: () => { },
                setWindowOpenHandler: () => { },
                session: { setPermissionRequestHandler: () => { } },
                mainFrame: {
                    routingId: 1,
                    frameTreeNodeId: 1
                }
            };
            latestWebContents = this.webContents;
        }
        loadFile() { }
        isDestroyed() { return false; }
        static getAllWindows() { return []; }
    }

    const electronStub = {
        app: appStub,
        BrowserWindow: BrowserWindowStub,
        ipcMain: {
            handle: (channel, fn) => handlers.set(channel, fn),
            on: () => { }
        },
        dialog: {
            showOpenDialog: async () => dialogOpenResult,
            showMessageBox: async () => ({ response: 1 })
        },
        shell: {
            openPath: (targetPath) => {
                shellCalls.openPath.push(targetPath);
                return '';
            },
            openExternal: (url) => {
                shellCalls.openExternal.push(url);
            },
            showItemInFolder: (targetPath) => {
                shellCalls.showItemInFolder.push(targetPath);
            }
        },
        Menu: {
            buildFromTemplate: () => ({}),
            setApplicationMenu: () => { }
        }
    };

    const autoUpdaterStub = {
        autoDownload: false,
        autoInstallOnAppQuit: true,
        allowDowngrade: false,
        allowPrerelease: false,
        on: () => { },
        checkForUpdates: () => { },
        downloadUpdate: () => { },
        quitAndInstall: () => { }
    };

    class StoreStub {
        get() { return undefined; }
        set() { }
    }

    class LoggerStub {
        getLogDirectory() { return '/tmp/dateback-test-logs'; }
        info() { }
        warn() { }
        error() { }
        debug() { }
        flush() { return Promise.resolve(); }
    }

    class SupportLogsStub { }

    const originalLoad = Module._load;
    const originalSetInterval = global.setInterval;
    const originalSetTimeout = global.setTimeout;
    const previousDateBackTestMode = process.env.DATEBACK_TEST_MODE;
    process.env.DATEBACK_TEST_MODE = '1';

    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === 'electron') return electronStub;
        if (request === 'electron-updater') return { autoUpdater: autoUpdaterStub };
        if (request === 'electron-store') return StoreStub;
        if (request === 'axios') return { post: (...args) => axiosPostImpl(...args) };
        if (request === './src/logger') return LoggerStub;
        if (request === './src/supportLogs') return SupportLogsStub;
        if (request === 'dotenv') return { config: () => ({}) };
        return originalLoad.call(this, request, parent, isMain);
    };

    global.setInterval = () => ({ unref() { } });
    global.setTimeout = () => ({ unref() { } });

    delete require.cache[mainPath];
    require(mainPath);

    Module._load = originalLoad;
    global.setInterval = originalSetInterval;
    global.setTimeout = originalSetTimeout;

    return {
        handlers,
        createAuthorizedEvent: () => ({
            sender: latestWebContents,
            senderFrame: {
                url: latestWebContents ? latestWebContents.getURL() : '',
                routingId: latestWebContents?.mainFrame?.routingId,
                frameTreeNodeId: latestWebContents?.mainFrame?.frameTreeNodeId
            }
        }),
        setDialogOpenResult: (result) => {
            dialogOpenResult = result;
        },
        setAxiosPostImpl: (impl) => {
            axiosPostImpl = impl;
        },
        getShellCalls: () => ({
            openPath: [...shellCalls.openPath],
            openExternal: [...shellCalls.openExternal],
            showItemInFolder: [...shellCalls.showItemInFolder]
        }),
        resetShellCalls: () => {
            shellCalls.openPath.length = 0;
            shellCalls.openExternal.length = 0;
            shellCalls.showItemInFolder.length = 0;
        },
        restoreEnv: () => {
            if (previousDateBackTestMode === undefined) {
                delete process.env.DATEBACK_TEST_MODE;
            } else {
                process.env.DATEBACK_TEST_MODE = previousDateBackTestMode;
            }
        }
    };
}

function createFakeProc() {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => { };
    return proc;
}

function fakeSpawnProc() {
    return createFakeProc();
}

function withOverrides(overrides) {
    globalThis.__DATEBACK_MAIN_TEST_OVERRIDES = overrides;
}

function mkTmpDirReal(prefix = 'dateback-test-') {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function mkTmpFile(name = 'tmp.txt', contents = '') {
    const filePath = path.join(
        os.tmpdir(),
        `dateback-${Date.now()}-${Math.random().toString(16).slice(2)}-${name}`
    );
    fs.writeFileSync(filePath, contents);
    return filePath;
}

function rmTmp(targetPath) {
    if (!targetPath || !fs.existsSync(targetPath)) {
        return;
    }
    const stat = fs.lstatSync(targetPath);
    if (stat.isDirectory()) {
        fs.rmSync(targetPath, { recursive: true, force: true });
    } else {
        fs.unlinkSync(targetPath);
    }
}

function cleanupTmp(paths) {
    for (const targetPath of paths) {
        rmTmp(targetPath);
    }
}

function makeSpawnRecorder() {
    const calls = [];
    const procs = [];
    return {
        calls,
        procs,
        spawnStub: (command, args, options) => {
            const proc = fakeSpawnProc();
            calls.push({ command, args, options, proc });
            procs.push(proc);
            return proc;
        }
    };
}

async function callHandler(handlerName, event, ...args) {
    const handler = handlers.get(handlerName);
    return handler(event, ...args);
}

async function expectUnauthorized(handlerName, payload, expected) {
    const result = await callHandler(handlerName, {}, payload);
    assert.deepEqual(result, expected);
}

const { handlers, createAuthorizedEvent, setDialogOpenResult, setAxiosPostImpl, getShellCalls, resetShellCalls, restoreEnv } = bootstrapMainForTests();

function killLeakedCaffeinateProcesses() {
    const handles = typeof process._getActiveHandles === 'function' ? process._getActiveHandles() : [];
    for (const handle of handles) {
        if (!handle || !handle.constructor || handle.constructor.name !== 'ChildProcess') {
            continue;
        }
        if (handle.spawnfile !== 'caffeinate') {
            continue;
        }
        if (typeof handle.kill === 'function' && !handle.killed) {
            try {
                handle.kill('SIGKILL');
            } catch {
                // Best-effort teardown for leaked child processes.
            }
        }
    }
}

test.afterEach(() => {
    delete globalThis.__DATEBACK_MAIN_TEST_OVERRIDES;
    setDialogOpenResult({ filePaths: [] });
    setAxiosPostImpl(async () => {
        throw new Error('Forced axios failure');
    });
    resetShellCalls();
    killLeakedCaffeinateProcesses();
});

test.after(() => {
    restoreEnv();
    killLeakedCaffeinateProcesses();
});

test('start-processing rejects unauthorized sender', async () => {
    withOverrides({
        validateSender: () => false
    });
    await expectUnauthorized('start-processing', {}, { success: false, error: 'Unauthorized sender' });
});

test('start-processing returns MODE_CONFLICT for auto+manual enabled', async () => {
    withOverrides({
        validateSender: () => true,
        validateAndCanonicalizeOutputDir: () => ({ success: true, canonicalOutputDir: '/tmp/out' })
    });

    const result = await callHandler('start-processing', {}, {
        zipPath: '/tmp/unused.zip',
        outputDir: '/tmp/out',
        pauseBetweenBatches: true,
        autoUpload: true
    });

    assert.deepEqual(result, {
        success: false,
        errorType: 'MODE_CONFLICT',
        message: 'Choose either Store Memories on Cloud or Store Memories on Computer with Pause after batch (not both).',
        error: 'Choose either Store Memories on Cloud or Store Memories on Computer with Pause after batch (not both).'
    });
});

test('start-processing happy path uses organizer args and spawn options', async () => {
    const tmpZipPath = mkTmpFile('start.zip', 'zip');
    const spawnRecorder = makeSpawnRecorder();
    const expectedCliArgs = ['--sentinel-start'];

    withOverrides({
        validateSender: () => true,
        validateAndCanonicalizeOutputDir: () => ({ success: true, canonicalOutputDir: '/tmp/out' }),
        resolveAndValidateAutoUploadOptions: async () => ({
            success: true,
            options: {
                autoUploadEnabled: false,
                normalizedUploadMode: 'copy',
                resolvedCacheGb: 5,
                resolvedCacheLowGb: 3,
                resolvedMaxUploadRetries: 20,
                providedStagingDir: false,
                canonicalDestinationDir: null,
                canonicalStagingDir: null
            }
        }),
        buildOrganizerArgsForStart: () => expectedCliArgs,
        resolveOrganizerCommand: (_isDev, args) => {
            assert.deepEqual(args, expectedCliArgs);
            return { command: 'dummy-organizer', args, ffmpegPath: '/ffmpeg' };
        },
        cleanupOrphanedProcesses: () => { },
        spawn: spawnRecorder.spawnStub
    });

    const promise = callHandler('start-processing', {}, {
        zipPath: tmpZipPath,
        outputDir: '/tmp/out',
        pauseBetweenBatches: false,
        resumeMode: 'skip',
        autoUpload: false
    });
    await new Promise((resolve) => setImmediate(resolve));

    const organizerCall = spawnRecorder.calls.find((c) => c.command === 'dummy-organizer');
    assert.ok(organizerCall, `expected organizer spawn call, saw: ${JSON.stringify(spawnRecorder.calls.map(c => ({ command: c.command, args: c.args })))}`);
    assert.deepEqual(organizerCall.args, expectedCliArgs);
    assert.deepEqual(organizerCall.options.stdio, ['pipe', 'pipe', 'pipe']);
    assert.equal(organizerCall.options.shell, false);
    assert.equal(organizerCall.options.env.FFMPEG_PATH, '/ffmpeg');

    organizerCall.proc.emit('close', 0);
    const result = await promise;
    assert.deepEqual(result, { success: true });

    cleanupTmp([tmpZipPath]);
});

test('start-processing call-shape preserves resolveOrganizerCommand and runOrganizerSubprocess inputs', async () => {
    const tmpZipPath = mkTmpFile('call-shape-start.zip', 'zip');
    const tmpOutDir = mkTmpDirReal('dateback-call-shape-start-');
    const expectedArgs = ['--expected-start-1', '--expected-start-2'];
    const captured = {
        resolveOrganizerCommand: null,
        runOrganizerSubprocess: null
    };

    withOverrides({
        validateSender: () => true,
        validateAndCanonicalizeOutputDir: () => ({ success: true, canonicalOutputDir: tmpOutDir }),
        resolveAndValidateAutoUploadOptions: async () => ({
            success: true,
            options: {
                autoUploadEnabled: false,
                normalizedUploadMode: 'copy',
                resolvedCacheGb: 5,
                resolvedCacheLowGb: 3,
                resolvedMaxUploadRetries: 20,
                providedStagingDir: false,
                canonicalDestinationDir: null,
                canonicalStagingDir: null
            }
        }),
        buildOrganizerArgsForStart: () => expectedArgs,
        cleanupOrphanedProcesses: () => { },
        resolveOrganizerCommand: (isDev, args) => {
            captured.resolveOrganizerCommand = { isDev, args };
            return { command: 'dummy', args, ffmpegPath: '/ffmpeg' };
        },
        runOrganizerSubprocess: (payload) => {
            captured.runOrganizerSubprocess = payload;
            return Promise.resolve({ success: true });
        }
    });

    try {
        const result = await callHandler('start-processing', {}, {
            zipPath: tmpZipPath,
            outputDir: tmpOutDir,
            pauseBetweenBatches: false,
            resumeMode: 'skip',
            autoUpload: false
        });

        assert.deepEqual(result, { success: true });
        assert.deepEqual(captured.resolveOrganizerCommand, { isDev: true, args: expectedArgs });
        assert.equal(captured.runOrganizerSubprocess.mode, 'start');
        assert.equal(captured.runOrganizerSubprocess.sessionOutputDir, tmpOutDir);
        assert.equal(captured.runOrganizerSubprocess.organizer.command, 'dummy');
        assert.deepEqual(captured.runOrganizerSubprocess.organizer.args, expectedArgs);
        assert.equal(captured.runOrganizerSubprocess.env.FFMPEG_PATH, '/ffmpeg');
        assert.ok(captured.runOrganizerSubprocess.env.PATH);
    } finally {
        cleanupTmp([tmpOutDir, tmpZipPath]);
    }
});

test('retry-corrupted rejects unauthorized sender', async () => {
    withOverrides({
        validateSender: () => false
    });
    await expectUnauthorized('retry-corrupted', {}, { success: false, error: 'Unauthorized sender' });
});

test('retry-corrupted returns missing report error when report is absent', async () => {
    withOverrides({
        validateSender: () => true,
        validateAndCanonicalizeOutputDir: () => ({ success: true, canonicalOutputDir: '/tmp/out' }),
        resolveAndValidateAutoUploadOptions: async () => ({
            success: true,
            options: {
                autoUploadEnabled: false,
                normalizedUploadMode: 'copy',
                resolvedCacheGb: 5,
                resolvedCacheLowGb: 3,
                resolvedMaxUploadRetries: 20,
                providedStagingDir: false,
                canonicalDestinationDir: null,
                canonicalStagingDir: null
            }
        }),
        fsExistsSync: () => false
    });

    const result = await callHandler('retry-corrupted', {}, { outputDir: '/tmp/out' });

    assert.deepEqual(result, { success: false, error: 'No detailed_report.json found. Run full processing first.' });
});

test('retry-corrupted happy path parses complete stats from stdout', async () => {
    const expectedStats = { images: 2, videos: 1, errors: 0 };
    const expectedRetryArgs = ['--sentinel-retry'];
    const spawnRecorder = makeSpawnRecorder();

    withOverrides({
        validateSender: () => true,
        validateAndCanonicalizeOutputDir: () => ({ success: true, canonicalOutputDir: '/tmp/out' }),
        resolveAndValidateAutoUploadOptions: async () => ({
            success: true,
            options: {
                autoUploadEnabled: true,
                normalizedUploadMode: 'copy',
                resolvedCacheGb: 5,
                resolvedCacheLowGb: 3,
                resolvedMaxUploadRetries: 20,
                providedStagingDir: true,
                canonicalDestinationDir: '/tmp/dest',
                canonicalStagingDir: '/tmp/stage'
            }
        }),
        buildOrganizerArgsForRetry: () => expectedRetryArgs,
        resolveOrganizerCommand: (_isDev, args) => {
            assert.deepEqual(args, expectedRetryArgs);
            return { command: 'dummy-retry-organizer', args, ffmpegPath: '/ffmpeg' };
        },
        fsExistsSync: () => true,
        spawn: spawnRecorder.spawnStub
    });

    const promise = callHandler('retry-corrupted', {}, {
        outputDir: '/tmp/out',
        autoUpload: true,
        destinationDir: '/tmp/dest',
        stagingDir: '/tmp/stage',
        cacheGb: 5,
        cacheLowGb: 3,
        maxUploadRetries: 20
    });
    await new Promise((resolve) => setImmediate(resolve));

    const organizerCall = spawnRecorder.calls.find((c) => c.command === 'dummy-retry-organizer');
    assert.ok(organizerCall, `expected retry organizer spawn call, saw: ${JSON.stringify(spawnRecorder.calls.map(c => ({ command: c.command, args: c.args })))}`);
    assert.deepEqual(organizerCall.args, expectedRetryArgs);
    assert.equal(organizerCall.options.shell, false);
    assert.equal(organizerCall.options.env.FFMPEG_PATH, '/ffmpeg');

    organizerCall.proc.stdout.emit('data', Buffer.from(`hello\n${JSON.stringify({ type: 'complete', stats: expectedStats })}\n`));
    organizerCall.proc.emit('close', 0);

    const result = await promise;
    assert.equal(result.success, true);
    assert.deepEqual(result.stats, expectedStats);
    assert.ok(result.message.includes('hello'));
});

test('retry-corrupted call-shape preserves resolveOrganizerCommand and runOrganizerSubprocess inputs', async () => {
    const tmpOutDir = mkTmpDirReal('dateback-call-shape-retry-');
    const expectedRetryArgs = ['--expected-retry-1', '--expected-retry-2'];
    const captured = {
        resolveOrganizerCommand: null,
        runOrganizerSubprocess: null
    };

    withOverrides({
        validateSender: () => true,
        validateAndCanonicalizeOutputDir: () => ({ success: true, canonicalOutputDir: tmpOutDir }),
        resolveAndValidateAutoUploadOptions: async () => ({
            success: true,
            options: {
                autoUploadEnabled: true,
                normalizedUploadMode: 'copy',
                resolvedCacheGb: 5,
                resolvedCacheLowGb: 3,
                resolvedMaxUploadRetries: 20,
                providedStagingDir: true,
                canonicalDestinationDir: '/tmp/dest',
                canonicalStagingDir: '/tmp/stage'
            }
        }),
        fsExistsSync: () => true,
        buildOrganizerArgsForRetry: () => expectedRetryArgs,
        resolveOrganizerCommand: (isDev, args) => {
            captured.resolveOrganizerCommand = { isDev, args };
            return { command: 'dummy', args, ffmpegPath: '/ffmpeg' };
        },
        runOrganizerSubprocess: (payload) => {
            captured.runOrganizerSubprocess = payload;
            return Promise.resolve({ success: true });
        }
    });

    try {
        const result = await callHandler('retry-corrupted', {}, {
            outputDir: tmpOutDir,
            autoUpload: true,
            destinationDir: '/tmp/dest',
            stagingDir: '/tmp/stage',
            cacheGb: 5,
            cacheLowGb: 3,
            uploadMode: 'copy',
            maxUploadRetries: 20
        });

        assert.deepEqual(result, { success: true });
        assert.deepEqual(captured.resolveOrganizerCommand, { isDev: true, args: expectedRetryArgs });
        assert.equal(captured.runOrganizerSubprocess.mode, 'retry');
        assert.equal(captured.runOrganizerSubprocess.sessionOutputDir, undefined);
        assert.equal(captured.runOrganizerSubprocess.organizer.command, 'dummy');
        assert.deepEqual(captured.runOrganizerSubprocess.organizer.args, expectedRetryArgs);
        assert.equal(captured.runOrganizerSubprocess.env.FFMPEG_PATH, '/ffmpeg');
    } finally {
        cleanupTmp([tmpOutDir]);
    }
});

test('start-processing session output dir is active during run and cleared after close', async () => {
    const tmpZipPath = mkTmpFile('lifecycle.zip', 'zip');
    const tmpOutDir = mkTmpDirReal('dateback-out-');
    const spawnRecorder = makeSpawnRecorder();

    withOverrides({
        validateSender: () => true,
        validateAndCanonicalizeOutputDir: () => ({ success: true, canonicalOutputDir: tmpOutDir }),
        resolveAndValidateAutoUploadOptions: async () => ({
            success: true,
            options: {
                autoUploadEnabled: false,
                normalizedUploadMode: 'copy',
                resolvedCacheGb: 5,
                resolvedCacheLowGb: 3,
                resolvedMaxUploadRetries: 20,
                providedStagingDir: false,
                canonicalDestinationDir: null,
                canonicalStagingDir: null
            }
        }),
        buildOrganizerArgsForStart: () => ['--lifecycle-start'],
        resolveOrganizerCommand: () => ({ command: 'dummy-organizer', args: ['--lifecycle-start'], ffmpegPath: '/ffmpeg' }),
        cleanupOrphanedProcesses: () => { },
        spawn: spawnRecorder.spawnStub
    });

    const startPromise = callHandler('start-processing', {}, {
        zipPath: tmpZipPath,
        outputDir: tmpOutDir,
        pauseBetweenBatches: false,
        resumeMode: 'skip',
        autoUpload: false
    });
    await new Promise((resolve) => setImmediate(resolve));

    const organizerCall = spawnRecorder.calls.find((c) => c.command === 'dummy-organizer');
    assert.ok(organizerCall, 'expected organizer spawn call for lifecycle test');

    const resumeWhileRunning = await callHandler('resume-batch', createAuthorizedEvent());
    assert.deepEqual(resumeWhileRunning, { success: true });

    organizerCall.proc.emit('close', 0);
    const startResult = await startPromise;
    assert.deepEqual(startResult, { success: true });

    const resumeAfterClose = await callHandler('resume-batch', createAuthorizedEvent());
    assert.deepEqual(resumeAfterClose, { success: false, error: 'No active processing session' });

    cleanupTmp([tmpOutDir, tmpZipPath]);
});

test('validate-zip rejects unauthorized sender', async () => {
    const result = await callHandler('validate-zip', {}, '/tmp/anything.zip');
    assert.deepEqual(result, { found: false, error: 'Unauthorized sender', count: 0 });
});

test('validate-zip rejects non-zip paths with exact message', async () => {
    const result = await callHandler('validate-zip', createAuthorizedEvent(), '/tmp/not-a-zip.txt');
    assert.deepEqual(result, { found: false, error: 'Selected file is not a ZIP archive.', count: 0 });
});

test('validate-zip blocks zip-slip entries with exact error', async () => {
    withOverrides({
        fsLstatSync: () => ({
            isFile: () => true,
            isSymbolicLink: () => false
        }),
        AdmZip: function MockAdmZip() {
            return {
                getEntries: () => ([
                    { entryName: '../evil.txt', header: { size: 1 } }
                ])
            };
        }
    });

    const result = await callHandler('validate-zip', createAuthorizedEvent(), '/tmp/mock.zip');
    assert.deepEqual(result, {
        found: false,
        error: 'ZIP contains invalid file paths (path traversal detected). Please use a legitimate Snapchat export.',
        count: 0
    });
});

test('open-folder rejects unauthorized sender', async () => {
    await expectUnauthorized('open-folder', '/tmp', { success: false, error: 'Unauthorized sender' });
});

test('open-folder returns sanitize error for invalid payload type', async () => {
    const result = await callHandler('open-folder', createAuthorizedEvent(), null);
    assert.deepEqual(result, { success: false, error: 'Folder path must be a string' });
});

test('open-folder returns missing path error', async () => {
    const missingPath = path.join(os.tmpdir(), `dateback-missing-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const result = await callHandler('open-folder', createAuthorizedEvent(), missingPath);
    assert.deepEqual(result, { success: false, error: 'Path does not exist' });
});

test('open-folder rejects non-directory targets', async () => {
    const tmpFile = mkTmpFile('not-a-dir.txt', 'x');

    try {
        const result = await callHandler('open-folder', createAuthorizedEvent(), tmpFile);
        assert.deepEqual(result, { success: false, error: 'Target is not a directory' });
    } finally {
        cleanupTmp([tmpFile]);
    }
});

test('open-folder rejects unapproved directories', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dateback-unapproved-open-'));

    try {
        const result = await callHandler('open-folder', createAuthorizedEvent(), tmpDir);
        assert.deepEqual(result, { success: false, error: 'Access denied: Folder not in approved list.' });
    } finally {
        cleanupTmp([tmpDir]);
    }
});

test('open-folder allows the same outputDir after successful start-processing validation', async () => {
    const tmpZipPath = mkTmpFile('open-folder-approved-by-start.zip', 'zip');
    const tmpOutDir = mkTmpDirReal('dateback-open-folder-approved-');

    withOverrides({
        validateAndCanonicalizeOutputDir: () => ({ success: true, canonicalOutputDir: tmpOutDir }),
        resolveAndValidateAutoUploadOptions: async () => ({
            success: true,
            options: {
                autoUploadEnabled: false,
                normalizedUploadMode: 'copy',
                resolvedCacheGb: 5,
                resolvedCacheLowGb: 3,
                resolvedMaxUploadRetries: 20,
                providedStagingDir: false,
                canonicalDestinationDir: null,
                canonicalStagingDir: null
            }
        }),
        buildOrganizerArgsForStart: () => ['--open-folder-approved-by-start'],
        resolveOrganizerCommand: () => ({
            command: 'dummy-organizer',
            args: ['--open-folder-approved-by-start'],
            ffmpegPath: '/ffmpeg'
        }),
        cleanupOrphanedProcesses: () => { },
        runOrganizerSubprocess: () => Promise.resolve({ success: true })
    });

    try {
        const startResult = await callHandler('start-processing', createAuthorizedEvent(), {
            zipPath: tmpZipPath,
            outputDir: tmpOutDir,
            pauseBetweenBatches: false,
            resumeMode: 'skip',
            autoUpload: false
        });
        assert.deepEqual(startResult, { success: true });

        const openResult = await callHandler('open-folder', createAuthorizedEvent(), tmpOutDir);
        assert.deepEqual(openResult, { success: true });

        const shellCalls = getShellCalls();
        assert.deepEqual(shellCalls.openPath, [tmpOutDir]);
    } finally {
        cleanupTmp([tmpOutDir, tmpZipPath]);
    }
});

test('get-resume-manifest rejects unauthorized sender', async () => {
    await expectUnauthorized('get-resume-manifest', { outputDir: '/tmp/out' }, { success: false, error: 'Unauthorized sender' });
});

test('get-resume-manifest rejects sensitive root output directory', async () => {
    const result = await callHandler('get-resume-manifest', createAuthorizedEvent(), { outputDir: '/home/test/Documents' });
    assert.deepEqual(result, { success: false, error: 'Output directory is a restricted system folder.' });
});

test('get-resume-manifest rejects unapproved output directory', async () => {
    const result = await callHandler('get-resume-manifest', createAuthorizedEvent(), { outputDir: '/tmp/dateback-unapproved-manifest' });
    assert.deepEqual(result, { success: false, error: 'Output directory not approved' });
});

test('get-resume-manifest returns null manifest when no files exist', async () => {
    const result = await callHandler('get-resume-manifest', createAuthorizedEvent(), { outputDir: '/home/test/Pictures/SnapchatMemories' });
    assert.deepEqual(result, { success: true, manifest: null });
});

test('clear-output-folder rejects unauthorized sender', async () => {
    await expectUnauthorized('clear-output-folder', { outputDir: '/tmp/out' }, { success: false, error: 'Unauthorized sender' });
});

test('clear-output-folder rejects unapproved directory and logs security prefix', async () => {
    const logLines = [];
    const originalConsoleError = console.error;
    console.error = (...args) => {
        logLines.push(args.map(String).join(' '));
    };

    try {
        const result = await callHandler('clear-output-folder', createAuthorizedEvent(), { outputDir: '/tmp/dateback-unapproved-clear' });
        assert.deepEqual(result, { success: false, error: 'Output directory not approved.' });
        assert.ok(
            logLines.some((line) => line.startsWith('[SECURITY] Rejected unapproved output directory for clearing:')),
            `expected security prefix log, saw: ${JSON.stringify(logLines)}`
        );
    } finally {
        console.error = originalConsoleError;
    }
});

test('resume-batch rejects unauthorized sender', async () => {
    await expectUnauthorized('resume-batch', undefined, { success: false, error: 'Unauthorized sender' });
});

test('resume-batch returns no active session when not processing', async () => {
    const result = await callHandler('resume-batch', createAuthorizedEvent());
    assert.deepEqual(result, { success: false, error: 'No active processing session' });
});

test('resume-batch happy path writes signal file in active session dir', async () => {
    const tmpZipPath = mkTmpFile('resume.zip', 'zip');
    const tmpOutDir = mkTmpDirReal('dateback-resume-out-');
    const spawnRecorder = makeSpawnRecorder();
    withOverrides({
        validateSender: () => true,
        validateAndCanonicalizeOutputDir: () => ({ success: true, canonicalOutputDir: tmpOutDir }),
        resolveAndValidateAutoUploadOptions: async () => ({
            success: true,
            options: {
                autoUploadEnabled: false,
                normalizedUploadMode: 'copy',
                resolvedCacheGb: 5,
                resolvedCacheLowGb: 3,
                resolvedMaxUploadRetries: 20,
                providedStagingDir: false,
                canonicalDestinationDir: null,
                canonicalStagingDir: null
            }
        }),
        buildOrganizerArgsForStart: () => ['--resume-happy-path'],
        resolveOrganizerCommand: () => ({ command: 'dummy-organizer', args: ['--resume-happy-path'], ffmpegPath: '/ffmpeg' }),
        cleanupOrphanedProcesses: () => { },
        spawn: spawnRecorder.spawnStub
    });

    const startPromise = callHandler('start-processing', {}, {
        zipPath: tmpZipPath,
        outputDir: tmpOutDir,
        pauseBetweenBatches: false,
        resumeMode: 'skip',
        autoUpload: false
    });
    await new Promise((resolve) => setImmediate(resolve));

    const organizerCall = spawnRecorder.calls.find((c) => c.command === 'dummy-organizer');
    assert.ok(organizerCall, 'expected organizer spawn call for resume happy path test');

    const result = await callHandler('resume-batch', createAuthorizedEvent());
    assert.deepEqual(result, { success: true });

    const expectedSignalPath = path.join(tmpOutDir, '.dateback_resume_signal');
    assert.equal(fs.existsSync(expectedSignalPath), true);
    assert.equal(fs.readFileSync(expectedSignalPath, 'utf8'), 'RESUME');
    const signalFiles = fs.readdirSync(tmpOutDir).filter((name) => name.includes('resume_signal'));
    assert.deepEqual(signalFiles, ['.dateback_resume_signal']);

    organizerCall.proc.emit('close', 0);
    await startPromise;

    cleanupTmp([tmpOutDir, tmpZipPath]);
});

test('select-folder returns null for unauthorized sender', async () => {
    await expectUnauthorized('select-folder', undefined, null);
});

test('select-folder returns null when no folder is selected', async () => {
    const result = await callHandler('select-folder', createAuthorizedEvent());
    assert.equal(result, null);
});

test('select-folder happy path returns selected path and approves it for open-folder', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dateback-select-folder-'));

    try {
        setDialogOpenResult({ canceled: false, filePaths: [tmpDir] });
        const selected = await callHandler('select-folder', createAuthorizedEvent());
        assert.equal(selected, tmpDir);

        const openResult = await callHandler('open-folder', createAuthorizedEvent(), tmpDir);
        assert.deepEqual(openResult, { success: true });
    } finally {
        cleanupTmp([tmpDir]);
    }
});

test('open-url rejects unauthorized sender', async () => {
    await expectUnauthorized('open-url', 'https://example.com', { success: false, error: 'Unauthorized sender' });
});

test('open-url returns invalid url for non-string payload', async () => {
    const result = await callHandler('open-url', createAuthorizedEvent(), 12345);
    assert.deepEqual(result, { success: false, error: 'Invalid URL' });
});

test('open-url happy path opens external url and returns success shape', async () => {
    const targetUrl = 'https://example.com/';
    const result = await callHandler('open-url', createAuthorizedEvent(), targetUrl);
    assert.deepEqual(result, { success: true });

    const shellCalls = getShellCalls();
    assert.deepEqual(shellCalls.openExternal, [targetUrl]);
});

test('open-external rejects unauthorized sender', async () => {
    await expectUnauthorized('open-external', 'https://example.com', { success: false, error: 'Unauthorized sender' });
});

test('open-external blocks disallowed protocol', async () => {
    const result = await callHandler('open-external', createAuthorizedEvent(), 'file:///tmp/test');
    assert.deepEqual(result, { success: false, error: 'Protocol file: is not allowed' });
});

test('open-external happy path opens external url and returns success shape', async () => {
    const targetUrl = 'https://example.com/';
    const result = await callHandler('open-external', createAuthorizedEvent(), targetUrl);
    assert.deepEqual(result, { success: true });

    const shellCalls = getShellCalls();
    assert.deepEqual(shellCalls.openExternal, [targetUrl]);
});

test('validate-license rejects unauthorized sender', async () => {
    await expectUnauthorized('validate-license', 'ABC-123', { success: false, valid: false, message: 'Unauthorized sender' });
});

test('validate-license returns connectivity failure message on request error', async () => {
    setAxiosPostImpl(async () => {
        throw new Error('Deterministic network failure');
    });
    const result = await callHandler('validate-license', createAuthorizedEvent(), 'ABC-123');
    assert.deepEqual(result, {
        success: false,
        valid: false,
        message: 'Failed to validate license. Please check your internet connection.'
    });
});
