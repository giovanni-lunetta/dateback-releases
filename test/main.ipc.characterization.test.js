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
    let latestMenuTemplate = null;
    const sentIpcMessages = [];
    let dialogOpenResult = { filePaths: [] };
    const messageBoxCalls = [];
    const shellCalls = {
        openPath: [],
        openExternal: [],
        showItemInFolder: []
    };

    const appStub = {
        isPackaged: false,
        name: 'DateBack',
        getPath: (name) => {
            const testPaths = globalThis.__DATEBACK_MAIN_TEST_APP_PATHS || {};
            const homePath = testPaths.home || '/home/test';
            if (name === 'home') return homePath;
            if (name === 'downloads') return testPaths.downloads || path.join(homePath, 'Downloads');
            if (name === 'pictures') return testPaths.pictures || path.join(homePath, 'Pictures');
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
                send: (channel, ...args) => {
                    sentIpcMessages.push({ channel, args });
                },
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
        on() { }
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
            showMessageBox: async (...args) => {
                messageBoxCalls.push(args);
                return { response: 1 };
            }
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
            buildFromTemplate: (template) => {
                latestMenuTemplate = template;
                return {};
            },
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
        getLatestMenuTemplate: () => latestMenuTemplate,
        getMessageBoxCalls: () => messageBoxCalls.map((args) => [...args]),
        resetMessageBoxCalls: () => {
            messageBoxCalls.length = 0;
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
        getSentIpcMessages: () => sentIpcMessages.map((entry) => ({ channel: entry.channel, args: [...entry.args] })),
        resetSentIpcMessages: () => {
            sentIpcMessages.length = 0;
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

function withAppHome(homeDir) {
    globalThis.__DATEBACK_MAIN_TEST_APP_PATHS = {
        home: homeDir,
        downloads: path.join(homeDir, 'Downloads'),
        pictures: path.join(homeDir, 'Pictures')
    };
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

function writeFileWithMtime(filePath, contents, mtimeSeconds) {
    fs.writeFileSync(filePath, contents);
    const mtime = new Date(mtimeSeconds * 1000);
    fs.utimesSync(filePath, mtime, mtime);
}

function zipSetFingerprint(zipPaths) {
    return [...zipPaths].sort().map((zipPath) => {
        const st = fs.statSync(zipPath);
        return `${path.basename(zipPath)}|${st.size}|${Math.floor(st.mtimeMs / 1000)}`;
    }).join(';');
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

async function approveFolderSelection(targetPath, purpose) {
    setDialogOpenResult({ canceled: false, filePaths: [targetPath] });
    const selected = await callHandler('select-folder', createAuthorizedEvent(), purpose);
    assert.equal(selected, targetPath);
}

const { handlers, createAuthorizedEvent, setDialogOpenResult, getLatestMenuTemplate, getMessageBoxCalls, resetMessageBoxCalls, getShellCalls, resetShellCalls, getSentIpcMessages, resetSentIpcMessages, restoreEnv } = bootstrapMainForTests();

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
    delete globalThis.__DATEBACK_MAIN_TEST_APP_PATHS;
    setDialogOpenResult({ filePaths: [] });
    resetMessageBoxCalls();
    resetShellCalls();
    resetSentIpcMessages();
    killLeakedCaffeinateProcesses();
});

test.after(() => {
    restoreEnv();
    killLeakedCaffeinateProcesses();
});

test('About DateBack dialog uses the current app version', async () => {
    const template = getLatestMenuTemplate();
    assert.ok(Array.isArray(template), 'expected menu template to be captured');

    const appMenu = template.find((item) => item && item.label === 'DateBack');
    assert.ok(appMenu, 'expected app menu entry');

    const aboutItem = appMenu.submenu.find((item) => item && item.label === 'About DateBack');
    assert.ok(aboutItem && typeof aboutItem.click === 'function', 'expected About DateBack menu action');

    await aboutItem.click();

    const calls = getMessageBoxCalls();
    assert.equal(calls.length, 1);
    const [, options] = calls[0];
    assert.match(options.detail, /Version: 0\.0\.0-test/);
    assert.doesNotMatch(options.detail, /Version: 1\.0\.6/);
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
    const previousSecret = process.env.DATEBACK_SECRET_SHOULD_NOT_LEAK;
    const previousLogFlag = process.env.DATEBACK_LOG_TEST_FLAG;
    const previousDebugFlag = process.env.DATEBACK_DEBUG_ZIP_METRICS;
    process.env.DATEBACK_SECRET_SHOULD_NOT_LEAK = 'do-not-copy';
    process.env.DATEBACK_LOG_TEST_FLAG = 'copy-log-var';
    process.env.DATEBACK_DEBUG_ZIP_METRICS = '1';

    try {
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
        assert.ok(organizerCall.options.env.PATH);
        assert.equal(organizerCall.options.env.DATEBACK_LOG_DIR, '/tmp/dateback-test-logs');
        assert.equal(organizerCall.options.env.DATEBACK_LOG_TEST_FLAG, 'copy-log-var');
        assert.equal(organizerCall.options.env.DATEBACK_DEBUG_ZIP_METRICS, '1');
        assert.equal(organizerCall.options.env.DATEBACK_SECRET_SHOULD_NOT_LEAK, undefined);

        organizerCall.proc.emit('close', 0);
        const result = await promise;
        assert.deepEqual(result, { success: true });

        cleanupTmp([tmpZipPath]);
    } finally {
        if (previousSecret === undefined) {
            delete process.env.DATEBACK_SECRET_SHOULD_NOT_LEAK;
        } else {
            process.env.DATEBACK_SECRET_SHOULD_NOT_LEAK = previousSecret;
        }
        if (previousLogFlag === undefined) {
            delete process.env.DATEBACK_LOG_TEST_FLAG;
        } else {
            process.env.DATEBACK_LOG_TEST_FLAG = previousLogFlag;
        }
        if (previousDebugFlag === undefined) {
            delete process.env.DATEBACK_DEBUG_ZIP_METRICS;
        } else {
            process.env.DATEBACK_DEBUG_ZIP_METRICS = previousDebugFlag;
        }
        cleanupTmp([tmpZipPath]);
    }
});

test('start-processing rejects unapproved auto-upload destination directory', async () => {
    const tmpRoot = mkTmpDirReal('dateback-auto-destination-');
    const outputDir = path.join(tmpRoot, 'output');
    const destinationDir = path.join(tmpRoot, 'destination');
    const tmpZipPath = path.join(tmpRoot, 'auto-destination.zip');
    fs.writeFileSync(tmpZipPath, 'zip');

    try {
        await approveFolderSelection(outputDir, 'output');
        withOverrides({
            cleanupOrphanedProcesses: () => { },
            buildOrganizerArgsForStart: () => ['--auto-destination-unapproved'],
            resolveOrganizerCommand: () => ({
                command: 'dummy-organizer',
                args: ['--auto-destination-unapproved'],
                ffmpegPath: '/ffmpeg'
            }),
            runOrganizerSubprocess: () => Promise.resolve({ success: true }),
            spawn: makeSpawnRecorder().spawnStub
        });

        const result = await callHandler('start-processing', createAuthorizedEvent(), {
            zipPath: tmpZipPath,
            outputDir,
            autoUpload: true,
            destinationDir,
            cacheGb: 1,
            cacheLowGb: 0.5,
            uploadMode: 'copy'
        });
        assert.equal(result.success, false);
        assert.equal(result.errorType, 'PATH_VALIDATION');
        assert.match(result.error, /Destination directory not approved/);
    } finally {
        cleanupTmp([tmpRoot]);
    }
});

test('start-processing rejects unapproved auto-upload staging directory', async () => {
    const tmpRoot = mkTmpDirReal('dateback-auto-staging-');
    const outputDir = path.join(tmpRoot, 'output');
    const destinationDir = path.join(tmpRoot, 'destination');
    const stagingDir = path.join(tmpRoot, 'staging');
    const tmpZipPath = path.join(tmpRoot, 'auto-staging.zip');
    fs.writeFileSync(tmpZipPath, 'zip');

    try {
        await approveFolderSelection(outputDir, 'output');
        await approveFolderSelection(destinationDir, 'destination');
        withOverrides({
            cleanupOrphanedProcesses: () => { },
            buildOrganizerArgsForStart: () => ['--auto-staging-unapproved'],
            resolveOrganizerCommand: () => ({
                command: 'dummy-organizer',
                args: ['--auto-staging-unapproved'],
                ffmpegPath: '/ffmpeg'
            }),
            runOrganizerSubprocess: () => Promise.resolve({ success: true }),
            spawn: makeSpawnRecorder().spawnStub
        });

        const result = await callHandler('start-processing', createAuthorizedEvent(), {
            zipPath: tmpZipPath,
            outputDir,
            autoUpload: true,
            destinationDir,
            stagingDir,
            cacheGb: 1,
            cacheLowGb: 0.5,
            uploadMode: 'copy'
        });
        assert.equal(result.success, false);
        assert.equal(result.errorType, 'PATH_VALIDATION');
        assert.match(result.error, /Staging directory not approved/);
    } finally {
        cleanupTmp([tmpRoot]);
    }
});

test('start-processing accepts approved auto-upload destination and staging directories', async () => {
    const tmpRoot = mkTmpDirReal('dateback-auto-approved-');
    const outputDir = path.join(tmpRoot, 'output');
    const destinationDir = path.join(tmpRoot, 'destination');
    const stagingDir = path.join(tmpRoot, 'staging');
    const tmpZipPath = path.join(tmpRoot, 'auto-approved.zip');
    fs.writeFileSync(tmpZipPath, 'zip');

    try {
        await approveFolderSelection(outputDir, 'output');
        await approveFolderSelection(destinationDir, 'destination');
        await approveFolderSelection(stagingDir, 'staging');
        withOverrides({
            cleanupOrphanedProcesses: () => { },
            buildOrganizerArgsForStart: () => ['--auto-approved'],
            resolveOrganizerCommand: () => ({
                command: 'dummy-organizer',
                args: ['--auto-approved'],
                ffmpegPath: '/ffmpeg'
            }),
            runOrganizerSubprocess: () => Promise.resolve({ success: true }),
            spawn: makeSpawnRecorder().spawnStub
        });

        const result = await callHandler('start-processing', createAuthorizedEvent(), {
            zipPath: tmpZipPath,
            outputDir,
            autoUpload: true,
            destinationDir,
            stagingDir,
            cacheGb: 1,
            cacheLowGb: 0.5,
            uploadMode: 'copy'
        });
        assert.deepEqual(result, { success: true });
    } finally {
        cleanupTmp([tmpRoot]);
    }
});

test('start-processing does not start caffeinate before zip validation succeeds', async () => {
    const tmpRoot = mkTmpDirReal('dateback-invalid-start-');
    const outputDir = path.join(tmpRoot, 'output');
    let caffeinateStarted = false;

    try {
        await approveFolderSelection(outputDir, 'output');
        withOverrides({
            spawn: (command) => {
                if (command === 'caffeinate') {
                    caffeinateStarted = true;
                }
                return createFakeProc();
            }
        });

        const result = await callHandler('start-processing', createAuthorizedEvent(), {
            zipPath: path.join(tmpRoot, 'missing.zip'),
            outputDir
        });
        assert.equal(result.success, false);
        assert.equal(caffeinateStarted, false);
    } finally {
        cleanupTmp([tmpRoot]);
    }
});

test('start-processing forwards runtime disk_full events and returns structured disk-full failure', async () => {
    const tmpZipPath = mkTmpFile('disk-full-start.zip', 'zip');
    const spawnRecorder = makeSpawnRecorder();

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
        buildOrganizerArgsForStart: () => ['--sentinel-disk-full'],
        resolveOrganizerCommand: (_isDev, args) => ({ command: 'dummy-organizer', args, ffmpegPath: '/ffmpeg' }),
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
    assert.ok(organizerCall);

    organizerCall.proc.stdout.emit('data', Buffer.from(`${JSON.stringify({
        type: 'disk_full',
        scope: 'output',
        path: '/tmp/out/Batch_01',
        message: 'DateBack stopped because the working drive ran out of space.'
    })}\n`));
    organizerCall.proc.emit('close', 1);

    const result = await promise;
    assert.deepEqual(result, {
        success: false,
        errorType: 'DISK_FULL',
        message: 'DateBack stopped because the working drive ran out of space.',
        details: {
            type: 'disk_full',
            scope: 'output',
            path: '/tmp/out/Batch_01',
            message: 'DateBack stopped because the working drive ran out of space.'
        }
    });

    const progressMessages = getSentIpcMessages().filter((entry) => entry.channel === 'progress-update');
    assert.equal(progressMessages.length, 1);
    assert.deepEqual(progressMessages[0].args[0], {
        type: 'disk_full',
        scope: 'output',
        path: '/tmp/out/Batch_01',
        message: 'DateBack stopped because the working drive ran out of space.'
    });

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
    const result = await callHandler('validate-zip', createAuthorizedEvent(), '/home/test/not-a-zip.txt');
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

    const result = await callHandler('validate-zip', createAuthorizedEvent(), '/home/test/mock.zip');
    assert.deepEqual(result, {
        found: false,
        error: 'ZIP contains invalid file paths (path traversal detected). Please use a legitimate Snapchat export.',
        count: 0
    });
});

test('validate-zip rejects unapproved ZIP paths outside the home directory', async () => {
    const tmpZip = mkTmpFile('outside-home.zip', 'not a real zip');

    try {
        const result = await callHandler('validate-zip', createAuthorizedEvent(), tmpZip);
        assert.deepEqual(result, {
            found: false,
            error: 'ZIP path is outside approved locations. Please choose it with the file picker.',
            count: 0
        });
    } finally {
        cleanupTmp([tmpZip]);
    }
});

test('select-zip-or-folder approves selected ZIP paths outside the home directory for validation', async () => {
    const tmpZip = mkTmpFile('selected-outside-home.zip', 'zip bytes');

    withOverrides({
        AdmZip: function MockAdmZip() {
            return {
                getEntries: () => ([
                    {
                        entryName: 'json/memories_history.json',
                        header: { size: 24 },
                        getData: () => Buffer.from(JSON.stringify({ 'Saved Media': [{}] }))
                    }
                ])
            };
        }
    });

    try {
        setDialogOpenResult({ canceled: false, filePaths: [tmpZip] });
        const selected = await callHandler('select-zip-or-folder', createAuthorizedEvent());
        assert.deepEqual(selected, [tmpZip]);

        const result = await callHandler('validate-zip', createAuthorizedEvent(), tmpZip);
        assert.deepEqual(result, { found: true, count: 1 });
    } finally {
        cleanupTmp([tmpZip]);
    }
});

test('get-disk-free-bytes rejects unapproved paths outside the home directory', async () => {
    const tmpDir = mkTmpDirReal('dateback-disk-outside-home-');

    try {
        const result = await callHandler('get-disk-free-bytes', createAuthorizedEvent(), tmpDir);
        assert.deepEqual(result, {
            success: false,
            error: 'Disk check path is outside approved locations.'
        });
    } finally {
        cleanupTmp([tmpDir]);
    }
});

test('get-disk-free-bytes allows folder-picker approved paths outside the home directory', async () => {
    const tmpDir = mkTmpDirReal('dateback-disk-approved-');

    try {
        await approveFolderSelection(tmpDir);
        const result = await callHandler('get-disk-free-bytes', createAuthorizedEvent(), tmpDir);
        assert.equal(result.success, true);
        assert.equal(typeof result.freeBytes, 'number');
    } finally {
        cleanupTmp([tmpDir]);
    }
});

test('organize-zip-set refuses to overwrite existing organized ZIPs', async () => {
    const homeDir = mkTmpDirReal('dateback-organize-home-');
    const sourceDir = path.join(homeDir, 'Downloads');
    const targetDir = path.join(homeDir, 'Pictures', 'SnapchatMemories', 'Snapchat Zip Files 2026-05-06');
    const sourceZip = path.join(sourceDir, 'mydata~1234.zip');
    const existingZip = path.join(targetDir, 'mydata~1234.zip');

    try {
        withAppHome(homeDir);
        fs.mkdirSync(sourceDir, { recursive: true });
        fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(sourceZip, 'new export');
        fs.writeFileSync(existingZip, 'existing export');

        const result = await callHandler('organize-zip-set', createAuthorizedEvent(), {
            zipPaths: [sourceZip],
            destFolderName: 'Snapchat Zip Files 2026-05-06'
        });

        assert.equal(result.success, false);
        assert.match(result.error, /already exists/i);
        assert.equal(fs.readFileSync(sourceZip, 'utf8'), 'new export');
        assert.equal(fs.readFileSync(existingZip, 'utf8'), 'existing export');
    } finally {
        cleanupTmp([homeDir]);
    }
});

test('organize-zip-set rejects destination names that escape SnapchatMemories', async () => {
    const homeDir = mkTmpDirReal('dateback-organize-home-');
    const sourceDir = path.join(homeDir, 'Downloads');
    const sourceZip = path.join(sourceDir, 'mydata~9876.zip');

    try {
        withAppHome(homeDir);
        fs.mkdirSync(sourceDir, { recursive: true });
        fs.writeFileSync(sourceZip, 'zip bytes');

        const result = await callHandler('organize-zip-set', createAuthorizedEvent(), {
            zipPaths: [sourceZip],
            destFolderName: '../OutsideFolder'
        });

        assert.equal(result.success, false);
        assert.match(result.error, /SnapchatMemories|folder name/i);
        assert.equal(fs.existsSync(sourceZip), true);
        assert.equal(fs.existsSync(path.join(homeDir, 'Pictures', 'OutsideFolder', 'mydata~9876.zip')), false);
    } finally {
        cleanupTmp([homeDir]);
    }
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
    const homeDir = mkTmpDirReal('dateback-sensitive-home-');
    const documentsDir = path.join(homeDir, 'Documents');

    try {
        withAppHome(homeDir);
        fs.mkdirSync(documentsDir);
        const result = await callHandler('get-resume-manifest', createAuthorizedEvent(), { outputDir: documentsDir });
        assert.deepEqual(result, { success: false, error: 'Output directory is a restricted system folder.' });
    } finally {
        cleanupTmp([homeDir]);
    }
});

test('get-resume-manifest rejects unapproved output directory', async () => {
    const result = await callHandler('get-resume-manifest', createAuthorizedEvent(), { outputDir: '/tmp/dateback-unapproved-manifest' });
    assert.deepEqual(result, { success: false, error: 'Output directory not approved' });
});

test('get-resume-manifest returns null manifest when no files exist', async () => {
    const result = await callHandler('get-resume-manifest', createAuthorizedEvent(), { outputDir: '/home/test/Pictures/SnapchatMemories' });
    assert.deepEqual(result, { success: true, manifest: null });
});

test('get-resume-manifest ignores parent fallback manifest owned by a different output root', async () => {
    const parentDir = mkTmpDirReal('dateback-parent-manifest-mismatch-');
    const outputDir = path.join(parentDir, 'owned-output');
    const siblingOutputDir = path.join(parentDir, 'sibling-output');
    fs.mkdirSync(outputDir);
    fs.mkdirSync(siblingOutputDir);
    fs.writeFileSync(
        path.join(parentDir, '.batch_progress.json'),
        JSON.stringify({ output_dir: siblingOutputDir, processed_count: 9 }),
        'utf8'
    );

    try {
        await approveFolderSelection(outputDir);
        const result = await callHandler('get-resume-manifest', createAuthorizedEvent(), { outputDir });
        assert.deepEqual(result, { success: true, manifest: null });
    } finally {
        cleanupTmp([parentDir]);
    }
});

test('get-resume-manifest accepts parent fallback manifest only when it is owned by the selected output root', async () => {
    const parentDir = mkTmpDirReal('dateback-parent-manifest-owned-');
    const outputDir = path.join(parentDir, 'owned-output');
    fs.mkdirSync(outputDir);
    const parentManifest = {
        output_dir: outputDir,
        processed_count: 12,
        processed_indices: [0, 1, 2]
    };
    fs.writeFileSync(
        path.join(parentDir, '.batch_progress.json'),
        JSON.stringify(parentManifest),
        'utf8'
    );

    try {
        await approveFolderSelection(outputDir);
        const result = await callHandler('get-resume-manifest', createAuthorizedEvent(), { outputDir });
        assert.equal(result.success, true);
        assert.deepEqual(result.manifest, parentManifest);
        assert.equal(result.legacy, false);
        assert.equal(result.zipMatch, undefined);
    } finally {
        cleanupTmp([parentDir]);
    }
});

test('get-resume-manifest returns zipMatch true for matching primary and companion ZIP fingerprint', async () => {
    const tmpRoot = mkTmpDirReal('dateback-manifest-zip-set-match-');
    const outputDir = path.join(tmpRoot, 'output');
    const primaryZip = path.join(tmpRoot, 'mydata~1234.zip');
    const companionZip = path.join(tmpRoot, 'mydata~1234-2.zip');
    fs.mkdirSync(outputDir);
    writeFileWithMtime(primaryZip, 'primary-zip', 1700000001);
    writeFileWithMtime(companionZip, 'companion-zip', 1700000002);
    const manifest = {
        output_dir: outputDir,
        processed_count: 2,
        zip_fingerprint: zipSetFingerprint([primaryZip, companionZip])
    };
    fs.writeFileSync(path.join(outputDir, '.batch_progress.json'), JSON.stringify(manifest), 'utf8');

    try {
        await approveFolderSelection(outputDir);
        const result = await callHandler('get-resume-manifest', createAuthorizedEvent(), { outputDir, zipPath: primaryZip });
        assert.equal(result.success, true);
        assert.deepEqual(result.manifest, manifest);
        assert.equal(result.zipMatch, true);
    } finally {
        cleanupTmp([tmpRoot]);
    }
});

test('get-resume-manifest returns zipMatch false when a companion ZIP changes', async () => {
    const tmpRoot = mkTmpDirReal('dateback-manifest-zip-set-changed-');
    const outputDir = path.join(tmpRoot, 'output');
    const primaryZip = path.join(tmpRoot, 'mydata~1234.zip');
    const companionZip = path.join(tmpRoot, 'mydata~1234-2.zip');
    fs.mkdirSync(outputDir);
    writeFileWithMtime(primaryZip, 'primary-zip', 1700000001);
    writeFileWithMtime(companionZip, 'companion-zip', 1700000002);
    const manifest = {
        output_dir: outputDir,
        processed_count: 2,
        zip_fingerprint: zipSetFingerprint([primaryZip, companionZip])
    };
    fs.writeFileSync(path.join(outputDir, '.batch_progress.json'), JSON.stringify(manifest), 'utf8');
    writeFileWithMtime(companionZip, 'changed-companion-zip', 1700000002);

    try {
        await approveFolderSelection(outputDir);
        const result = await callHandler('get-resume-manifest', createAuthorizedEvent(), { outputDir, zipPath: primaryZip });
        assert.equal(result.success, true);
        assert.equal(result.zipMatch, false);
    } finally {
        cleanupTmp([tmpRoot]);
    }
});

test('get-resume-manifest returns zipMatch false when a companion ZIP is missing', async () => {
    const tmpRoot = mkTmpDirReal('dateback-manifest-zip-set-missing-');
    const outputDir = path.join(tmpRoot, 'output');
    const primaryZip = path.join(tmpRoot, 'mydata~1234.zip');
    const companionZip = path.join(tmpRoot, 'mydata~1234-2.zip');
    fs.mkdirSync(outputDir);
    writeFileWithMtime(primaryZip, 'primary-zip', 1700000001);
    writeFileWithMtime(companionZip, 'companion-zip', 1700000002);
    const manifest = {
        output_dir: outputDir,
        processed_count: 2,
        zip_fingerprint: zipSetFingerprint([primaryZip, companionZip])
    };
    fs.writeFileSync(path.join(outputDir, '.batch_progress.json'), JSON.stringify(manifest), 'utf8');
    fs.unlinkSync(companionZip);

    try {
        await approveFolderSelection(outputDir);
        const result = await callHandler('get-resume-manifest', createAuthorizedEvent(), { outputDir, zipPath: primaryZip });
        assert.equal(result.success, true);
        assert.equal(result.zipMatch, false);
    } finally {
        cleanupTmp([tmpRoot]);
    }
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

test('clear-output-folder removes cloud runtime state and keeps unowned parent manifests', async () => {
    const parentDir = mkTmpDirReal('dateback-clear-output-');
    const outputDir = path.join(parentDir, 'owned-output');
    const otherOutputDir = path.join(parentDir, 'other-output');
    fs.mkdirSync(outputDir);
    fs.mkdirSync(otherOutputDir);

    const processedDir = path.join(outputDir, 'Processed_Memories_2026-03-18');
    const stagingDir = path.join(outputDir, '.staging');
    fs.mkdirSync(path.join(processedDir, 'Batch_01'), { recursive: true });
    fs.mkdirSync(path.join(stagingDir, 'Batch_01'), { recursive: true });
    fs.writeFileSync(path.join(processedDir, 'Batch_01', 'a.jpg'), 'x');
    fs.writeFileSync(path.join(stagingDir, 'Batch_01', 'queued.jpg'), 'x');
    fs.writeFileSync(path.join(outputDir, '.upload_ledger.jsonl'), '{"line":1}\n');
    fs.writeFileSync(path.join(outputDir, '.batch_progress.json'), JSON.stringify({ processed_count: 3 }), 'utf8');
    fs.writeFileSync(
        path.join(parentDir, '.batch_progress'),
        JSON.stringify({ output_dir: outputDir, processed_count: 3 }),
        'utf8'
    );
    fs.writeFileSync(
        path.join(parentDir, '.batch_progress.json'),
        JSON.stringify({ output_dir: otherOutputDir, processed_count: 4 }),
        'utf8'
    );

    try {
        await approveFolderSelection(outputDir);
        const result = await callHandler('clear-output-folder', createAuthorizedEvent(), { outputDir });
        assert.deepEqual(result, { success: true });
        assert.equal(fs.existsSync(processedDir), false);
        assert.equal(fs.existsSync(stagingDir), false);
        assert.equal(fs.existsSync(path.join(outputDir, '.upload_ledger.jsonl')), false);
        assert.equal(fs.existsSync(path.join(outputDir, '.batch_progress.json')), false);
        assert.equal(fs.existsSync(path.join(parentDir, '.batch_progress')), false);
        assert.equal(fs.existsSync(path.join(parentDir, '.batch_progress.json')), true);
    } finally {
        cleanupTmp([parentDir]);
    }
});

test('clear-output-folder returns explicit nested symlink error without unlinking the directory', async (t) => {
    const outputDir = mkTmpDirReal('dateback-clear-output-symlink-');
    const processedDir = path.join(outputDir, 'Processed_Memories_2026-03-18');
    const nestedDir = path.join(processedDir, 'Batch_01');
    const outsideTarget = mkTmpDirReal('dateback-clear-output-symlink-target-');
    const symlinkPath = path.join(nestedDir, 'linked-dir');

    fs.mkdirSync(nestedDir, { recursive: true });

    try {
        const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
        fs.symlinkSync(outsideTarget, symlinkPath, symlinkType);
    } catch (error) {
        cleanupTmp([outputDir, outsideTarget]);
        t.skip(`symlink creation not permitted in this environment: ${error.message}`);
        return;
    }

    try {
        await approveFolderSelection(outputDir);
        const result = await callHandler('clear-output-folder', createAuthorizedEvent(), { outputDir });
        assert.equal(result.success, false);
        assert.match(result.error, /symbolic link/);
        assert.ok(result.error.includes(symlinkPath), `expected error to mention symlink path, saw ${result.error}`);
        assert.equal(fs.existsSync(processedDir), true);
    } finally {
        cleanupTmp([outputDir, outsideTarget]);
    }
});

test('start-processing cleanup only targets the tracked worker pid from the worker state file', async () => {
    const tmpZipPath = mkTmpFile('tracked-worker.zip', 'zip');
    const tmpOutDir = mkTmpDirReal('dateback-tracked-worker-out-');
    const tmpUserDataDir = mkTmpDirReal('dateback-tracked-worker-userdata-');
    const workerStatePath = path.join(tmpUserDataDir, 'organizer-worker-state.json');
    const trackedCliPath = '/Users/test/DateBack_App_Source/python/cli.py';
    const spawnSyncCalls = [];
    const processKillCalls = [];
    const spawnCalls = [];

    fs.writeFileSync(workerStatePath, JSON.stringify({
        pid: 4242,
        verificationTokens: [trackedCliPath]
    }), 'utf8');

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
        buildOrganizerArgsForStart: () => ['--tracked-worker'],
        resolveOrganizerCommand: () => ({
            command: 'python3',
            args: [trackedCliPath, '--tracked-worker'],
            ffmpegPath: '/ffmpeg'
        }),
        getWorkerStateFilePath: () => workerStatePath,
        spawnSync: (command, args) => {
            spawnSyncCalls.push({ command, args });
            if (command === 'ps') {
                return {
                    status: 0,
                    stdout: `python3 ${trackedCliPath} --zip old.zip\n`,
                    stderr: '',
                    error: null
                };
            }
            if (command === 'pkill') {
                assert.deepEqual(args, ['-TERM', '-P', '4242']);
                return { status: 0, stdout: '', stderr: '', error: null };
            }
            assert.fail(`Unexpected spawnSync call: ${command} ${JSON.stringify(args)}`);
        },
        processKill: (pid, signal) => {
            processKillCalls.push({ pid, signal });
        },
        spawn: (command, args, options) => {
            const proc = fakeSpawnProc();
            proc.pid = command === 'caffeinate' ? 7001 : 5252;
            spawnCalls.push({ command, args, options, proc });
            return proc;
        }
    });

    try {
        const promise = callHandler('start-processing', {}, {
            zipPath: tmpZipPath,
            outputDir: tmpOutDir,
            pauseBetweenBatches: false,
            resumeMode: 'skip',
            autoUpload: false
        });
        await new Promise((resolve) => setImmediate(resolve));

        const organizerCall = spawnCalls.find((call) => call.command === 'python3');
        assert.ok(organizerCall, `expected organizer spawn call, saw ${JSON.stringify(spawnCalls.map(({ command, args }) => ({ command, args })))}`);
        organizerCall.proc.emit('close', 0);

        const result = await promise;
        assert.deepEqual(result, { success: true });
        assert.deepEqual(processKillCalls, [{ pid: 4242, signal: 'SIGTERM' }]);
        assert.ok(!spawnSyncCalls.some((call) => call.command === 'pkill' && call.args[0] === '-x'));
        assert.ok(!spawnSyncCalls.some((call) => call.command === 'taskkill'));
        assert.equal(fs.existsSync(workerStatePath), false);
    } finally {
        cleanupTmp([tmpZipPath, tmpOutDir, tmpUserDataDir]);
    }
});

test('start-processing cleanup ignores tracked worker state when only a generic interpreter command matches', async () => {
    const tmpZipPath = mkTmpFile('tracked-worker-generic.zip', 'zip');
    const tmpOutDir = mkTmpDirReal('dateback-tracked-worker-generic-out-');
    const tmpUserDataDir = mkTmpDirReal('dateback-tracked-worker-generic-userdata-');
    const workerStatePath = path.join(tmpUserDataDir, 'organizer-worker-state.json');
    const trackedCliPath = '/Users/test/DateBack_App_Source/python/cli.py';
    const spawnSyncCalls = [];
    const processKillCalls = [];
    const spawnCalls = [];

    fs.writeFileSync(workerStatePath, JSON.stringify({
        pid: 4343,
        verificationTokens: ['python3', trackedCliPath]
    }), 'utf8');

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
        buildOrganizerArgsForStart: () => ['--tracked-worker-generic'],
        resolveOrganizerCommand: () => ({
            command: 'python3',
            args: [trackedCliPath, '--tracked-worker-generic'],
            ffmpegPath: '/ffmpeg'
        }),
        getWorkerStateFilePath: () => workerStatePath,
        spawnSync: (command, args) => {
            spawnSyncCalls.push({ command, args });
            if (command === 'ps') {
                return {
                    status: 0,
                    stdout: 'python3 /tmp/unrelated.py\n',
                    stderr: '',
                    error: null
                };
            }
            assert.fail(`Unexpected spawnSync call: ${command} ${JSON.stringify(args)}`);
        },
        processKill: (pid, signal) => {
            processKillCalls.push({ pid, signal });
        },
        spawn: (command, args, options) => {
            const proc = fakeSpawnProc();
            proc.pid = command === 'caffeinate' ? 7002 : 5353;
            spawnCalls.push({ command, args, options, proc });
            return proc;
        }
    });

    try {
        const promise = callHandler('start-processing', {}, {
            zipPath: tmpZipPath,
            outputDir: tmpOutDir,
            pauseBetweenBatches: false,
            resumeMode: 'skip',
            autoUpload: false
        });
        await new Promise((resolve) => setImmediate(resolve));

        const organizerCall = spawnCalls.find((call) => call.command === 'python3');
        assert.ok(organizerCall, `expected organizer spawn call, saw ${JSON.stringify(spawnCalls.map(({ command, args }) => ({ command, args })))}`);
        organizerCall.proc.emit('close', 0);

        const result = await promise;
        assert.deepEqual(result, { success: true });
        assert.deepEqual(processKillCalls, []);
        assert.ok(!spawnSyncCalls.some((call) => call.command === 'pkill'));
        assert.equal(fs.existsSync(workerStatePath), false);
    } finally {
        cleanupTmp([tmpZipPath, tmpOutDir, tmpUserDataDir]);
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

test('open-url blocks unapproved http hosts', async () => {
    const result = await callHandler('open-url', createAuthorizedEvent(), 'https://example.com/');
    assert.deepEqual(result, { success: false, error: 'URL host is not allowed' });
});

test('open-url allows configured DateBack and workflow hosts only', async () => {
    const allowedUrls = [
        'https://dateback.app/#export-guide',
        'https://accounts.snapchat.com/v2/download-my-data',
        'https://photos.google.com/'
    ];

    for (const targetUrl of allowedUrls) {
        const result = await callHandler('open-url', createAuthorizedEvent(), targetUrl);
        assert.deepEqual(result, { success: true });
    }

    const shellCalls = getShellCalls();
    assert.deepEqual(shellCalls.openExternal, allowedUrls);
});

test('open-url blocks GitHub hosts from renderer IPC', async () => {
    const blockedUrls = [
        'https://github.com/FFmpeg/FFmpeg'
    ];

    for (const targetUrl of blockedUrls) {
        const result = await callHandler('open-url', createAuthorizedEvent(), targetUrl);
        assert.deepEqual(result, { success: false, error: 'URL host is not allowed' });
    }

    const shellCalls = getShellCalls();
    assert.deepEqual(shellCalls.openExternal, []);
});

test('open-external rejects unauthorized sender', async () => {
    await expectUnauthorized('open-external', 'https://example.com', { success: false, error: 'Unauthorized sender' });
});

test('open-external blocks disallowed protocol', async () => {
    const result = await callHandler('open-external', createAuthorizedEvent(), 'file:///tmp/test');
    assert.deepEqual(result, { success: false, error: 'Protocol file: is not allowed' });
});

test('open-external happy path opens external url and returns success shape', async () => {
    const targetUrl = 'https://dateback.app/';
    const result = await callHandler('open-external', createAuthorizedEvent(), targetUrl);
    assert.deepEqual(result, { success: true });

    const shellCalls = getShellCalls();
    assert.deepEqual(shellCalls.openExternal, [targetUrl]);
});

test('open-external allows support mailto only', async () => {
    const result = await callHandler('open-external', createAuthorizedEvent(), 'mailto:support@dateback.app?subject=Help&body=Diagnostic%20details');
    assert.deepEqual(result, { success: true });

    const blocked = await callHandler('open-external', createAuthorizedEvent(), 'mailto:attacker@example.com');
    assert.deepEqual(blocked, { success: false, error: 'Email recipient is not allowed' });
    const blockedBcc = await callHandler('open-external', createAuthorizedEvent(), 'mailto:support@dateback.app?bcc=attacker@example.com');
    assert.deepEqual(blockedBcc, { success: false, error: 'Email query parameter is not allowed' });
    const blockedTo = await callHandler('open-external', createAuthorizedEvent(), 'mailto:support@dateback.app?to=attacker@example.com');
    assert.deepEqual(blockedTo, { success: false, error: 'Email query parameter is not allowed' });

    const shellCalls = getShellCalls();
    assert.deepEqual(shellCalls.openExternal, ['mailto:support@dateback.app?subject=Help&body=Diagnostic%20details']);
});

test('free build does not register license activation IPC handlers', () => {
    assert.equal(handlers.has('validate-license'), false);
    assert.equal(handlers.has('get-license-status'), false);
    assert.equal(handlers.has('clear-license'), false);
});
