const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const helpers = require(path.resolve(__dirname, '..', 'src', 'renderer.helpers.js'));

test('mode resolution: manual (computer) only', () => {
    const mode = helpers.resolveStorageMode({ computerChecked: true, cloudChecked: false });
    assert.equal(mode, 'COMPUTER');

    const flags = helpers.resolveRunModeFlags({
        storageMode: mode,
        pauseAfterBatchChecked: true,
        isResume: false,
        resumeMode: 'verify'
    });
    assert.deepEqual(flags, {
        autoUpload: false,
        pauseBetweenBatches: true,
        shouldSendResumeMode: false,
        resumeModeToSend: undefined
    });

    const visibility = helpers.computeModeVisibilityState({
        mode,
        isProcessing: false,
        pauseAfterBatchChecked: true,
        advancedOpen: false,
        diskUsageMode: 'automatic'
    });
    assert.equal(visibility.computerEnabled, true);
    assert.equal(visibility.cloudEnabled, false);
    assert.equal(visibility.pauseAfterBatchDisabled, false);
    assert.equal(visibility.showCloudDestinationSection, false);
});

test('mode resolution: auto upload (cloud) only', () => {
    const mode = helpers.resolveStorageMode({ computerChecked: false, cloudChecked: true });
    assert.equal(mode, 'CLOUD');

    const flags = helpers.resolveRunModeFlags({
        storageMode: mode,
        pauseAfterBatchChecked: true,
        isResume: false,
        resumeMode: 'verify'
    });
    assert.deepEqual(flags, {
        autoUpload: true,
        pauseBetweenBatches: false,
        shouldSendResumeMode: false,
        resumeModeToSend: undefined
    });

    const visibility = helpers.computeModeVisibilityState({
        mode,
        isProcessing: false,
        pauseAfterBatchChecked: false,
        advancedOpen: true,
        diskUsageMode: 'automatic'
    });
    assert.equal(visibility.showCloudDestinationSection, true);
    assert.equal(visibility.showAutoUploadSettings, true);
    assert.equal(visibility.showCacheAutoHint, true);
    assert.equal(visibility.showManualCacheSettings, false);
});

test('mode resolution: resume flags are preserved', () => {
    const flags = helpers.resolveRunModeFlags({
        storageMode: 'COMPUTER',
        pauseAfterBatchChecked: false,
        isResume: true,
        resumeMode: 'trust'
    });
    assert.deepEqual(flags, {
        autoUpload: false,
        pauseBetweenBatches: false,
        shouldSendResumeMode: true,
        resumeModeToSend: 'trust'
    });
});

test('pause-after-batch rules: computer mode and not processing keeps checkbox enabled/checked', () => {
    const state = helpers.computePauseAfterBatchState({
        computerEnabled: true,
        isProcessing: false,
        pauseAfterBatchChecked: true
    });
    assert.deepEqual(state, {
        pauseAfterBatchDisabled: false,
        shouldUncheckPauseAfterBatch: false
    });
});

test('pause-after-batch rules: non-computer mode disables and requests uncheck', () => {
    const state = helpers.computePauseAfterBatchState({
        computerEnabled: false,
        isProcessing: false,
        pauseAfterBatchChecked: true
    });
    assert.deepEqual(state, {
        pauseAfterBatchDisabled: true,
        shouldUncheckPauseAfterBatch: true
    });
});

test('visibility toggles: processing running vs stopped', () => {
    const running = helpers.computeModeVisibilityState({
        mode: 'NONE',
        isProcessing: true,
        pauseAfterBatchChecked: false,
        advancedOpen: false,
        diskUsageMode: 'automatic'
    });
    const stopped = helpers.computeModeVisibilityState({
        mode: 'NONE',
        isProcessing: false,
        pauseAfterBatchChecked: false,
        advancedOpen: false,
        diskUsageMode: 'automatic'
    });

    assert.equal(running.disableComputerModeCheckbox, true);
    assert.equal(running.disableCloudModeCheckbox, true);
    assert.equal(stopped.disableComputerModeCheckbox, false);
    assert.equal(stopped.disableCloudModeCheckbox, false);
    assert.equal(running.shouldHideCloudDestinationError, true);
    assert.equal(stopped.shouldHideCloudDestinationError, true);
});

test('storage estimates: cloud estimate uses auto preflight values', () => {
    const estimate = helpers.computeStorageEstimates({
        mode: 'CLOUD',
        count: 123,
        pauseAfterBatchChecked: false,
        avgFileBytes: 8 * 1024 * 1024,
        formatBytes: (bytes) => `${bytes} bytes`,
        autoUploadEstimate: {
            estimateKind: 'AUTO_PREFLIGHT',
            requiredBytes: 12345,
            availableBytes: 67890,
            autoCacheGb: 5,
            autoSafetyBufferGb: 10
        }
    });
    assert.deepEqual(estimate, {
        estimateKind: 'AUTO_PREFLIGHT',
        requiredBytes: 12345,
        requiredText: '12345 bytes',
        availableBytes: 67890,
        autoCacheGb: 5,
        autoSafetyBufferGb: 10
    });
});

test('storage warning: cloud low-space generates cloud warning html', () => {
    const warning = helpers.computeStorageWarningState({
        isAutoUploadMode: true,
        isPauseAfterBatchMode: false,
        requiredBytes: 30,
        availableBytes: 10,
        autoCacheGb: 5,
        autoSafetyBufferGb: 10,
        roundOneDecimal: (value) => Math.round(value * 10) / 10,
        gib: 1024 * 1024 * 1024
    });
    assert.equal(warning.showWarning, true);
    assert.equal(warning.isCriticallyLow, true);
    assert.ok(warning.warningHtml.includes('Store on Cloud needs temporary cache + buffer'));
});

test('success modal copy: cloud mode with delivery stats sets cloud headline/subtext', () => {
    const summary = helpers.buildSuccessModalCopy({
        auto_upload: true,
        success: 100,
        duplicates: 2,
        errors: 0,
        images: 50,
        videos: 50,
        upload_confirmed_in_destination: 100,
        upload_copied_this_run: 90
    });
    assert.equal(summary.headline, 'Cloud Processing Complete!');
    assert.equal(summary.subtext, 'Processing and cloud delivery completed.');
    assert.equal(summary.alreadyInDestination, 10);
});

test('success modal rows: non-cloud includes skipped row and duplicate note', () => {
    const stats = {
        auto_upload: false,
        success: 12,
        duplicates: 3,
        errors: 1,
        images: 6,
        videos: 6
    };
    const summary = helpers.buildSuccessModalCopy(stats);
    const rows = helpers.buildSuccessModalRows(stats, summary);
    const labels = rows.filter((item) => item.type === 'row').map((item) => item.label);
    assert.ok(labels.includes('Already Existed (Skipped):'));
    const notes = rows.filter((item) => item.type === 'note').map((item) => item.text);
    assert.ok(notes.includes('ℹ️ Skipped 3 files that already exist in the destination folder.'));
});

test('processing ui state: running locks controls and shows stop', () => {
    const state = helpers.computeProcessingUiState({ isProcessing: true, stoppedByUser: false });
    assert.equal(state.btnBrowseOutputDisabled, true);
    assert.equal(state.computerModeDisabled, true);
    assert.equal(state.showStopButton, true);
    assert.equal(state.hideResumeRestartContainer, true);
});

test('processing ui state: stopped without user stop unlocks controls and hides stop', () => {
    const state = helpers.computeProcessingUiState({ isProcessing: false, stoppedByUser: false });
    assert.equal(state.btnBrowseOutputDisabled, false);
    assert.equal(state.computerModeDisabled, false);
    assert.equal(state.showStopButton, false);
    assert.equal(state.hideResumeRestartContainer, false);
});

test('renderer fallback visibility helper references isProcessing consistently', () => {
    const rendererSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer.js'), 'utf8');
    assert.equal(rendererSource.includes('isProcessing: processing'), false);
    assert.ok(rendererSource.includes('pauseAfterBatchDisabled: !computerEnabled || isProcessing'));
    assert.ok(rendererSource.includes('disableComputerModeCheckbox: isProcessing'));
    assert.ok(rendererSource.includes('disableCloudModeCheckbox: isProcessing'));
});
