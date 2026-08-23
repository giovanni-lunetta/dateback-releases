// DOM Elements
const zipPathInput = document.getElementById('zip-path');
const outputPathInput = document.getElementById('output-path');
const dropZone = document.getElementById('drop-zone');
const fileSelected = document.getElementById('file-selected');
const fileName = document.getElementById('file-name');
const btnClearFile = document.getElementById('btn-clear-file');
const btnBrowseOutput = document.getElementById('btn-browse-output');
const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const btnToggleLog = document.getElementById('btn-toggle-log');
const btnViewSummary = document.getElementById('btn-view-summary');
const btnOpenFolder = document.getElementById('btn-open-folder');
const modeStepLabel = document.getElementById('mode-step-label');
const workingFolderSection = document.getElementById('working-folder-section');
const workingFolderLabel = document.getElementById('working-folder-label');
const ctaHelper = document.getElementById('cta-helper');
const progressSection = document.querySelector('.progress-section');
const progressBar = document.getElementById('progress-fill').parentElement; // The progress-bar container
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const progressTextContent = document.getElementById('progress-text-content');
const progressEta = document.getElementById('progress-eta');
const logContainer = document.getElementById('log-container');
const logOutput = document.getElementById('log-output');

// ZIP Validation elements
const zipValidation = document.getElementById('zip-validation');
const validationStatus = document.getElementById('validation-status');
const btnValidationHelp = document.getElementById('btn-validation-help');

// Storage Check elements
const storageCheckSection = document.getElementById('storage-check');
const storageCheckLabel = document.getElementById('storage-check-label');
const storageAvailable = document.getElementById('storage-available');
const storageRequired = document.getElementById('storage-required');
const storageRequiredTitle = document.getElementById('storage-required-title');
const storageWarning = document.getElementById('storage-warning');
const storageCount = document.getElementById('storage-count');

// Modals
const instructionsModal = document.getElementById('instructions-modal');
const successModal = document.getElementById('success-modal');
const btnOpenSnapchat = document.getElementById('btn-open-snapchat');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCloseSuccess = document.getElementById('btn-close-success');
const btnRetryCorrupted = document.getElementById('btn-retry-corrupted');
const btnOpenStagingFolder = document.getElementById('btn-open-staging-folder');
const statsContainer = document.getElementById('stats-container');
const dontShowAgainCheckbox = document.getElementById('dont-show-again');
const btnShowInstructions = document.getElementById('btn-show-instructions');

const computerModeCheckbox = document.getElementById('pause-between-batches');
const cloudModeCheckbox = document.getElementById('auto-upload');
const computerModeCard = document.getElementById('computer-card');
const cloudModeCard = document.getElementById('cloud-card');
const pauseAfterBatchCheckbox = document.getElementById('pause-after-batch');
const computerModeSettings = document.getElementById('computer-suboptions') || document.getElementById('computer-mode-settings');
const cloudDestinationSection = document.getElementById('cloud-destination-section');
const autoUploadSettings = document.getElementById('auto-upload-settings');
const cloudDestinationLabel = document.getElementById('cloud-destination-label');
const cloudDestinationLead = document.getElementById('cloud-destination-lead');
const destinationPathInput = document.getElementById('destination-path');
const btnBrowseDestination = document.getElementById('btn-browse-destination');
const syncFolderWarning = document.getElementById('sync-folder-warning');
const cloudDestinationError = document.getElementById('cloud-destination-error');
const workingFolderHelp = document.getElementById('working-folder-help');
const cacheGbInput = document.getElementById('cache-gb');
const cacheLowGbInput = document.getElementById('cache-low-gb');
const diskUsageAutoRadio = document.getElementById('disk-usage-auto');
const diskUsageManualRadio = document.getElementById('disk-usage-manual');
const autoUploadAdvancedDetails = document.getElementById('auto-upload-advanced');
const temporaryStorageHelp = document.getElementById('temporary-storage-help');
const cacheLowSpaceWarning = document.getElementById('cache-low-space-warning');
const manualCacheSettings = document.getElementById('manual-cache-settings');
const cloudWorkingRootDisplay = document.getElementById('cloud-working-root-display');
const btnBrowseCloudWorkingRoot = document.getElementById('btn-browse-cloud-working-root');
const uploadModeSelect = document.getElementById('upload-mode');
const stagingPathInput = document.getElementById('staging-path');
const btnBrowseStaging = document.getElementById('btn-browse-staging');
const computerModeDescription = document.getElementById('computer-mode-description');
const computerModeDisabledHint = document.getElementById('computer-mode-disabled-hint');
const cloudModeDescription = document.getElementById('cloud-mode-description');
const cloudModeDisabledHint = document.getElementById('cloud-mode-disabled-hint');

// Next Steps Guide elements
const nextStepsModal = document.getElementById('next-steps-modal');
const btnNextStepsGuide = document.getElementById('btn-next-steps-guide');
const btnCloseNextSteps = document.getElementById('btn-close-next-steps');
const guideTabs = document.querySelectorAll('.guide-tabs .tab');
const tabGoogle = document.getElementById('tab-google');
const tabIcloud = document.getElementById('tab-icloud');
const nextStepsIntro = document.getElementById('next-steps-intro');
const guideLocalStorage = document.getElementById('guide-local-storage');
const guideManualCloudUpload = document.getElementById('guide-manual-cloud-upload');
const guideCloudDelivered = document.getElementById('guide-cloud-delivered');
const cloudDeliveredCopy = document.getElementById('cloud-delivered-copy');
const cloudDeliveredFollowup = document.getElementById('cloud-delivered-followup');
const btnOpenCloudFolderGuide = document.getElementById('btn-open-cloud-folder-guide');
const storageTipTitle = document.getElementById('storage-tip-title');
const storageTipBody = document.getElementById('storage-tip-body');
const btnOpenFolderTip = document.getElementById('btn-open-folder-tip');

// Storage Warning Modal elements
const storageWarningModal = document.getElementById('storage-warning-modal');
const storageWarningTitle = document.getElementById('storage-warning-title');
const storageWarningText = document.getElementById('storage-warning-text');
const storageWarningSubtext = document.getElementById('storage-warning-subtext');
const btnStorageCancel = document.getElementById('btn-storage-cancel');
const btnStorageContinue = document.getElementById('btn-storage-continue');
const messageModal = document.getElementById('message-modal');
const messageModalTitle = document.getElementById('message-modal-title');
const messageModalText = document.getElementById('message-modal-text');
const messageModalSubtext = document.getElementById('message-modal-subtext');
const btnMessageOk = document.getElementById('btn-message-ok');
const expiredLinkModal = document.getElementById('expired-link-modal');
const btnExpiredLinkOk = document.getElementById('btn-expired-link-ok');

// Multi-ZIP Discovery elements
const zipDiscoveryStatus = document.getElementById('zip-discovery-status');
const zipDiscoveryText = document.getElementById('zip-discovery-text');
const multiZipModal = document.getElementById('multi-zip-modal');
const multiZipModalTitle = document.getElementById('multi-zip-modal-title');
const multiZipModalText = document.getElementById('multi-zip-modal-text');
const multiZipModalSubtext = document.getElementById('multi-zip-modal-subtext');
const multiZipModalButtons = document.getElementById('multi-zip-modal-buttons');

// State
let isProcessing = false;
let startProcessingInFlight = false;
let currentOutputDir = '';
let currentMemoryCount = 0;
let hadPartialRun = false;  // Track if user stopped mid-processing
let lastProcessedCount = 0; // Track how many files were processed before stopping
let lastUploadUiUpdateAt = 0;
let runtimeDiskFullState = null;
let isStorageCriticallyLow = false;
let autoCachePreviewRequestId = 0;
let storageSummaryRequestId = 0;
let storageCheckRequestId = 0;
let lastStorageEstimate = null;
let lastStorageEstimateLogAt = 0;
let lastStorageEstimateLogKind = null;
let storageMode = 'NONE';
let zipDiscoveryPromise = null;   // Resolves to discover-zip-set result
let zipDiscoveryResult = null;    // Cached result once resolved
let isZipDiscovering = false;
let zipDiscoveryHandled = false;  // Guard against re-processing on modal re-open

// Cap the visible log at LOG_NODE_CAP messages to prevent unbounded DOM growth on long runs.
const LOG_NODE_CAP = 1000;
function appendToLog(text) {
    logOutput.appendChild(document.createTextNode(text));
    while (logOutput.childNodes.length > LOG_NODE_CAP) {
        logOutput.removeChild(logOutput.firstChild);
    }
    logOutput.scrollTop = logOutput.scrollHeight;
}

// Translate raw Node/Python error strings into user-facing hints.
// Raw messages are always in the log section; this function provides
// the shorter UI hint shown in the progress/status area.
function friendlyErrorHint(rawError) {
    if (!rawError) return 'Open the log for details. If this keeps happening, contact support.';
    const msg = String(rawError);
    if (msg.includes('EACCES') || msg.includes('EPERM') || msg.includes('permission denied')) {
        return 'Permission denied — DateBack couldn\'t write to the output folder. Try choosing a folder inside your home directory.';
    }
    if (msg.includes('Cannot access ZIP file') || msg.includes('ZIP path')) {
        return 'The selected ZIP file could not be found. Please re-select your Snapchat export ZIP.';
    }
    if (msg.includes('ENOENT') || msg.includes('no such file')) {
        return 'A required file or folder was not found. Make sure your output folder still exists.';
    }
    if (msg.includes('ENOSPC') || msg.includes('no space left')) {
        return 'Your disk ran out of space. Free up storage and try again.';
    }
    if (msg.includes('EPIPE') || msg.includes('broken pipe')) {
        return 'The processing pipeline was interrupted. Try resuming or starting fresh.';
    }
    return 'Open the log for details. If this keeps happening, contact support.';
}

function getEffectiveOutputDir() {
    return (outputPathInput && outputPathInput.value.trim()) || currentOutputDir || '';
}

function syncWorkingRootDisplays() {
    const effectiveOutputDir = getEffectiveOutputDir();
    if (outputPathInput && effectiveOutputDir && outputPathInput.value.trim() !== effectiveOutputDir) {
        outputPathInput.value = effectiveOutputDir;
    }
    if (cloudWorkingRootDisplay) {
        cloudWorkingRootDisplay.value = effectiveOutputDir;
    }
}

function setOutputDirState(pathValue) {
    const nextPath = typeof pathValue === 'string' ? pathValue.trim() : '';
    if (outputPathInput) {
        outputPathInput.value = nextPath;
    }
    currentOutputDir = nextPath;
    syncWorkingRootDisplays();
}

async function refreshOutputDirDependentUi() {
    if (currentMemoryCount > 0) {
        await checkStorage(currentMemoryCount);
    }
    updateAutoCachePreview();
    updateStorageSummary();
    updateStartButtonState();
}

const GIB = 1024 * 1024 * 1024;
const AVG_FILE_BYTES = 8 * 1024 * 1024;
const STORAGE_ESTIMATE_LOG_THROTTLE_MS = 500;
const rendererHelpers = globalThis.DateBackRendererHelpers || {};
const resolveStorageModeHelper = rendererHelpers.resolveStorageMode;
const resolveRunModeFlagsHelper = rendererHelpers.resolveRunModeFlags;
const buildStartProcessingArgsHelper = rendererHelpers.buildStartProcessingArgs;
const computeModeVisibilityStateHelper = rendererHelpers.computeModeVisibilityState;
const buildNextStepsGuideStateHelper = rendererHelpers.buildNextStepsGuideState;
const computeStorageEstimatesHelper = rendererHelpers.computeStorageEstimates;
const computeStorageWarningStateHelper = rendererHelpers.computeStorageWarningState;
const computeProcessingUiStateHelper = rendererHelpers.computeProcessingUiState;
const buildSuccessModalCopyHelper = rendererHelpers.buildSuccessModalCopy;
const buildSuccessModalRowsHelper = rendererHelpers.buildSuccessModalRows;

function isDebugStorageEnabled() {
    try {
        return localStorage.getItem('DATEBACK_DEBUG_STORAGE') === '1';
    } catch (e) {
        return false;
    }
}

window.DateBackDebug = window.DateBackDebug || {};
window.DateBackDebug.setStorageDebug = (enabled) => {
    try {
        localStorage.setItem('DATEBACK_DEBUG_STORAGE', enabled ? '1' : '0');
    } catch (e) {
        // Ignore storage access failures in locked-down environments.
    }
    let value = 'unavailable';
    try {
        value = localStorage.getItem('DATEBACK_DEBUG_STORAGE');
    } catch (e) {
        // Keep fallback value.
    }
    console.log('DATEBACK_DEBUG_STORAGE=', value);
};

function roundOneDecimal(value) {
    return Math.round(value * 10) / 10;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function getDiskUsageMode() {
    return diskUsageManualRadio && diskUsageManualRadio.checked ? 'manual' : 'automatic';
}

function syncStorageModeFromControls() {
    const computerChecked = !!(computerModeCheckbox && computerModeCheckbox.checked);
    const cloudChecked = !!(cloudModeCheckbox && cloudModeCheckbox.checked);
    storageMode = resolveStorageModeHelper({ computerChecked, cloudChecked });
    return storageMode;
}

function getStorageMode() {
    return syncStorageModeFromControls();
}

function isCloudModeSelected() {
    return getStorageMode() === 'CLOUD';
}

function isComputerModeSelected() {
    return getStorageMode() === 'COMPUTER';
}

function isPauseAfterBatchEnabled() {
    return isComputerModeSelected() && !!(pauseAfterBatchCheckbox && pauseAfterBatchCheckbox.checked);
}

function getActiveProcessingModeName() {
    const mode = getStorageMode();
    if (mode === 'CLOUD') return 'Store Memories on Cloud';
    if (mode === 'COMPUTER') return isPauseAfterBatchEnabled()
        ? 'Store Memories on Computer (Pause After Batch)'
        : 'Store Memories on Computer';
    return 'No Storage Mode Selected';
}

function updateModeAwareCopy() {
    const mode = getStorageMode();

    if (modeStepLabel) {
        modeStepLabel.textContent = '2. Choose How to Store Your Memories';
    }

    if (workingFolderLabel) {
        workingFolderLabel.textContent = '3. Select Where You Want Your Memories Stored';
    }

    if (cloudDestinationLabel) {
        cloudDestinationLabel.textContent = mode === 'CLOUD'
            ? '3. Select Your Synced Cloud Folder'
            : '5. Cloud Destination Folder';
    }

    if (storageCheckLabel) {
        storageCheckLabel.textContent = '4. Review Storage Readiness';
    }

    if (btnOpenFolder) {
        btnOpenFolder.textContent = mode === 'CLOUD'
            ? 'Open Cloud Folder'
            : 'Open Output Folder';
    }

    updateCloudModeEducation();
}

function updateCloudModeEducation() {
    const mode = getStorageMode();
    const isCloudMode = mode === 'CLOUD';
    const providerInfo = detectCloudProvider(destinationPathInput.value.trim());

    if (cloudDestinationLead) {
        cloudDestinationLead.textContent = providerInfo && providerInfo.displayName
            ? `Choose the ${providerInfo.displayName} folder where finished memories should land.`
            : 'Choose the synced cloud folder where finished memories should land.';
    }

    if (storageRequiredTitle) {
        storageRequiredTitle.textContent = isCloudMode
            ? 'Free Space To Start'
            : 'Est. Required';
    }

    syncWorkingRootDisplays();
}

function configureNextStepsGuide(stats = {}) {
    const guideState = buildNextStepsGuideStateHelper(stats || {});

    if (nextStepsIntro) {
        nextStepsIntro.textContent = guideState.intro;
    }
    if (guideLocalStorage) {
        guideLocalStorage.classList.toggle('hidden', !guideState.showLocalStorageSection);
    }
    if (guideManualCloudUpload) {
        guideManualCloudUpload.classList.toggle('hidden', !guideState.showManualCloudUploadSection);
    }
    if (guideCloudDelivered) {
        guideCloudDelivered.classList.toggle('hidden', !guideState.showCloudDeliveredSection);
    }
    if (cloudDeliveredCopy) {
        cloudDeliveredCopy.textContent = guideState.cloudDeliveredCopy;
    }
    if (cloudDeliveredFollowup) {
        cloudDeliveredFollowup.textContent = guideState.cloudDeliveredFollowup;
    }
    if (btnOpenCloudFolderGuide) {
        btnOpenCloudFolderGuide.textContent = guideState.cloudFolderButtonLabel;
    }
    if (storageTipTitle) {
        storageTipTitle.textContent = guideState.storageTipTitle;
    }
    if (storageTipBody) {
        storageTipBody.textContent = guideState.storageTipText;
    }
    if (btnOpenFolderTip) {
        btnOpenFolderTip.textContent = guideState.storageTipButtonLabel;
    }
}

function getStartButtonHelperText() {
    if (!ctaHelper || btnStart.classList.contains('hidden') || isProcessing) {
        return '';
    }

    const mode = getStorageMode();
    const hasZipPath = !!zipPathInput.value.trim();
    const zipIsValid = zipValidation.classList.contains('valid');
    const hasOutput = !!getEffectiveOutputDir();
    const cloudValidation = validateCloudDestinationForCurrentMode();

    if (!hasZipPath) {
        return 'Choose your downloaded Snapchat ZIP file to continue.';
    }

    if (!zipIsValid) {
        return 'Choose a Snapchat export ZIP that includes the required JSON files.';
    }

    if (!hasOutput) {
        return mode === 'CLOUD'
            ? 'DateBack could not load the default working folder. Choose one in Advanced Cloud Settings.'
            : 'Choose where you want your memories stored.';
    }

    if (mode === 'NONE') {
        return 'Choose where to store your memories to continue.';
    }

    if (mode === 'CLOUD' && !cloudValidation.valid) {
        return cloudValidation.message;
    }

    if (isStorageCriticallyLow) {
        return 'Free up space or choose a different folder before starting.';
    }

    return 'Ready to start.';
}

function updateStartButtonHelper() {
    if (!ctaHelper) {
        return;
    }

    const helperText = getStartButtonHelperText();
    ctaHelper.textContent = helperText;
    ctaHelper.classList.toggle('hidden', !helperText);
    ctaHelper.classList.toggle('is-ready', helperText === 'Ready to start.');
}

function updateStartButtonState() {
    updateModeAwareCopy();

    if (isProcessing) {
        btnStart.disabled = true;
        updateStartButtonHelper();
        return;
    }

    const mode = getStorageMode();
    const hasZip = !!zipPathInput.value && zipValidation.classList.contains('valid');
    const hasOutput = !!getEffectiveOutputDir();
    const hasMode = mode === 'COMPUTER' || mode === 'CLOUD';
    const cloudValidation = validateCloudDestinationForCurrentMode();
    const hasDestination = mode !== 'CLOUD' || cloudValidation.valid;
    btnStart.disabled = !(hasZip && hasOutput && hasMode && hasDestination && !isStorageCriticallyLow);
    updateStartButtonHelper();
}

function setProgressPhase(label, tone = 'idle') {
    const phaseEl = typeof document !== 'undefined' ? document.getElementById('progress-phase') : null;
    if (!phaseEl) {
        return;
    }
    phaseEl.textContent = label;
    phaseEl.className = `progress-phase phase-${tone}${tone === 'idle' ? ' is-hidden' : ''}`;
}

function setProgressStatusVisibility(visible) {
    if (progressText) {
        progressText.classList.toggle('is-hidden', !visible);
    }
    if (progressEta) {
        progressEta.classList.toggle('is-hidden', !visible && !progressEta.textContent);
        if (visible) {
            progressEta.classList.remove('is-hidden');
        }
    }
}

function setLogToggleState({ attention = false } = {}) {
    if (!btnToggleLog) {
        return;
    }
    const textSpan = btnToggleLog.querySelector('span');
    if (textSpan) {
        textSpan.textContent = logContainer.classList.contains('hidden') ? 'View Log' : 'Hide Log';
    }
    btnToggleLog.classList.toggle('expanded', !logContainer.classList.contains('hidden'));
    btnToggleLog.classList.toggle('needs-attention', attention);
}

function clearRecoveryUi() {
    if (progressSection) {
        progressSection.classList.remove('needs-attention');
    }
    setLogToggleState({ attention: false });
}

function revealRecoveryUi(hint = '') {
    if (progressSection) {
        progressSection.classList.add('needs-attention');
    }
    if (typeof setProgressStatusVisibility === 'function') {
        setProgressStatusVisibility(true);
    }
    if (logContainer.classList.contains('hidden')) {
        logContainer.classList.remove('hidden');
    }
    if (hint) {
        progressEta.textContent = hint;
    }
    setLogToggleState({ attention: true });
}

function enterNeedsAttentionState({
    message,
    hint = 'Open the log for details. If this keeps happening, contact support.',
    hideStart = false,
    showResumeOptions = false,
    emphasizeRecovery = true,
    tintProgressBar = true
} = {}) {
    if (typeof setProgressPhase === 'function') {
        setProgressPhase('Needs Attention', 'error');
    }
    if (typeof setProgressStatusVisibility === 'function') {
        setProgressStatusVisibility(true);
    }
    if (message) {
        progressTextContent.textContent = message;
    }
    if (tintProgressBar) {
        progressFill.style.background = 'var(--accent-red)';
    }
    if (emphasizeRecovery) {
        revealRecoveryUi(hint);
    } else {
        progressEta.textContent = hint || '';
    }
    if (hideStart) {
        btnStart.classList.add('hidden');
        if (typeof updateStartButtonHelper === 'function') {
            updateStartButtonHelper();
        }
    }
    if (showResumeOptions) {
        resumeRestartContainer.classList.remove('hidden');
    }
}

function buildRuntimeDiskFullHint(details = {}) {
    const scope = typeof details.scope === 'string' ? details.scope : 'processing';
    const pathHint = typeof details.path === 'string' && details.path.trim()
        ? `\n\nAffected location: ${details.path}`
        : '';

    if (scope === 'staging') {
        return `Free up space on the local staging drive, or choose a larger staging folder, then resume or restart this run.${pathHint}`;
    }
    if (scope === 'destination') {
        return `Free up space in the selected cloud destination, then resume or restart this run.${pathHint}`;
    }
    return `Free up space on the working drive, then resume or restart this run.${pathHint}`;
}

function enterRuntimeDiskFullState(details = {}) {
    runtimeDiskFullState = details || {};
    enterNeedsAttentionState({
        message: details.message || 'DateBack stopped because the drive ran out of space.',
        hint: buildRuntimeDiskFullHint(details),
        hideStart: true,
        showResumeOptions: true
    });
    setProgressPhase('Out of Space', 'error');
}

function computeAutoCacheValues(freeBytes) {
    const free = Number.isFinite(freeBytes) ? Math.max(0, freeBytes) : 0;
    const freeGiB = free / GIB;
    if (free < (6 * GIB)) {
        return {
            freeGb: roundOneDecimal(freeGiB),
            reserveGb: roundOneDecimal(Math.max(10, 0.10 * freeGiB)),
            cacheGb: 1,
            cacheLowGb: 0.5,
            lowSpaceWarning: true
        };
    }

    const reserve = Math.max(10 * GIB, 0.10 * free);
    const usable = Math.max(0, free - reserve);
    const raw = 0.25 * usable;
    let cacheGb = roundOneDecimal(clamp(raw / GIB, 2, 20));
    let cacheLowGb = Math.max(1, roundOneDecimal(cacheGb * 0.6));
    if (cacheLowGb >= cacheGb) {
        cacheLowGb = roundOneDecimal(Math.max(0.5, cacheGb - 0.1));
    }
    if (cacheLowGb >= cacheGb) {
        cacheLowGb = roundOneDecimal(Math.max(0.1, cacheGb * 0.5));
    }

    return {
        freeGb: roundOneDecimal(freeGiB),
        reserveGb: roundOneDecimal(reserve / GIB),
        cacheGb,
        cacheLowGb,
        lowSpaceWarning: false
    };
}

function computeSafetyBufferGb(freeGb) {
    return Math.max(10, roundOneDecimal(freeGb * 0.10));
}

function computeAutoUploadPreflight(cacheGb, freeBytes) {
    const freeGb = freeBytes / GIB;
    const safetyBufferGb = computeSafetyBufferGb(freeGb);
    const requiredGb = cacheGb + safetyBufferGb;
    return {
        freeBytes,
        freeGb,
        safetyBufferGb,
        requiredGb,
        requiredBytes: requiredGb * GIB
    };
}

async function evaluateAutoUploadPreflight(outputDir, stagingDir, cacheGbOverride = null) {
    const stagingPathForCheck = stagingDir && stagingDir.trim().length > 0 ? stagingDir.trim() : outputDir;
    if (!stagingPathForCheck) {
        throw new Error('Output or staging folder is required to evaluate storage.');
    }

    const diskInfo = await window.api.getDiskFreeBytes(stagingPathForCheck);
    if (!diskInfo || !diskInfo.success || !Number.isFinite(Number(diskInfo.freeBytes))) {
        throw new Error(diskInfo?.error || 'Unable to read free space for staging volume');
    }
    const freeBytes = Number(diskInfo.freeBytes);

    let cacheGbToUse = cacheGbOverride;
    if (!Number.isFinite(cacheGbToUse)) {
        if (getDiskUsageMode() === 'manual') {
            const manualCacheGb = Number.parseFloat(cacheGbInput.value);
            if (Number.isFinite(manualCacheGb) && manualCacheGb > 0) {
                cacheGbToUse = manualCacheGb;
            }
        } else {
            cacheGbToUse = computeAutoCacheValues(freeBytes).cacheGb;
        }
    }
    if (!Number.isFinite(cacheGbToUse) || cacheGbToUse <= 0) {
        throw new Error('Invalid cache size.');
    }

    const preflight = computeAutoUploadPreflight(cacheGbToUse, freeBytes);
    return {
        ok: freeBytes >= preflight.requiredBytes,
        preflight,
        cacheGb: cacheGbToUse,
        path: stagingPathForCheck,
        volumePath: diskInfo.volumePath || stagingPathForCheck
    };
}

// Helper: Format bytes
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Helper: Show Storage Warning Modal
function showStorageWarningModal(title, text, subtext, allowContinue, options = {}) {
    return new Promise((resolve) => {
        storageWarningTitle.textContent = title;

        // Security: Use safe DOM construction instead of innerHTML for line breaks
        storageWarningText.textContent = ''; // Clear existing content
        const lines = text.split('\n');
        lines.forEach((line, index) => {
            if (index > 0) {
                storageWarningText.appendChild(document.createElement('br'));
            }
            storageWarningText.appendChild(document.createTextNode(line));
        });

        storageWarningSubtext.textContent = subtext || '';

        storageWarningModal.classList.remove('hidden');

        const handleContinue = () => {
            cleanup();
            resolve(true);
        };

        const handleCancel = () => {
            cleanup();
            resolve(false);
        };

        const cleanup = () => {
            storageWarningModal.classList.add('hidden');
            btnStorageContinue.removeEventListener('click', handleContinue);
            btnStorageCancel.removeEventListener('click', handleCancel);
        };

        if (allowContinue) {
            btnStorageContinue.style.display = 'inline-block';
            btnStorageContinue.textContent = options.continueLabel || 'Continue';
            btnStorageCancel.textContent = options.cancelLabel || 'Cancel';
            btnStorageContinue.addEventListener('click', handleContinue);
        } else {
            btnStorageContinue.style.display = 'none';
            btnStorageCancel.textContent = options.cancelLabel || 'OK';
        }

        btnStorageCancel.addEventListener('click', handleCancel);
    });
}

// Helper: Check Storage
async function checkStorage(count) {
    const requestId = ++storageCheckRequestId;
    storageCheckSection.classList.remove('hidden');
    if (storageCount) storageCount.textContent = count.toLocaleString();

    const activeMode = getStorageMode();
    const isAutoUploadMode = activeMode === 'CLOUD';
    const isPauseAfterBatchMode = activeMode === 'COMPUTER' && !!(pauseAfterBatchCheckbox && pauseAfterBatchCheckbox.checked);
    const modeName = getActiveProcessingModeName();

    let autoUploadEstimate = null;

    if (isAutoUploadMode) {
        const outputDir = getEffectiveOutputDir();
        const stagingDir = stagingPathInput.value.trim();
        try {
            const preflightResult = await evaluateAutoUploadPreflight(outputDir, stagingDir);
            if (requestId !== storageCheckRequestId) return;
            // Auto Upload estimate is required FREE SPACE to start (cache + safety buffer),
            // not an output-size estimate.
            autoUploadEstimate = {
                estimateKind: 'AUTO_PREFLIGHT',
                requiredBytes: preflightResult.preflight.requiredBytes,
                availableBytes: preflightResult.preflight.freeBytes,
                autoCacheGb: preflightResult.cacheGb,
                autoSafetyBufferGb: preflightResult.preflight.safetyBufferGb
            };
        } catch (error) {
            if (requestId !== storageCheckRequestId) return;
            // Fallback display if preflight cannot be evaluated yet.
            const fallbackCacheGb = getDiskUsageMode() === 'manual'
                ? Number.parseFloat(cacheGbInput.value) || 5
                : 5;
            const fallbackSafetyBufferGb = 10;
            autoUploadEstimate = {
                estimateKind: 'AUTO_FALLBACK',
                requiredBytes: (fallbackCacheGb + fallbackSafetyBufferGb) * GIB,
                availableBytes: null,
                autoCacheGb: fallbackCacheGb,
                autoSafetyBufferGb: fallbackSafetyBufferGb
            };
        }
    }

    const storageEstimate = computeStorageEstimatesHelper({
        mode: activeMode,
        count,
        pauseAfterBatchChecked: isPauseAfterBatchMode,
        avgFileBytes: AVG_FILE_BYTES,
        formatBytes,
        autoUploadEstimate
    });
    let {
        estimateKind,
        requiredBytes,
        requiredText,
        availableBytes,
        autoCacheGb,
        autoSafetyBufferGb
    } = storageEstimate;

    storageRequired.textContent = requiredText;

    // Get storage status icon element
    const storageStatusIcon = document.getElementById('storage-status-icon');

    isStorageCriticallyLow = false;

    if (!Number.isFinite(availableBytes) && !isAutoUploadMode) {
        // For standard/manual modes, read output-volume free space.
        let pathToCheck = getEffectiveOutputDir();
        if (!pathToCheck) {
            const defaults = await window.api.getDefaults();
            if (requestId !== storageCheckRequestId) return;
            pathToCheck = defaults.outputDir || '.';
        }
        const disk = await window.api.getDiskSpace(pathToCheck);
        if (requestId !== storageCheckRequestId) return;
        if (disk.success) {
            availableBytes = Number(disk.free);
        }
    }

    if (Number.isFinite(availableBytes)) {
        storageAvailable.textContent = formatBytes(availableBytes);

        const storageWarningState = computeStorageWarningStateHelper({
            isAutoUploadMode,
            isPauseAfterBatchMode,
            requiredBytes,
            availableBytes,
            autoCacheGb,
            autoSafetyBufferGb,
            roundOneDecimal,
            gib: GIB
        });
        const {
            isLowSpace,
            showAbsoluteCritical,
            isCriticallyLow,
            showWarning,
            warningHtml
        } = storageWarningState;
        isStorageCriticallyLow = isCriticallyLow;

        // Get the available space stat box
        const availableStatBox = storageAvailable.closest('.stat-box');

        if (showWarning) {
            storageWarning.classList.remove('hidden');
            storageWarning.innerHTML = warningHtml;
            storageAvailable.style.color = 'var(--accent-red)';
            storageStatusIcon.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M10 2L2 17h16L10 2z" fill="var(--accent-red)" stroke="var(--accent-red)" stroke-width="1.5"/>
                    <path d="M10 8v4M10 14h.01" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
            `;
            storageStatusIcon.className = 'status-icon-inline warning';

            // Add low-space styling to the stat box (makes hover red)
            if (availableStatBox) {
                availableStatBox.classList.add('low-space');
                availableStatBox.classList.remove('storage-ok');
            }

            // Add critical styling to the stat box if critically low
            if (isCriticallyLow && availableStatBox) {
                availableStatBox.classList.add('critical');
            }

        } else {
            storageWarning.classList.add('hidden');
            storageAvailable.style.color = 'var(--accent-primary)';
            storageStatusIcon.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="10" cy="10" r="9" fill="var(--accent-primary)" stroke="var(--accent-primary)" stroke-width="1.5"/>
                    <path d="M6 10L9 13L14 7" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            `;
            storageStatusIcon.className = 'status-icon-inline ok';

            // Remove critical/low-space styling and add storage-ok class
            if (availableStatBox) {
                availableStatBox.classList.remove('critical');
                availableStatBox.classList.remove('low-space');
                availableStatBox.classList.add('storage-ok');
            }

            // Re-enable output location change when storage is OK.
            btnBrowseOutput.disabled = false;
        }
    } else {
        isStorageCriticallyLow = false;
        storageAvailable.textContent = 'Unknown';
        storageStatusIcon.textContent = '❓';
        storageStatusIcon.className = 'status-icon-inline';
    }

    lastStorageEstimate = {
        estimateKind,
        modeName,
        requiredBytes,
        availableBytes,
        autoCacheGb,
        autoSafetyBufferGb
    };

    if (isDebugStorageEnabled()) {
        const now = Date.now();
        const shouldLog =
            (now - lastStorageEstimateLogAt) >= STORAGE_ESTIMATE_LOG_THROTTLE_MS ||
            estimateKind !== lastStorageEstimateLogKind;
        if (shouldLog) {
            const requiredGb = Number.isFinite(requiredBytes) ? roundOneDecimal(requiredBytes / GIB) : null;
            const availableGb = Number.isFinite(availableBytes) ? roundOneDecimal(availableBytes / GIB) : null;
            console.log(
                `[STORAGE_ESTIMATE] kind=${estimateKind} mode=${modeName} required_gb=${requiredGb} available_gb=${availableGb} cacheGb=${autoCacheGb ?? 'n/a'} bufferGb=${autoSafetyBufferGb ?? 'n/a'}`
            );
            lastStorageEstimateLogAt = now;
            lastStorageEstimateLogKind = estimateKind;
        }
    }

    updateStartButtonState();
}

async function resolveAutoCacheForStart(outputDir, stagingDir) {
    const volumePath = stagingDir && stagingDir.trim().length > 0
        ? stagingDir.trim()
        : outputDir;
    const diskInfo = await window.api.getDiskFreeBytes(volumePath);
    if (!diskInfo || !diskInfo.success || !Number.isFinite(Number(diskInfo.freeBytes))) {
        const reason = diskInfo && diskInfo.error ? diskInfo.error : 'Unable to read disk free space';
        throw new Error(reason);
    }

    const computed = computeAutoCacheValues(Number(diskInfo.freeBytes));
    return {
        ...computed,
        volumePath: diskInfo.volumePath || volumePath
    };
}

async function updateAutoCachePreview() {
    if (!temporaryStorageHelp && !cacheLowSpaceWarning) {
        return;
    }
    const autoEnabled = isCloudModeSelected();
    const advancedOpen = !!(autoUploadAdvancedDetails && autoUploadAdvancedDetails.open);
    const automaticMode = getDiskUsageMode() === 'automatic';
    const baseTooltip = temporaryStorageHelp ? (temporaryStorageHelp.dataset.baseTooltip || temporaryStorageHelp.dataset.tooltip || temporaryStorageHelp.getAttribute('aria-label') || '') : '';
    if (!autoEnabled || !advancedOpen || !automaticMode) {
        if (temporaryStorageHelp && baseTooltip) {
            temporaryStorageHelp.dataset.tooltip = baseTooltip;
            temporaryStorageHelp.setAttribute('aria-label', baseTooltip);
        }
        return;
    }

    const outputDir = getEffectiveOutputDir();
    if (!outputDir) {
        if (temporaryStorageHelp && baseTooltip) {
            temporaryStorageHelp.dataset.tooltip = baseTooltip;
            temporaryStorageHelp.setAttribute('aria-label', baseTooltip);
        }
        return;
    }

    const stagingDir = stagingPathInput.value.trim();
    const requestId = ++autoCachePreviewRequestId;
    try {
        const autoCache = await resolveAutoCacheForStart(outputDir, stagingDir);
        if (requestId !== autoCachePreviewRequestId) {
            return;
        }
        if (temporaryStorageHelp && baseTooltip) {
            const tooltipText = `${baseTooltip} Current automatic limit: up to ${autoCache.cacheGb} GB.`;
            temporaryStorageHelp.dataset.tooltip = tooltipText;
            temporaryStorageHelp.setAttribute('aria-label', tooltipText);
        }
        if (cacheLowSpaceWarning) {
            cacheLowSpaceWarning.classList.toggle('hidden', !autoCache.lowSpaceWarning);
        }
    } catch (error) {
        if (temporaryStorageHelp && baseTooltip) {
            temporaryStorageHelp.dataset.tooltip = baseTooltip;
            temporaryStorageHelp.setAttribute('aria-label', baseTooltip);
        }
    }
}

async function updateStorageSummary() {
}

function normalizeCloudPath(pathValue) {
    return (pathValue || '').replace(/\\/g, '/');
}

const CLOUD_PROVIDER_DEFINITIONS = [
    {
        providerKey: 'DROPBOX',
        displayName: 'Dropbox',
        featureHint: 'Smart Sync / Online-Only',
        patterns: [
            /^\/Users\/[^/]+\/Dropbox(?:\/|$)/i,
            /^\/Users\/[^/]+\/Library\/CloudStorage\/Dropbox(?:\/|$)/i,
            /^[A-Z]:\/Users\/[^/]+\/Dropbox(?:\/|$)/i
        ]
    },
    {
        providerKey: 'GOOGLE_DRIVE',
        displayName: 'Google Drive',
        featureHint: 'Stream files (saves disk space)',
        patterns: [
            /^\/Users\/[^/]+\/Library\/CloudStorage\/GoogleDrive-[^/]+(?:\/|$)/i,
            /^[A-Z]:\/Users\/[^/]+\/Google Drive(?:\/|$)/i
        ]
    },
    {
        providerKey: 'ONEDRIVE',
        displayName: 'OneDrive',
        featureHint: 'Files On-Demand',
        patterns: [
            /^\/Users\/[^/]+\/OneDrive(?:\/|$)/i,
            /^\/Users\/[^/]+\/Library\/CloudStorage\/OneDrive[^/]*(?:\/|$)/i,
            /^[A-Z]:\/Users\/[^/]+\/OneDrive[^/]*(?:\/|$)/i
        ]
    },
    {
        providerKey: 'ICLOUD',
        displayName: 'iCloud Drive',
        featureHint: 'Optimize Mac Storage',
        patterns: [
            /^\/Users\/[^/]+\/Library\/Mobile Documents\/com~apple~CloudDocs(?:\/|$)/i
        ]
    },
    {
        providerKey: 'BOX',
        displayName: 'Box',
        featureHint: 'Online-only files',
        patterns: [
            /^\/Users\/[^/]+\/Library\/CloudStorage\/Box-Box(?:\/|$)/i,
            /^[A-Z]:\/Users\/[^/]+\/Box(?:\/|$)/i
        ]
    }
];

function detectCloudProvider(pathValue) {
    const normalized = normalizeCloudPath(pathValue);
    if (!normalized) {
        return {
            providerKey: 'UNKNOWN',
            displayName: null,
            featureHint: null
        };
    }

    for (const provider of CLOUD_PROVIDER_DEFINITIONS) {
        if (provider.patterns.some((pattern) => pattern.test(normalized))) {
            return {
                providerKey: provider.providerKey,
                displayName: provider.displayName,
                featureHint: provider.featureHint
            };
        }
    }

    return {
        providerKey: 'UNKNOWN',
        displayName: null,
        featureHint: null
    };
}

function isKnownSyncFolderPath(pathValue) {
    return detectCloudProvider(pathValue).providerKey !== 'UNKNOWN';
}

function isAllowedCloudFolder(pathValue) {
    return isKnownSyncFolderPath(pathValue);
}

function updateCloudHandoffCopy() {
    updateCloudModeEducation();
}

function validateCloudDestinationForCurrentMode() {
    const autoEnabled = isCloudModeSelected();
    const destination = destinationPathInput.value.trim();
    if (!autoEnabled) {
        return { valid: true, providerInfo: detectCloudProvider(destination), message: '' };
    }

    if (!destination) {
        return {
            valid: false,
            providerInfo: detectCloudProvider(destination),
            message: 'Choose a cloud destination folder (iCloud Drive, Google Drive, OneDrive, Dropbox, or Box).'
        };
    }

    const providerInfo = detectCloudProvider(destination);
    if (providerInfo.providerKey === 'UNKNOWN') {
        return {
            valid: false,
            providerInfo,
            message: 'Not a recognized cloud folder. Choose iCloud Drive, Google Drive, OneDrive, Dropbox, or Box.'
        };
    }

    return { valid: true, providerInfo, message: '' };
}

function updateSyncFolderWarning() {
    const validation = validateCloudDestinationForCurrentMode();
    if (cloudDestinationError) {
        if (validation.valid) {
            cloudDestinationError.classList.add('hidden');
        } else {
            cloudDestinationError.textContent = validation.message;
            cloudDestinationError.classList.remove('hidden');
        }
    }

    if (syncFolderWarning) {
        syncFolderWarning.classList.add('hidden');
    }

    return validation.valid;
}

async function chooseStagingFolderAndRefresh() {
    const selected = await window.api.selectFolder('staging');
    if (selected) {
        stagingPathInput.value = selected;
        updateAutoCachePreview();
        updateStorageSummary();
        if (currentMemoryCount > 0) {
            await checkStorage(currentMemoryCount);
        }
    }
    return selected;
}

async function showDiskSpaceBlockingModal(title, text, subtext) {
    const pickStaging = await showStorageWarningModal(
        title,
        text,
        subtext,
        true,
        {
            continueLabel: 'Choose temporary storage folder…',
            cancelLabel: 'Cancel'
        }
    );
    if (!pickStaging) {
        return false;
    }

    const selected = await chooseStagingFolderAndRefresh();
    if (!selected) {
        return false;
    }

    const outputDir = getEffectiveOutputDir();
    if (!outputDir || !isCloudModeSelected()) {
        return true;
    }
    try {
        const check = await evaluateAutoUploadPreflight(outputDir, stagingPathInput.value.trim());
        if (!check.ok) {
            await showStorageWarningModal(
                '⚠️ Still Not Enough Space',
                `Free: ${roundOneDecimal(check.preflight.freeGb)} GB\nRequired: ${roundOneDecimal(check.preflight.requiredGb)} GB (cache ${roundOneDecimal(check.cacheGb)} GB + buffer ${roundOneDecimal(check.preflight.safetyBufferGb)} GB).`,
                'Pick another staging folder or free up more space before starting.',
                false
            );
        }
    } catch (error) {
        await showStorageWarningModal(
            '⚠️ Could Not Verify Staging Space',
            error.message,
            'Pick another staging folder or try again.',
            false
        );
    }
    return true;
}

// Helper: Validate ZIP file
async function validateZipFile(path) {
    // Show loading state?
    const result = await window.api.validateZip(path);
    zipValidation.classList.remove('hidden', 'valid', 'invalid');
    validationStatus.classList.remove('valid', 'invalid');

    if (result.found) {
        zipValidation.classList.add('valid');
        validationStatus.classList.add('valid');
        validationStatus.innerHTML = `
            <svg class="status-icon" width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="10" cy="10" r="9" fill="var(--accent-primary)" stroke="var(--accent-primary)" stroke-width="1.5"/>
                <path d="M6 10L9 13L14 7" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Snapchat export looks valid
        `;
        btnValidationHelp.classList.add('hidden');

        // Memory count and storage check
        if (result.count) {
            currentMemoryCount = result.count; // Store count for later re-checks
            await checkStorage(result.count);
        }
    } else {
        zipValidation.classList.add('invalid');
        validationStatus.classList.add('invalid');
        validationStatus.textContent = '❌ This export is missing the required Snapchat JSON file';
        btnValidationHelp.classList.remove('hidden');
        storageCheckSection.classList.add('hidden');
        isStorageCriticallyLow = false;
    }

    updateStartButtonState();
}

// Helper: Set file path and update UI
async function setFilePath(path, displayLabel) {
    if (!path) return;

    // Validate and check if it's a zip file
    if (!path.toLowerCase().endsWith('.zip')) {
        showMessage(
            'Choose a ZIP file',
            'Select your downloaded Snapchat export ZIP to continue.',
            'DateBack only works with Snapchat export ZIP files.'
        );
        return;
    }

    zipPathInput.value = path;
    fileName.textContent = displayLabel || path.split('/').pop();
    dropZone.classList.add('hidden');
    fileSelected.classList.remove('hidden');

    // Disable Find My Zip button when file is selected
    if (btnFindZip) {
        btnFindZip.disabled = true;
    }

    // Validate zip file
    await validateZipFile(path);
}

// Helper: Clear file selection
function clearFilePath() {
    zipPathInput.value = '';
    fileName.textContent = '';
    dropZone.classList.remove('hidden');
    fileSelected.classList.add('hidden');
    zipValidation.classList.add('hidden');
    validationStatus.textContent = '';
    currentMemoryCount = 0;

    // Re-enable Find My Zip button when file is cleared
    if (btnFindZip) {
        btnFindZip.disabled = false;
    }
    const existingOpenBtn = document.getElementById('btn-open-zip-folder');
    if (existingOpenBtn) existingOpenBtn.remove();
    zipDiscoveryHandled = false;
    zipDiscoveryPromise = null;
    zipDiscoveryResult = null;
    updateStartButtonState();
}

function startZipDiscovery(expand = false, folderPath = null) {
    if (zipDiscoveryPromise) return zipDiscoveryPromise;
    isZipDiscovering = true;
    zipDiscoveryStatus.classList.remove('hidden');
    zipDiscoveryText.textContent = folderPath ? 'Scanning folder for Snapchat ZIP files…' : 'Searching for Snapchat ZIP files…';
    dropZone.classList.add('searching');
    btnFindZip.disabled = true;

    zipDiscoveryPromise = window.api.discoverZipSet(expand, folderPath).then(result => {
        isZipDiscovering = false;
        zipDiscoveryResult = result;
        return result;
    }).catch(err => {
        isZipDiscovering = false;
        zipDiscoveryResult = { success: false, error: err.message };
        return zipDiscoveryResult;
    });
    return zipDiscoveryPromise;
}

async function processZipDiscoveryResult(result, { fromButton = false } = {}) {
    zipDiscoveryStatus.classList.add('hidden');
    dropZone.classList.remove('searching');
    btnFindZip.disabled = false;

    if (!result || !result.success) {
        const subtext = dropZone.querySelector('.drop-subtext');
        if (subtext) {
            subtext.textContent = "We didn't find a Snapchat export in your Downloads folder — drag yours in or try Find My Zip Automatically.";
        }
        if (fromButton) {
            showMessage(
                'No Snapchat ZIPs Found',
                "DateBack couldn't find any Snapchat export ZIP files on your Mac.",
                'Try dragging your mydata~*.zip file directly into the box above, or use Finder to locate it.'
            );
        }
        return;
    }

    if (zipDiscoveryHandled) {
        return;
    }
    zipDiscoveryHandled = true;

    if (result.totalCount === 1) {
        await setFilePath(result.primaryPath);
        return;
    }

    await showMultiZipCountConfirmation(result);
}

function showMultiZipModal(title, text, subtext, buttons) {
    multiZipModalTitle.textContent = title;
    multiZipModalText.textContent = text;
    multiZipModalSubtext.textContent = subtext || '';
    multiZipModalButtons.replaceChildren();
    for (const { label, style, onClick } of buttons) {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.className = `btn ${style}`;
        btn.addEventListener('click', () => {
            multiZipModal.classList.add('hidden');
            onClick();
        });
        multiZipModalButtons.appendChild(btn);
    }
    multiZipModal.classList.remove('hidden');
}

async function showMultiZipCountConfirmation(discoveryResult) {
    const { totalCount, primaryPath, companionPaths, seedFolder, needsOrganizing } = discoveryResult;
    const allPaths = [primaryPath, ...companionPaths];

    return new Promise(resolve => {
        showMultiZipModal(
            'Snapchat ZIPs Found',
            `DateBack found ${totalCount} Snapchat ZIP file${totalCount !== 1 ? 's' : ''} from the same export.`,
            'Is this the correct number you downloaded from Snapchat?',
            [
                {
                    label: "Yes, that's right",
                    style: 'btn-primary',
                    onClick: async () => {
                        await handleZipSetConfirmed(allPaths, primaryPath, seedFolder, needsOrganizing);
                        resolve();
                    }
                },
                {
                    label: 'Retry & Expand Search',
                    style: 'btn-secondary',
                    onClick: async () => {
                        zipDiscoveryPromise = null;
                        zipDiscoveryResult = null;
                        zipDiscoveryHandled = false;
                        isZipDiscovering = true;
                        zipDiscoveryStatus.classList.remove('hidden');
                        zipDiscoveryText.textContent = 'Expanding search across your home folder…';
                        dropZone.classList.add('searching');
                        zipDiscoveryPromise = window.api.discoverZipSet(true).then(r => {
                            isZipDiscovering = false;
                            zipDiscoveryResult = r;
                            return r;
                        });
                        const result = await zipDiscoveryPromise;
                        await processZipDiscoveryResult(result);
                        resolve();
                    }
                },
                {
                    label: 'Go to Home',
                    style: 'btn-secondary',
                    onClick: () => {
                        zipDiscoveryStatus.classList.add('hidden');
                        dropZone.classList.remove('searching');
                        resolve();
                    }
                }
            ]
        );
    });
}

async function handleZipSetConfirmed(allPaths, primaryPath, seedFolder, needsOrganizing) {
    if (!needsOrganizing) {
        const folderName = seedFolder ? seedFolder.split('/').pop() : null;
        const label = allPaths.length > 1 && folderName ? `${allPaths.length} ZIP files · ${folderName}` : null;
        await setFilePath(primaryPath, label);
        updateOpenFolderButton(seedFolder, allPaths.length);
        return;
    }
    await showZipOrganizeConfirmation(allPaths, primaryPath);
}

async function showZipOrganizeConfirmation(allPaths, primaryPath) {
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const folderName = `Snapchat Zip Files ${dateStr}`;

    return new Promise(resolve => {
        showMultiZipModal(
            'Organize ZIP Files',
            `DateBack will move your ${allPaths.length} ZIP file${allPaths.length !== 1 ? 's' : ''} into a folder for you located here: Pictures/SnapchatMemories/${folderName}`,
            `It will be called "${folderName}" and you can view and open it in Finder at any time.`,
            [
                {
                    label: 'Move and Continue',
                    style: 'btn-primary',
                    onClick: async () => {
                        const result = await window.api.organizeZipSet(allPaths, folderName);
                        if (result.success) {
                            await setFilePath(result.primaryPath, `${allPaths.length} ZIP files · ${folderName}`);
                            updateOpenFolderButton(result.folderPath, allPaths.length);
                        } else {
                            showMessage(
                                'Could not move files',
                                'DateBack could not move your ZIP files into the organized folder.',
                                'You can still select your ZIP manually, or try again.'
                            );
                        }
                        resolve();
                    }
                },
                {
                    label: "Skip — I'll manage them myself",
                    style: 'btn-secondary',
                    onClick: async () => {
                        await setFilePath(primaryPath);
                        resolve();
                    }
                }
            ]
        );
    });
}

function updateOpenFolderButton(folderPath, zipCount) {
    const existing = document.getElementById('btn-open-zip-folder');
    if (existing) existing.remove();

    if (!folderPath || zipCount <= 1) return;

    const btn = document.createElement('button');
    btn.id = 'btn-open-zip-folder';
    btn.className = 'btn btn-secondary btn-zip-auto-find';
    btn.textContent = `📂 Open ZIP Folder (${zipCount} files)`;
    btn.addEventListener('click', async () => {
        await window.api.openFolder(folderPath);
    });

    const container = document.getElementById('zip-action-buttons');
    if (container) {
        container.appendChild(btn);
    } else {
        btnFindZip.insertAdjacentElement('afterend', btn);
    }
}

// Initialize
async function init() {
    const defaults = await window.api.getDefaults();
    if (defaults.outputDir) {
        setOutputDirState(defaults.outputDir);
    } else {
        syncWorkingRootDisplays();
    }

    const hasSeenInstructions = localStorage.getItem('hasSeenInstructions');
    if (hasSeenInstructions) {
        startZipDiscovery().then(result => processZipDiscoveryResult(result));
    } else {
        instructionsModal.classList.remove('hidden');
        startZipDiscovery();
    }

    updateAutoUploadUiState();
    updateStartButtonState();
    setProgressPhase('Ready', 'idle');
    if (typeof setProgressStatusVisibility === 'function') {
        setProgressStatusVisibility(false);
    }
    setLogToggleState({ attention: false });
}

// ==========================================
// Drag and Drop
// ==========================================

// Click to browse
dropZone.addEventListener('click', async () => {
    if (isZipDiscovering) return;
    const paths = await window.api.selectZipOrFolder();
    if (!paths || paths.length === 0) return;

    if (paths.length === 1) {
        const p = paths[0];
        if (p.toLowerCase().endsWith('.zip')) {
            await setFilePath(p);
        } else {
            // Selected a folder
            zipDiscoveryHandled = false;
            zipDiscoveryPromise = null;
            zipDiscoveryResult = null;
            const result = await startZipDiscovery(false, p);
            if (!result || !result.success) {
                showMessage('No Snapchat ZIPs found', 'DateBack could not find any Snapchat export ZIP files in that folder.', 'Try selecting a specific mydata~*.zip file instead.');
            } else {
                await processZipDiscoveryResult(result);
            }
        }
    } else {
        // Multiple files selected — discover in the parent folder of the first
        const parentFolder = paths[0].substring(0, paths[0].lastIndexOf('/'));
        zipDiscoveryHandled = false;
        zipDiscoveryPromise = null;
        zipDiscoveryResult = null;
        const result = await startZipDiscovery(false, parentFolder);
        if (!result || !result.success) {
            showMessage('No Snapchat ZIPs found', 'DateBack could not find any Snapchat export ZIP files in that folder.', 'Try selecting a specific mydata~*.zip file instead.');
        } else {
            await processZipDiscoveryResult(result);
        }
    }
});

dropZone.addEventListener('keydown', (e) => {
    const isActivationKey = e.key === 'Enter' || e.key === ' ';
    if (!isActivationKey) return;
    e.preventDefault();
    if (isZipDiscovering) return;
    dropZone.click();
});

// Find My Zip button handler
const btnFindZip = document.getElementById('btn-find-zip');
btnFindZip.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (isZipDiscovering) return;

    zipDiscoveryHandled = false;
    zipDiscoveryPromise = null;
    zipDiscoveryResult = null;

    const result = await startZipDiscovery(true);
    await processZipDiscoveryResult(result, { fromButton: true });
});

// Clear file
btnClearFile.addEventListener('click', (e) => {
    e.stopPropagation();
    clearFilePath();
});

// Drag events
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');
    if (isZipDiscovering) return;

    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    if (files.length > 1) {
        // Multiple files dropped — discover in the parent folder of the first file
        const firstPath = window.api.getPathForFile(files[0]);
        if (!firstPath) return;
        const parentFolder = firstPath.substring(0, firstPath.lastIndexOf('/'));
        zipDiscoveryHandled = false;
        zipDiscoveryPromise = null;
        zipDiscoveryResult = null;
        const result = await startZipDiscovery(false, parentFolder);
        if (!result || !result.success) {
            showMessage('No Snapchat ZIPs found', 'DateBack could not find any Snapchat export ZIP files in that folder.', 'Try dropping a specific mydata~*.zip file instead.');
        } else {
            await processZipDiscoveryResult(result);
        }
        return;
    }

    const file = files[0];
    const filePath = window.api.getPathForFile(file);
    if (!filePath) {
        showMessage('Wrong file type', 'Drop your downloaded Snapchat ZIP file here.', 'DateBack cannot process this file type in this step.');
        return;
    }

    if (file.name.toLowerCase().endsWith('.zip')) {
        await setFilePath(filePath);
    } else {
        // Dropped a folder — scan it for Snapchat ZIPs
        zipDiscoveryHandled = false;
        zipDiscoveryPromise = null;
        zipDiscoveryResult = null;
        const result = await startZipDiscovery(false, filePath);
        if (!result || !result.success) {
            showMessage('No Snapchat ZIPs found', 'DateBack could not find any Snapchat export ZIP files in that folder.', 'Try dropping a specific mydata~*.zip file instead.');
        } else {
            await processZipDiscoveryResult(result);
        }
    }
});

// Prevent default drag behavior on window
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

// ==========================================
// Event Listeners
// ==========================================

// Browse Output
btnBrowseOutput.addEventListener('click', async () => {
    const path = await window.api.selectFolder('output');
    if (path) {
        setOutputDirState(path);
        await refreshOutputDirDependentUi();
    }
});

if (btnBrowseCloudWorkingRoot) {
    btnBrowseCloudWorkingRoot.addEventListener('click', async () => {
        const path = await window.api.selectFolder('output');
        if (path) {
            setOutputDirState(path);
            await refreshOutputDirDependentUi();
        }
    });
}

btnBrowseDestination.addEventListener('click', async () => {
    const selected = await window.api.selectFolder('destination');
    if (selected) {
        destinationPathInput.value = selected;
        updateAutoCachePreview();
        updateStorageSummary();
        updateCloudHandoffCopy();
        updateSyncFolderWarning();
        updateStartButtonState();
    }
});

btnBrowseStaging.addEventListener('click', async () => {
    await chooseStagingFolderAndRefresh();
});

const btnResumeProc = document.getElementById('btn-resume-proc');
const btnContinueLater = document.getElementById('btn-continue-later');
const btnRestartProc = document.getElementById('btn-restart-proc');
const resumeRestartContainer = document.getElementById('resume-restart-container');
const resumeModeModal = document.getElementById('resume-mode-modal');
const resumeModeSummary = document.getElementById('resume-mode-summary');
const btnResumeTrust = document.getElementById('btn-resume-trust');
const btnResumeVerify = document.getElementById('btn-resume-verify');
const btnResumeStartFresh = document.getElementById('btn-resume-start-fresh');
const btnResumeCancel = document.getElementById('btn-resume-cancel');

// Track whether we just paused (vs resuming from start screen)
let justPaused = false;

function applyProcessingUiState(uiState) {
    btnBrowseOutput.disabled = uiState.btnBrowseOutputDisabled;
    if (typeof btnBrowseCloudWorkingRoot !== 'undefined' && btnBrowseCloudWorkingRoot) {
        btnBrowseCloudWorkingRoot.disabled = uiState.btnBrowseOutputDisabled;
    }
    computerModeCheckbox.disabled = uiState.computerModeDisabled;
    cloudModeCheckbox.disabled = uiState.cloudModeDisabled;
    if (pauseAfterBatchCheckbox) pauseAfterBatchCheckbox.disabled = uiState.pauseAfterBatchDisabled;
    btnBrowseDestination.disabled = uiState.btnBrowseDestinationDisabled;
    btnBrowseStaging.disabled = uiState.btnBrowseStagingDisabled;
    cacheGbInput.disabled = uiState.cacheGbDisabled;
    cacheLowGbInput.disabled = uiState.cacheLowGbDisabled;
    uploadModeSelect.disabled = uiState.uploadModeDisabled;
    if (diskUsageAutoRadio) diskUsageAutoRadio.disabled = uiState.diskUsageAutoDisabled;
    if (diskUsageManualRadio) diskUsageManualRadio.disabled = uiState.diskUsageManualDisabled;
    if (btnClearFile) btnClearFile.disabled = uiState.btnClearFileDisabled;
    btnStop.classList.toggle('hidden', !uiState.showStopButton);
    if (uiState.hideResumeRestartContainer) {
        resumeRestartContainer.classList.add('hidden');
    }
}

// Main Processing Routine
async function startProcessingRoutine(isResume = false, resumeMode = 'verify') {
    console.log('[START] startProcessingRoutine called - isResume:', isResume, 'resumeMode:', resumeMode, 'isProcessing:', isProcessing);

    if (isProcessing || startProcessingInFlight) {
        console.log('[START] Already processing, returning early');
        return;
    }

    startProcessingInFlight = true;
    try {
    const zipPath = zipPathInput.value;
    const outputDir = getEffectiveOutputDir();
    console.log('[START] zipPath:', zipPath, 'outputDir:', outputDir);

    if (!zipPath) {
        showMessage(
            'Choose your Snapchat ZIP first',
            'Select your downloaded Snapchat export ZIP before starting.',
            'Once the ZIP is selected and validated, DateBack can continue with setup.'
        );
        return;
    }

    const storageMode = getStorageMode();
    const pauseAfterBatchChecked = !!(pauseAfterBatchCheckbox && pauseAfterBatchCheckbox.checked);
    const destinationDir = destinationPathInput.value.trim();
    const stagingDir = stagingPathInput.value.trim();
    const { runModeFlags } = buildStartProcessingArgsHelper({
        storageMode,
        pauseAfterBatchChecked,
        isResume,
        resumeMode,
        zipPath,
        outputDir,
        destinationDir,
        stagingDir,
        uploadMode: undefined,
        resolvedCacheGb: undefined,
        resolvedCacheLowGb: undefined,
        cacheComputation: undefined
    });
    const autoUpload = runModeFlags.autoUpload;
    const pauseBetweenBatches = runModeFlags.pauseBetweenBatches;
    const diskUsageMode = getDiskUsageMode();
    const manualCacheGb = Number.parseFloat(cacheGbInput.value);
    const manualCacheLowGb = Number.parseFloat(cacheLowGbInput.value);
    const uploadMode = uploadModeSelect.value === 'move' ? 'move' : 'copy';
    let resolvedCacheGb;
    let resolvedCacheLowGb;
    let cacheComputation;

    if (storageMode === 'NONE') {
        await showStorageWarningModal(
            '❌ Choose Where to Store Memories',
            'Select either "Store Memories on Computer" or "Store Memories on Cloud" before starting.',
            'To switch modes later, deselect the current option first.',
            false
        );
        return;
    }

    if (storageMode !== 'COMPUTER' && storageMode !== 'CLOUD') {
        await showStorageWarningModal(
            '❌ Invalid Mode Selection',
            'Choose exactly one storage mode before starting.',
            'Select one mode and try again.',
            false
        );
        return;
    }

    if (!outputDir) {
        showMessage(
            'Working folder unavailable',
            storageMode === 'CLOUD'
                ? 'DateBack could not load the default local working folder for Cloud mode.'
                : 'Choose where you want your memories stored before starting.',
            storageMode === 'CLOUD'
                ? 'Open Advanced Cloud Settings and choose a local working folder, then try again.'
                : ''
        );
        return;
    }

    const cloudDestinationValidation = validateCloudDestinationForCurrentMode();
    if (autoUpload && !cloudDestinationValidation.valid) {
        updateSyncFolderWarning();
        await showStorageWarningModal(
            '❌ Cloud Destination Required',
            cloudDestinationValidation.message,
            'Choose a recognized cloud sync folder and try again.',
            false
        );
        return;
    }

    // Connectivity Guard: Warn if offline and using cloud storage folder
    const isOffline = !navigator.onLine;
    const pathForCloudConnectivityCheck = autoUpload ? destinationDir : outputDir;
    const isCloudPath = isAllowedCloudFolder(pathForCloudConnectivityCheck);

    if (isOffline && isCloudPath) {
        const continueAnyway = await showOfflineWarning();
        if (!continueAnyway) {
            return;
        }
    }

    if (autoUpload) {
        if (diskUsageMode === 'manual') {
            if (!Number.isFinite(manualCacheGb) || manualCacheGb <= 0) {
                showMessage(
                    'Check your staging limit',
                    'Staging limit must be greater than 0 GB.',
                    'Enter a larger value or switch back to Automatic.'
                );
                return;
            }
            if (!Number.isFinite(manualCacheLowGb) || manualCacheLowGb < 0 || manualCacheLowGb >= manualCacheGb) {
                showMessage(
                    'Check your safety buffer',
                    'Safety buffer must be lower than the staging limit.',
                    'Lower the safety buffer or raise the staging limit.'
                );
                return;
            }
            resolvedCacheGb = manualCacheGb;
            resolvedCacheLowGb = manualCacheLowGb;
            cacheLowSpaceWarning.classList.add('hidden');
        } else {
            try {
                const autoCache = await resolveAutoCacheForStart(outputDir, stagingDir);
                resolvedCacheGb = autoCache.cacheGb;
                resolvedCacheLowGb = autoCache.cacheLowGb;
                cacheComputation = {
                    mode: 'automatic',
                    freeGb: autoCache.freeGb,
                    reserveGb: autoCache.reserveGb,
                    volumePath: autoCache.volumePath
                };
                cacheLowSpaceWarning.classList.toggle('hidden', !autoCache.lowSpaceWarning);
            } catch (e) {
                await showStorageWarningModal(
                    '❌ Cannot Start Auto Upload',
                    `Could not compute automatic cache size.\n\n${e.message}`,
                    'Choose a valid output/staging folder and try again.',
                    false
                );
                return;
            }
        }

        try {
            const stagingPathForCheck = stagingDir || outputDir;
            const diskInfo = await window.api.getDiskFreeBytes(stagingPathForCheck);
            if (!diskInfo || !diskInfo.success || !Number.isFinite(Number(diskInfo.freeBytes))) {
                throw new Error(diskInfo?.error || 'Unable to read free space for staging volume');
            }
            const freeBytes = Number(diskInfo.freeBytes);
            const preflight = computeAutoUploadPreflight(resolvedCacheGb, freeBytes);
            if (freeBytes < preflight.requiredBytes) {
                await showDiskSpaceBlockingModal(
                    '❌ Cannot Start Auto Upload',
                    `Insufficient space on staging volume.\n\nFree: ${roundOneDecimal(preflight.freeGb)} GB\nRequired: ${roundOneDecimal(preflight.requiredGb)} GB (cache ${roundOneDecimal(resolvedCacheGb)} GB + buffer ${roundOneDecimal(preflight.safetyBufferGb)} GB).`,
                    'Free up space or choose an external staging folder.'
                );
                return;
            }
        } catch (e) {
            await showDiskSpaceBlockingModal(
                '❌ Cannot Start Auto Upload',
                `Could not verify staging disk space.\n\n${e.message}`,
                'Free up space or choose an external staging folder.'
            );
            return;
        }
    } else {
        // Legacy hard block for non-auto-upload mode based on output volume.
        const disk = await window.api.getDiskSpace(outputDir);
        const absoluteMinimum = 5 * 1024 * 1024 * 1024; // 5GB
        if (disk.success && disk.free < absoluteMinimum) {
            await showStorageWarningModal(
                '❌ Cannot Start Processing',
                `You only have ${formatBytes(disk.free)} free.`,
                'DateBack requires at least 5GB of free space to process files safely.\n\nPlease free up space and try again.',
                false
            );
            return;
        }
    }

    // Check for storage warning (soft warning, allows continuation)
    if (!storageWarning.classList.contains('hidden')) {
        const estimate = lastStorageEstimate;
        const estimatedRequiredGb = estimate && Number.isFinite(estimate.requiredBytes)
            ? roundOneDecimal(estimate.requiredBytes / GIB)
            : null;
        const estimatedCacheGb = estimate && Number.isFinite(estimate.autoCacheGb)
            ? roundOneDecimal(estimate.autoCacheGb)
            : null;
        const estimatedBufferGb = estimate && Number.isFinite(estimate.autoSafetyBufferGb)
            ? roundOneDecimal(estimate.autoSafetyBufferGb)
            : null;
        const warningMsg = storageMode === 'COMPUTER' && pauseBetweenBatches
            ? "Pause-after-batch is enabled, but storage is still tight.\n\nMove or delete finished batch folders before continuing if space stays tight."
            : storageMode === 'CLOUD'
                ? `Store on Cloud is enabled, but storage is still tight.\n\nThis mode requires temporary cache + safety buffer${estimatedRequiredGb !== null ? ` (~${estimatedRequiredGb} GB)` : ''}${estimatedCacheGb !== null && estimatedBufferGb !== null ? ` (${estimatedCacheGb} GB + ${estimatedBufferGb} GB)` : ''}.\nKeep your sync app running and ensure the destination remains available.`
                : "Store on Computer is selected and storage is tight.\n\nChoose a larger working drive, or use Store on Cloud.";

        const shouldContinue = await showStorageWarningModal(
            '⚠️ Storage Warning',
            warningMsg,
            'Continue anyway?',
            true // Allow continue
        );

        if (!shouldContinue) {
            return;
        }
    }

    // Check battery status before processing
    try {
        const batteryStatus = await window.api.checkBatteryStatus();
        if (batteryStatus.success && batteryStatus.onBattery) {
            // Show battery warning modal and wait for user decision
            const shouldContinue = await showBatteryWarning();
            if (!shouldContinue) {
                return; // User cancelled
            }
        }
    } catch (e) {
        console.warn('Battery check failed:', e);
    }

    // Reset ETA tracking
    etaTimestamps = [];
    lastProgressCount = 0;
    lastProgressTime = Date.now();
    lastUploadUiUpdateAt = 0;

    isProcessing = true;
    stoppedByUser = false; // Reset stop flag

    const runningUiState = computeProcessingUiStateHelper({ isProcessing: true, stoppedByUser: false });
    applyProcessingUiState(runningUiState);
    if (typeof clearRecoveryUi === 'function') {
        clearRecoveryUi();
    }

    // UI Updates
    btnStart.classList.add('hidden');
    if (typeof updateStartButtonHelper === 'function') {
        updateStartButtonHelper();
    }
    // Hide restart options while running.
    resumeRestartContainer.classList.add('hidden');

    progressFill.style.background = ''; // Reset any error styling
    progressFill.classList.remove('complete'); // Reset complete state
    progressBar.classList.remove('ready'); // Remove ready pulse

    if (isResume) {
        if (typeof setProgressPhase === 'function') {
            setProgressPhase('Resuming', 'resuming');
        }
        if (typeof setProgressStatusVisibility === 'function') {
            setProgressStatusVisibility(true);
        }
        progressTextContent.textContent = resumeMode === 'trust' ? 'Resuming (Skip Files Already Processed)...' : 'Resuming...';
        progressEta.textContent = 'Picking up from your saved progress.';
    } else {
        progressFill.style.width = '0%';
        if (typeof setProgressPhase === 'function') {
            setProgressPhase('Preparing', 'preparing');
        }
        if (typeof setProgressStatusVisibility === 'function') {
            setProgressStatusVisibility(true);
        }
        progressTextContent.textContent = 'Starting...';
        logOutput.textContent = ''; // Only clear log on fresh start/restart
        progressEta.textContent = '';
    }

    // Get pause between batches preference
    const failStartValidation = (message, showAlert = true) => {
        if (showAlert && message) {
            showMessage('Cannot start processing', message);
        }
        isProcessing = false;
        const idleUiState = computeProcessingUiStateHelper({ isProcessing: false, stoppedByUser: false });
        applyProcessingUiState(idleUiState);
        btnStart.classList.remove('hidden');
        if (typeof updateStartButtonHelper === 'function') {
            updateStartButtonHelper();
        }
        progressTextContent.textContent = 'Ready';
        progressEta.textContent = '';
        if (typeof setProgressPhase === 'function') {
            setProgressPhase('Ready', 'idle');
        }
        if (typeof setProgressStatusVisibility === 'function') {
            setProgressStatusVisibility(false);
        }
        updateAutoUploadUiState();
        updateStartButtonState();
    };

    if (autoUpload) {
        if (!Number.isFinite(resolvedCacheGb) || resolvedCacheGb <= 0) {
            failStartValidation('Cache GB must be greater than 0.');
            return;
        }
        if (!Number.isFinite(resolvedCacheLowGb) || resolvedCacheLowGb < 0 || resolvedCacheLowGb >= resolvedCacheGb) {
            failStartValidation('Cache Low GB must be less than Cache GB.');
            return;
        }
    }

    runtimeDiskFullState = null;

    try {
        const { args } = buildStartProcessingArgsHelper({
            storageMode,
            pauseAfterBatchChecked,
            isResume,
            resumeMode,
            zipPath,
            outputDir,
            destinationDir,
            stagingDir,
            uploadMode,
            resolvedCacheGb,
            resolvedCacheLowGb,
            cacheComputation
        });
        const result = await window.api.startProcessing(args);

        // Only show result if not stopped by user
        if (!stoppedByUser) {
            if (result.success) {
                btnOpenFolder.disabled = false;
                const progressTextContent = document.getElementById('progress-text-content');

                // Check if expired links were detected during processing
                if (expiredLinkAlertShown) {
                    progressTextContent.innerHTML = `
                        <svg class="status-icon" width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="10" cy="10" r="9" fill="var(--accent-red)" stroke="var(--accent-red)" stroke-width="1.5"/>
                            <path d="M10 6V11" stroke="white" stroke-width="2" stroke-linecap="round"/>
                            <circle cx="10" cy="14" r="1" fill="white"/>
                        </svg>
                        Download Links Expired
                    `;
                    progressFill.style.width = '100%';
                    progressFill.style.background = 'var(--accent-red)';
                    resumeRestartContainer.classList.add('hidden');
                    btnStart.classList.add('hidden');
                    if (typeof updateStartButtonHelper === 'function') {
                        updateStartButtonHelper();
                    }
                    document.getElementById('btn-restart-complete').classList.remove('hidden');
                } else {
                    progressTextContent.innerHTML = `
                        <svg class="status-icon" width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="10" cy="10" r="9" fill="var(--accent-primary)" stroke="var(--accent-primary)" stroke-width="1.5"/>
                            <path d="M6 10L9 13L14 7" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                        Complete!
                    `;
                    progressFill.style.width = '100%';
                    progressFill.classList.add('complete'); // Solid green, no animation
                    // Show the Restart button (not Start) after successful completion
                    resumeRestartContainer.classList.add('hidden');
                    btnStart.classList.add('hidden');
                    if (typeof updateStartButtonHelper === 'function') {
                        updateStartButtonHelper();
                    }
                    document.getElementById('btn-restart-complete').classList.remove('hidden');
                }
            } else if (result.errorType === 'MODE_CONFLICT') {
                await showStorageWarningModal(
                    '❌ Invalid Mode Selection',
                    result.message || 'Choose either Store on Cloud or Store on Computer (pause option) - not both.',
                    'Please enable only one storage mode and try again.',
                    false
                );
                cloudModeCheckbox.checked = false;
                computerModeCheckbox.checked = false;
                if (pauseAfterBatchCheckbox) pauseAfterBatchCheckbox.checked = false;
                syncStorageModeFromControls();
                updateAutoUploadUiState();
                if (currentMemoryCount > 0) {
                    await checkStorage(currentMemoryCount);
                }
                failStartValidation('', false);
                return;
            } else if (result.errorType === 'DISK_SPACE') {
                const details = result.details || {};
                const freeGb = Number.isFinite(details.free_gb) ? details.free_gb : null;
                const requiredGb = Number.isFinite(details.required_gb) ? details.required_gb : null;
                const cacheGb = Number.isFinite(details.cache_gb) ? details.cache_gb : null;
                const bufferGb = Number.isFinite(details.safety_buffer_gb) ? details.safety_buffer_gb : null;
                const detailLines = [];
                if (freeGb !== null) detailLines.push(`Free: ${freeGb} GB`);
                if (requiredGb !== null) detailLines.push(`Required: ${requiredGb} GB`);
                if (cacheGb !== null && bufferGb !== null) {
                    detailLines.push(`Cache: ${cacheGb} GB + Buffer: ${bufferGb} GB`);
                }
                await showDiskSpaceBlockingModal(
                    '❌ Cannot Start Auto Upload',
                    `${result.message || 'Insufficient free disk space on staging volume.'}${detailLines.length ? `\n\n${detailLines.join('\n')}` : ''}`,
                    'Free up space or choose an external staging folder.'
                );
                failStartValidation('', false);
                return;
            } else if (result.errorType === 'DISK_FULL') {
                enterRuntimeDiskFullState(result.details || { message: result.message });
                return;
            } else if (result.errorType === 'PATH_VALIDATION') {
                await showStorageWarningModal(
                    '❌ Invalid Folder Setup',
                    result.message || result.error || 'Selected folders are not safe to use.',
                    'Choose different destination/staging folders. Symlink folders are not allowed.',
                    false
                );
                failStartValidation('', false);
                return;
            } else {
                // Error occurred - show Resume/Restart options (not Start)
                enterNeedsAttentionState({
                    message: 'Processing needs attention.',
                    hint: friendlyErrorHint(result.error),
                    hideStart: true,
                    showResumeOptions: true
                });
            }
        }
    } catch (error) {
        if (!stoppedByUser) {
            // Error in try/catch - show Resume/Restart options
            enterNeedsAttentionState({
                message: 'Processing stopped unexpectedly.',
                hint: friendlyErrorHint(error.message),
                hideStart: true,
                showResumeOptions: true
            });
            console.error(error);
        }
    } finally {
        isProcessing = false;
        const stoppedUiState = computeProcessingUiStateHelper({ isProcessing: false, stoppedByUser });
        applyProcessingUiState(stoppedUiState);
        progressText.classList.remove('processing');
        if (typeof progressSection === 'undefined' || !progressSection || !progressSection.classList.contains('needs-attention')) {
            progressBar.classList.add('ready');
        }

        // If stopped by user, controls stay disabled until Restart is clicked.
        updateAutoUploadUiState();

        // Note: We don't blindly show btnStart here anymore, handled in catch/success
        // If stopped by user, btnStart stays hidden and resume buttons show (handled in stop handler)
    }
    } finally {
        startProcessingInFlight = false;
    }
}

function formatResumeDate(timestamp) {
    if (!timestamp) return 'Unknown';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return 'Unknown';

    // Format: "Jan 4, 2026 at 3:45 PM"
    const dateStr = date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    const timeStr = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${dateStr} at ${timeStr}`;
}

function getProcessedCount(manifest) {
    if (typeof manifest.processed_count === 'number') return manifest.processed_count;
    if (Array.isArray(manifest.processed_indices)) return manifest.processed_indices.length;
    return 0;
}

function showResumeModeModal(manifest, zipMatch) {
    const processedCount = getProcessedCount(manifest);
    const totalFiles = typeof manifest.total_files === 'number' ? manifest.total_files : currentMemoryCount;
    const lastRun = formatResumeDate(manifest.timestamp);

    // Populate stats in new layout
    const totalText = totalFiles ? ` / ${totalFiles.toLocaleString()}` : '';
    resumeModeSummary.textContent = '';
    const processedStrong = document.createElement('strong');
    processedStrong.textContent = processedCount.toLocaleString();
    resumeModeSummary.appendChild(processedStrong);
    resumeModeSummary.appendChild(document.createTextNode(`${totalText} files processed`));

    const lastRunElement = document.getElementById('resume-last-run');
    if (lastRunElement) {
        lastRunElement.textContent = `Last run: ${lastRun}`;
    }

    const trustAvailable = processedCount > 0 && zipMatch !== false;
    btnResumeTrust.disabled = !trustAvailable;

    // Add opacity to disabled card
    if (!trustAvailable) {
        btnResumeTrust.style.opacity = '0.5';
        btnResumeTrust.style.cursor = 'not-allowed';
    } else {
        btnResumeTrust.style.opacity = '1';
        btnResumeTrust.style.cursor = 'pointer';
    }

    resumeModeModal.classList.remove('hidden');
}

function closeResumeModeModal() {
    resumeModeModal.classList.add('hidden');
}

// Start Processing (Initial)
btnStart.addEventListener('click', async () => {
    const outputDir = getEffectiveOutputDir();
    const zipPath = zipPathInput.value;
    if (outputDir) {
        try {
            console.log('[Resume Check] Checking for manifest in:', outputDir);
            const result = await window.api.getResumeManifest({ outputDir, zipPath });
            console.log('[Resume Check] Result:', result);
            if (result && result.success && result.manifest) {
                const processedCount = getProcessedCount(result.manifest);
                console.log('[Resume Check] Processed count:', processedCount);
                if (processedCount > 0) {
                    console.log('[Resume Check] Showing resume modal');
                    showResumeModeModal(result.manifest, result.zipMatch);
                    return;
                } else {
                    console.log('[Resume Check] Processed count is 0, skipping modal');
                }
            } else {
                console.log('[Resume Check] No manifest found or error');
            }
        } catch (e) {
            console.warn('Failed to load resume manifest:', e);
            showMessage('Could not check for previous progress', 'Starting a fresh run — your existing output folder was not affected.');
        }
    }
    await startProcessingRoutine(false);
});

// Resume Processing
btnResumeProc.addEventListener('click', async () => {
    const outputDir = getEffectiveOutputDir();
    const zipPath = zipPathInput.value;
    console.log('[Resume Processing] Output dir:', outputDir);
    console.log('[Resume Processing] ZIP path:', zipPath);
    console.log('[Resume Processing] Just paused:', justPaused);

    try {
        const result = await window.api.getResumeManifest({ outputDir, zipPath });
        console.log('[Resume Processing] Manifest result:', result);

        if (result && result.success && result.manifest) {
            const isCloudMode = result.manifest.icloud_mode === true;
            console.log('[Resume Processing] Pause-after-batch mode:', isCloudMode);

            // If just paused and NOT in pause-after-batch mode, skip modal and go to verify
            if (justPaused && !isCloudMode) {
                console.log('[Resume Processing] Non-cloud paused state - skipping modal, using verify');
                justPaused = false; // Reset flag
                await startProcessingRoutine(true, 'verify');
                return;
            }

            // Otherwise show modal (pause-after-batch mode OR from start screen)
            console.log('[Resume Processing] Showing resume modal');
            showResumeModeModal(result.manifest, result.zipMatch);
            return;
        } else {
            console.log('[Resume Processing] No manifest found, starting verify mode');
        }
    } catch (e) {
        console.error('[Resume Processing] Error loading manifest:', e);
        showMessage('Could not load previous progress', 'Starting in verify mode — DateBack will check what\'s already been processed.');
    }
    await startProcessingRoutine(true, 'verify');
});

btnResumeTrust.addEventListener('click', async () => {
    console.log('[Resume Modal] Trust button clicked');
    closeResumeModeModal();
    console.log('[Resume Modal] Starting processing in trust mode');
    await startProcessingRoutine(true, 'trust');
});

btnResumeVerify.addEventListener('click', async () => {
    console.log('[Resume Modal] Verify button clicked');
    closeResumeModeModal();
    console.log('[Resume Modal] Starting processing in verify mode');
    await startProcessingRoutine(true, 'verify');
});

btnResumeStartFresh.addEventListener('click', async () => {
    console.log('[Resume Modal] Start Fresh button clicked');
    closeResumeModeModal();
    const outputDir = getEffectiveOutputDir();
    console.log('[Resume Modal] Clearing output folder:', outputDir);
    if (outputDir) {
        await window.api.clearOutputFolder({ outputDir });
    }
    console.log('[Resume Modal] Starting fresh processing');
    await startProcessingRoutine(false);
});

btnResumeCancel.addEventListener('click', () => {
    closeResumeModeModal();
});

// Continue Later - Show summary and go back to start screen (keep files)
btnContinueLater.addEventListener('click', async () => {
    // Clear paused state flag
    justPaused = false;

    // Fetch manifest to get accurate processed count (same source as Resume modal)
    const outputDir = getEffectiveOutputDir();
    const zipPath = zipPathInput.value;
    let displayCount = lastProcessedCount;

    try {
        const result = await window.api.getResumeManifest({ outputDir, zipPath });
        if (result && result.success && result.manifest && result.manifest.processed_count) {
            displayCount = result.manifest.processed_count;
        }
    } catch (e) {
        console.warn('[Continue Later] Could not fetch manifest, using UI count:', e);
    }

    // Show partial summary if we have progress
    if (hadPartialRun && displayCount > 0) {
        showPartialSummaryModal(displayCount, currentMemoryCount);
        // UI reset will happen when user closes the summary modal
    } else {
        // No progress to show, just reset
        resetUIForNewRun();
    }
});

// Restart Processing (Start Over)
const restartConfirmModal = document.getElementById('restart-confirm-modal');
const btnConfirmRestart = document.getElementById('btn-confirm-restart');
const btnCancelRestart = document.getElementById('btn-cancel-restart');

btnRestartProc.addEventListener('click', () => {
    restartConfirmModal.classList.remove('hidden');
});

// Confirm Restart
btnConfirmRestart.addEventListener('click', async () => {
    restartConfirmModal.classList.add('hidden');

    // Restart = reset UI to show "Start Processing" button
    // Do NOT delete files or manifest here - let the modal handle that choice
    // The user will see Skip/Verify/Start Fresh modal when they click "Start Processing"

    // Reset UI for new run
    resetUIForNewRun();

    // Reset partial run tracking
    hadPartialRun = false;
    lastProcessedCount = 0;
    justPaused = false;  // Clear paused state
});

// Helper function to reset UI for a new run
function resetUIForNewRun() {
    // Reset the UI state
    if (btnRestartComplete) {
        btnRestartComplete.classList.add('hidden');
    }
    btnStart.classList.remove('hidden');
    if (typeof updateStartButtonHelper === 'function') {
        updateStartButtonHelper();
    }
    resumeRestartContainer.classList.add('hidden');

    // Re-enable storage mode controls and output location change on restart
    btnBrowseOutput.disabled = false;
    computerModeCheckbox.disabled = false;
    cloudModeCheckbox.disabled = false;
    if (pauseAfterBatchCheckbox) pauseAfterBatchCheckbox.disabled = false;
    btnBrowseDestination.disabled = false;
    btnBrowseStaging.disabled = false;
    cacheGbInput.disabled = false;
    cacheLowGbInput.disabled = false;
    uploadModeSelect.disabled = false;
    if (diskUsageAutoRadio) diskUsageAutoRadio.disabled = false;
    if (diskUsageManualRadio) diskUsageManualRadio.disabled = false;
    updateAutoUploadUiState();
    updateStartButtonState();

    // Reset progress visuals
    progressFill.style.width = '0%';
    progressFill.style.background = '';
    progressFill.classList.remove('complete'); // Remove complete class
    progressTextContent.textContent = 'Ready';
    progressText.classList.remove('processing');
    progressEta.textContent = '';
    setProgressPhase('Ready', 'idle');
    if (typeof setProgressStatusVisibility === 'function') {
        setProgressStatusVisibility(false);
    }
    clearRecoveryUi();
    logOutput.textContent = '';

    // Reset partial run tracking
    hadPartialRun = false;
    lastProcessedCount = 0;
    stoppedByUser = false; // Reset stop flag
    expiredLinkAlertShown = false;
}

// Cancel Restart
btnCancelRestart.addEventListener('click', () => {
    restartConfirmModal.classList.add('hidden');
});

// Restart button after successful completion (resets UI to start state)
const btnRestartComplete = document.getElementById('btn-restart-complete');
btnRestartComplete.addEventListener('click', () => {
    resetUIForNewRun();
});

// Stop Processing
let stoppedByUser = false;

// Stop Confirmation Modal Elements
const stopConfirmModal = document.getElementById('stop-confirm-modal');
const btnResume = document.getElementById('btn-resume');
const btnConfirmStop = document.getElementById('btn-confirm-stop');

// Pause Processing - Show Confirmation Modal
btnStop.addEventListener('click', async () => {
    if (!isProcessing) return;

    // Ensure mode toggles stay disabled
    computerModeCheckbox.disabled = true;
    cloudModeCheckbox.disabled = true;
    if (pauseAfterBatchCheckbox) pauseAfterBatchCheckbox.disabled = true;

    // Show confirmation modal
    stopConfirmModal.classList.remove('hidden');
});

// Resume (Cancel Stop) - Close modal and continue processing
btnResume.addEventListener('click', () => {
    stopConfirmModal.classList.add('hidden');
    // Keep checkbox disabled since we're still processing
});

// Confirm Stop - Actually stop the processing
btnConfirmStop.addEventListener('click', async () => {
    stopConfirmModal.classList.add('hidden');

    stoppedByUser = true;
    hadPartialRun = true;  // Mark that we had a partial run
    lastProcessedCount = lastProgressCount;  // Save the count before stopping
    justPaused = true;  // Mark that we're in a paused state

    // Hide Cancel button immediately
    btnStop.classList.add('hidden');

    // Show "Stopping..." state immediately
    setProgressPhase('Pausing', 'pausing');
    if (typeof setProgressStatusVisibility === 'function') {
        setProgressStatusVisibility(true);
    }
    progressTextContent.textContent = 'Saving your progress...';
    progressFill.style.background = 'var(--accent-primary)';
    progressEta.textContent = '';

    // Show Resume/Restart options but DISABLED initially
    btnStart.classList.add('hidden');
    if (typeof updateStartButtonHelper === 'function') {
        updateStartButtonHelper();
    }
    resumeRestartContainer.classList.remove('hidden');

    // Disable all buttons while Python is cleaning up
    btnResumeProc.disabled = true;
    btnContinueLater.disabled = true;
    btnRestartProc.disabled = true;

    const result = await window.api.stopProcessing();
    if (result.success) {
        // Python is cleaning up - buttons stay disabled
        setProgressPhase('Pausing', 'pausing');
        progressTextContent.textContent = 'Saving progress safely...';
        progressEta.textContent = 'DateBack is finishing the current cleanup step.';

        // Wait for Python to fully exit (indicated by isProcessing becoming false)
        // This happens in the finally block of startProcessingRoutine
        const checkCleanupComplete = setInterval(() => {
            if (!isProcessing) {
                clearInterval(checkCleanupComplete);

                // Cleanup complete - enable buttons
                btnResumeProc.disabled = false;
                btnContinueLater.disabled = false;
                btnRestartProc.disabled = false;

                setProgressPhase('Paused', 'paused');
                progressTextContent.textContent = 'Paused safely';
                progressEta.textContent = 'Resume when you are ready, or save this run for later.';
                btnOpenFolder.disabled = false;

                // Hide "Start Over" when either storage mode is selected to prevent accidental deletion.
                const modeActive = getStorageMode() !== 'NONE';
                if (modeActive) {
                    btnRestartProc.classList.add('hidden'); // Hide Start Over
                } else {
                    btnRestartProc.classList.remove('hidden'); // Show Start Over
                }

                // Show warning/info log
                appendToLog('\n⚠️ Process paused by user.\n');
            }
        }, 100); // Check every 100ms
    }
});

// Battery Warning Modal
const batteryWarningModal = document.getElementById('battery-warning-modal');
const btnContinueBattery = document.getElementById('btn-continue-battery');
const btnCancelBattery = document.getElementById('btn-cancel-battery');

let batteryWarningResolve = null;

function showBatteryWarning() {
    if (batteryWarningResolve) {
        batteryWarningResolve(false);
        batteryWarningResolve = null;
    }
    return new Promise((resolve) => {
        batteryWarningResolve = resolve;
        batteryWarningModal.classList.remove('hidden');
    });
}

btnContinueBattery.addEventListener('click', () => {
    batteryWarningModal.classList.add('hidden');
    if (batteryWarningResolve) {
        batteryWarningResolve(true);
        batteryWarningResolve = null;
    }
});

btnCancelBattery.addEventListener('click', () => {
    batteryWarningModal.classList.add('hidden');
    if (batteryWarningResolve) {
        batteryWarningResolve(false);
        batteryWarningResolve = null;
    }
});

// Offline Warning Modal
const offlineWarningModal = document.getElementById('offline-warning-modal');
const btnContinueOffline = document.getElementById('btn-continue-offline');
const btnCancelOffline = document.getElementById('btn-cancel-offline');

let offlineWarningResolve = null;

function showOfflineWarning() {
    if (offlineWarningResolve) {
        offlineWarningResolve(false);
        offlineWarningResolve = null;
    }
    return new Promise((resolve) => {
        offlineWarningResolve = resolve;
        offlineWarningModal.classList.remove('hidden');
    });
}

btnContinueOffline.addEventListener('click', () => {
    offlineWarningModal.classList.add('hidden');
    if (offlineWarningResolve) {
        offlineWarningResolve(true);
        offlineWarningResolve = null;
    }
});

btnCancelOffline.addEventListener('click', () => {
    offlineWarningModal.classList.add('hidden');
    if (offlineWarningResolve) {
        offlineWarningResolve(false);
        offlineWarningResolve = null;
    }
});

// Validation Help - explain what to do when JSON is missing
btnValidationHelp.addEventListener('click', () => {
    showMessage(
        'This export is missing required Snapchat data',
        'DateBack needs the JSON file that Snapchat includes when both Memories and JSON export are enabled.',
        'To fix this:\n1. Go back to Snapchat\'s Download My Data page.\n2. Turn on Export your Memories and Export JSON Files.\n3. Request a new export and download the new ZIP.\n\nThis ZIP cannot be processed without that JSON file.'
    );
});

// Toggle Log
btnToggleLog.addEventListener('click', () => {
    logContainer.classList.toggle('hidden');
    setLogToggleState({ attention: btnToggleLog.classList.contains('needs-attention') && logContainer.classList.contains('hidden') });
});

// Batch Pause Modal Elements
const batchPauseModal = document.getElementById('batch-pause-modal');
const batchPauseMessage = document.getElementById('batch-pause-message');
const btnContinueBatch = document.getElementById('btn-continue-batch');
const btnPauseAfterBatch = document.getElementById('btn-pause-after-batch');

// Generic Message Modal
function setModalTextContent(target, text) {
    if (!target) {
        return;
    }
    target.textContent = '';
    const lines = String(text || '').split('\n');
    lines.forEach((line, index) => {
        if (index > 0) {
            target.appendChild(document.createElement('br'));
        }
        target.appendChild(document.createTextNode(line));
    });
}

function showMessage(title, text, subtext = '') {
    messageModalTitle.textContent = title;
    setModalTextContent(messageModalText, text);
    if (messageModalSubtext) {
        if (subtext) {
            setModalTextContent(messageModalSubtext, subtext);
            messageModalSubtext.classList.remove('hidden');
        } else {
            messageModalSubtext.textContent = '';
            messageModalSubtext.classList.add('hidden');
        }
    }
    messageModal.classList.remove('hidden');
}

btnMessageOk.addEventListener('click', () => {
    messageModal.classList.add('hidden');
});

// Track which batch just completed (for Pause After Batch feature)
let lastCompletedBatch = 0;
let lastTotalBatches = 0;

// Batch Pause Handler - called when Python signals a batch is complete
function showBatchPauseModal(batchNum, totalBatches) {
    lastCompletedBatch = batchNum;
    lastTotalBatches = totalBatches;
    batchPauseMessage.textContent = `Batch ${batchNum} of ${totalBatches} is ready. Continue to the next batch or pause for now.`;
    batchPauseModal.classList.remove('hidden');
}

// Continue to Next Batch - sends resume signal to Python
btnContinueBatch.addEventListener('click', async () => {
    console.log('[Pause-After-Batch] Continue Batch button clicked');
    batchPauseModal.classList.add('hidden');
    // Update UI to show we're resuming
    setProgressPhase('Processing', 'processing');
    if (typeof setProgressStatusVisibility === 'function') {
        setProgressStatusVisibility(true);
    }
    progressTextContent.textContent = 'Continuing with the next batch...';
    progressEta.textContent = 'DateBack will resume as soon as the next batch starts.';

    try {
        console.log('[Pause-After-Batch] Calling resumeBatch API');
        const result = await window.api.resumeBatch();
        console.log('[Pause-After-Batch] resumeBatch result:', result);
        if (!result.success) {
            console.error('[Pause-After-Batch] Failed to resume batch:', result.error);
            showMessage(
                'Could not resume processing',
                result.error || 'DateBack could not continue to the next batch.',
                'Please restart DateBack and try again.'
            );
            enterNeedsAttentionState({
                message: 'Could not continue this run.'
            });
        } else {
            console.log('[Pause-After-Batch] Successfully resumed batch');
            // Progress will update automatically when Python sends next progress message
        }
    } catch (err) {
        console.error('[Pause-After-Batch] Error resuming batch:', err);
        showMessage(
            'Could not resume processing',
            err.message || 'DateBack hit an unexpected error while resuming.',
            'Please restart DateBack and try again.'
        );
        enterNeedsAttentionState({
            message: 'Could not continue this run.'
        });
    }
});

// Pause After Batch - User wants to stop and come back later
btnPauseAfterBatch.addEventListener('click', async () => {
    console.log('[Pause-After-Batch] Pause After Batch button clicked');
    batchPauseModal.classList.add('hidden');
    setProgressPhase('Pausing', 'pausing');
    if (typeof setProgressStatusVisibility === 'function') {
        setProgressStatusVisibility(true);
    }
    progressTextContent.textContent = 'Saving your progress...';
    progressEta.textContent = 'DateBack is stopping after this completed batch.';

    try {
        // Set stoppedByUser to prevent completion handler from overriding our pause state
        stoppedByUser = true;

        console.log('[Pause-After-Batch] Stopping processing');

        // Hide Cancel button immediately
        btnStop.classList.add('hidden');

        // Show Resume/Restart options but DISABLED initially (while cleaning up)
        btnStart.classList.add('hidden');
        if (typeof updateStartButtonHelper === 'function') {
            updateStartButtonHelper();
        }
        resumeRestartContainer.classList.remove('hidden');

        // Disable all buttons while Python is cleaning up
        btnResumeProc.disabled = true;
        btnContinueLater.disabled = true;
        btnRestartProc.disabled = true;

        // Stop the Python process (it's waiting for resume signal anyway)
        await window.api.stopProcessing();

        // Set hadPartialRun so user sees summary when they click Continue Later
        hadPartialRun = true;
        // Use the actual progress count from the last update (not batch count)
        lastProcessedCount = lastProgressCount;
        console.log('[Pause-After-Batch] Set hadPartialRun=true, lastProcessedCount=', lastProcessedCount);

        // Update UI to show cleaning up state
        setProgressPhase('Pausing', 'pausing');
        progressTextContent.textContent = 'Saving progress safely...';
        progressEta.textContent = 'DateBack is finishing cleanup before this run can be resumed.';

        // Wait for Python to fully exit (indicated by isProcessing becoming false)
        const checkCleanupComplete = setInterval(() => {
            if (!isProcessing) {
                clearInterval(checkCleanupComplete);

                // Cleanup complete - enable buttons
                btnResumeProc.disabled = false;
                btnContinueLater.disabled = false;
                btnRestartProc.disabled = false;

                setProgressPhase('Paused', 'paused');
                progressTextContent.textContent = 'Paused safely';
                progressEta.textContent = 'Resume when you are ready, or save this run for later.';
                btnOpenFolder.disabled = false;

                // Pause-after-batch UX: Hide "Start Over" button (since this modal is only for pause-after-batch flow)
                btnRestartProc.classList.add('hidden');
                console.log('[Pause-After-Batch] UI updated - showing Resume/Continue Later buttons');
            }
        }, 100); // Check every 100ms

    } catch (err) {
        console.error('Error pausing after batch:', err);
        stoppedByUser = false; // Reset on error
        enterNeedsAttentionState({
            message: 'Could not pause safely.'
        });

        // Re-enable buttons on error
        btnResumeProc.disabled = false;
        btnContinueLater.disabled = false;
        btnRestartProc.disabled = false;
    }
});

// Open output folder (Store on Computer) or cloud destination folder (Store on Cloud).
btnOpenFolder.addEventListener('click', () => {
    const storageMode = getStorageMode();
    const cloudDestinationDir = destinationPathInput.value.trim();
    const outputDir = getEffectiveOutputDir();
    const folderToOpen = storageMode === 'CLOUD' && cloudDestinationDir ? cloudDestinationDir : outputDir;
    if (folderToOpen) {
        window.api.openFolder(folderToOpen);
    }
});

// Open Snapchat URL
btnOpenSnapchat.addEventListener('click', () => {
    window.api.openUrl('https://accounts.snapchat.com/v2/download-my-data');
});

// Close Instructions Modal
btnCloseModal.addEventListener('click', async () => {
    instructionsModal.classList.add('hidden');
    if (dontShowAgainCheckbox.checked) {
        localStorage.setItem('hasSeenInstructions', 'true');
    }
    const result = zipDiscoveryResult || await zipDiscoveryPromise;
    await processZipDiscoveryResult(result);
});

// Show Instructions Button (in header)
btnShowInstructions.addEventListener('click', () => {
    instructionsModal.classList.remove('hidden');
});

// Toggle Instructions Accordion
const btnToggleInstructions = document.getElementById('btn-toggle-instructions');
const instructionsContent = document.getElementById('instructions-content');

if (btnToggleInstructions && instructionsContent) {
    btnToggleInstructions.addEventListener('click', () => {
        btnToggleInstructions.classList.toggle('expanded');
        instructionsContent.classList.toggle('hidden');
    });
}

// Close Success Modal
btnCloseSuccess.addEventListener('click', () => {
    successModal.classList.add('hidden');

    // If we were showing partial summary, reset UI for new run
    if (isShowingPartialSummary) {
        isShowingPartialSummary = false;
        resetUIForNewRun();

        // Restore "What's Next?" button visibility for future modals
        const btnNextSteps = document.getElementById('btn-next-steps-guide');
        if (btnNextSteps) btnNextSteps.classList.remove('hidden');
    }
});

function enforceStorageModeExclusivity(source) {
    const computerEnabled = !!(computerModeCheckbox && computerModeCheckbox.checked);
    const cloudEnabled = !!(cloudModeCheckbox && cloudModeCheckbox.checked);
    if (!computerEnabled || !cloudEnabled) {
        return;
    }

    if (source === 'computer') {
        cloudModeCheckbox.checked = false;
    } else {
        // Default and 'cloud' source: keep cloud on, disable computer mode.
        computerModeCheckbox.checked = false;
    }
    syncStorageModeFromControls();
}

function applyVisibilityState(visibilityState) {
    if (workingFolderSection) {
        workingFolderSection.classList.toggle('hidden', !visibilityState.showWorkingFolderSection);
    }
    if (workingFolderHelp) {
        workingFolderHelp.textContent = visibilityState.workingFolderHelpText;
    }

    if (pauseAfterBatchCheckbox) {
        if (visibilityState.shouldUncheckPauseAfterBatch) {
            pauseAfterBatchCheckbox.checked = false;
        }
        pauseAfterBatchCheckbox.disabled = visibilityState.pauseAfterBatchDisabled;
    }
    if (computerModeSettings) {
        computerModeSettings.classList.toggle('expanded', visibilityState.computerModeSettingsExpanded);
    }

    if (cloudDestinationSection) {
        cloudDestinationSection.classList.toggle('hidden', !visibilityState.showCloudDestinationSection);
    }
    autoUploadSettings.classList.toggle('hidden', !visibilityState.showAutoUploadSettings);
    if (manualCacheSettings) {
        manualCacheSettings.classList.toggle('hidden', !visibilityState.showManualCacheSettings);
    }
    if (visibilityState.shouldHideCacheLowSpaceWarning && cacheLowSpaceWarning) {
        cacheLowSpaceWarning.classList.add('hidden');
    }

    if (computerModeCheckbox) {
        computerModeCheckbox.disabled = visibilityState.disableComputerModeCheckbox;
    }
    if (cloudModeCheckbox) {
        cloudModeCheckbox.disabled = visibilityState.disableCloudModeCheckbox;
    }
    if (computerModeCard && computerModeCheckbox) {
        computerModeCard.classList.toggle('selected', visibilityState.computerCardSelected);
        computerModeCard.classList.toggle('disabled', computerModeCheckbox.disabled);
    }
    if (cloudModeCard && cloudModeCheckbox) {
        cloudModeCard.classList.toggle('selected', visibilityState.cloudCardSelected);
        cloudModeCard.classList.toggle('disabled', cloudModeCheckbox.disabled);
    }

    if (computerModeDescription) {
        computerModeDescription.classList.toggle('hidden', visibilityState.computerModeDescriptionHidden);
    }
    if (computerModeDisabledHint) {
        computerModeDisabledHint.classList.toggle('hidden', visibilityState.computerModeDisabledHintHidden);
    }
    if (cloudModeDescription) {
        cloudModeDescription.classList.toggle('hidden', visibilityState.cloudModeDescriptionHidden);
    }
    if (cloudModeDisabledHint) {
        cloudModeDisabledHint.classList.toggle('hidden', visibilityState.cloudModeDisabledHintHidden);
    }

    if (visibilityState.shouldHideCloudDestinationError && cloudDestinationError) {
        cloudDestinationError.classList.add('hidden');
    }
    if (visibilityState.shouldHideSyncFolderWarning && syncFolderWarning) {
        syncFolderWarning.classList.add('hidden');
    }

    updateAutoCachePreview();
    updateStorageSummary();
    if (visibilityState.shouldRefreshCloudHelpers) {
        updateCloudHandoffCopy();
        updateSyncFolderWarning();
    }
    updateStartButtonState();
}

function buildVisibilityInput() {
    return {
        mode: getStorageMode(),
        isProcessing,
        pauseAfterBatchChecked: !!(pauseAfterBatchCheckbox && pauseAfterBatchCheckbox.checked),
        advancedOpen: !!(autoUploadAdvancedDetails && autoUploadAdvancedDetails.open),
        diskUsageMode: getDiskUsageMode()
    };
}

function updateAutoUploadUiState() {
    const visibilityInput = buildVisibilityInput();
    const visibilityState = computeModeVisibilityStateHelper(visibilityInput);
    applyVisibilityState(visibilityState);
}

function refreshModeDependentUi() {
    syncStorageModeFromControls();
    updateAutoUploadUiState();
    if (currentMemoryCount > 0) {
        void checkStorage(currentMemoryCount);
    }
}

function selectStorageMode(mode) {
    if (!computerModeCheckbox || !cloudModeCheckbox) {
        return;
    }

    const nextComputerChecked = mode === 'computer';
    const nextCloudChecked = mode === 'cloud';

    if (computerModeCheckbox.checked === nextComputerChecked && cloudModeCheckbox.checked === nextCloudChecked) {
        return;
    }

    computerModeCheckbox.checked = nextComputerChecked;
    cloudModeCheckbox.checked = nextCloudChecked;
    refreshModeDependentUi();
}

function bindModeCardSelection(cardEl, checkboxEl, mode, ignoreSelector = null) {
    if (!cardEl || !checkboxEl) {
        return;
    }
    cardEl.addEventListener('click', (e) => {
        if (checkboxEl.disabled) {
            return;
        }
        if (ignoreSelector && e.target.closest(ignoreSelector)) {
            return;
        }
        if (e.target.closest('input, button, select, textarea, a')) {
            return;
        }
        e.preventDefault();
        selectStorageMode(mode);
    });
}

bindModeCardSelection(computerModeCard, computerModeCheckbox, 'computer', '#computer-suboptions');
bindModeCardSelection(cloudModeCard, cloudModeCheckbox, 'cloud');

cloudModeCheckbox.addEventListener('change', () => {
    if (cloudModeCheckbox.disabled) {
        return;
    }
    enforceStorageModeExclusivity('cloud');
    syncStorageModeFromControls();
    updateAutoUploadUiState();
    if (currentMemoryCount > 0) {
        void checkStorage(currentMemoryCount);
    }
});

if (diskUsageAutoRadio) {
    diskUsageAutoRadio.addEventListener('change', () => {
        updateAutoUploadUiState();
    });
}

if (diskUsageManualRadio) {
    diskUsageManualRadio.addEventListener('change', () => {
        updateAutoUploadUiState();
    });
}

if (cacheGbInput) {
    cacheGbInput.addEventListener('input', () => {
        updateStorageSummary();
    });
}

if (cacheLowGbInput) {
    cacheLowGbInput.addEventListener('input', () => {
        updateStorageSummary();
    });
}

if (autoUploadAdvancedDetails) {
    autoUploadAdvancedDetails.addEventListener('toggle', () => {
        updateAutoUploadUiState();
    });
}

computerModeCheckbox.addEventListener('change', () => {
    if (computerModeCheckbox.disabled) {
        return;
    }
    enforceStorageModeExclusivity('computer');
    syncStorageModeFromControls();
    updateAutoUploadUiState();
    if (currentMemoryCount > 0) {
        void checkStorage(currentMemoryCount);
    }
});

if (pauseAfterBatchCheckbox) {
    pauseAfterBatchCheckbox.addEventListener('change', () => {
        updateAutoUploadUiState();
        if (currentMemoryCount > 0) {
            void checkStorage(currentMemoryCount);
        }
    });
}

// Keep initial mode unselected.
if (computerModeCheckbox) computerModeCheckbox.checked = false;
if (cloudModeCheckbox) cloudModeCheckbox.checked = false;
if (pauseAfterBatchCheckbox) pauseAfterBatchCheckbox.checked = false;
syncStorageModeFromControls();
updateAutoUploadUiState();

// Keep support for keyboard toggles on disabled controls (no-op).
computerModeCheckbox.addEventListener('click', (e) => {
    if (computerModeCheckbox.disabled) {
        e.preventDefault();
        return;
    }
    e.preventDefault();
    selectStorageMode('computer');
});

cloudModeCheckbox.addEventListener('click', (e) => {
    if (cloudModeCheckbox.disabled) {
        e.preventDefault();
        return;
    }
    e.preventDefault();
    selectStorageMode('cloud');
});

if (pauseAfterBatchCheckbox) {
    pauseAfterBatchCheckbox.addEventListener('click', (e) => {
        if (pauseAfterBatchCheckbox.disabled) {
            e.preventDefault();
        }
    });
}

// ETA calculation variables
let etaTimestamps = [];
let lastProgressCount = 0;
let lastProgressTime = 0;

// Format time remaining
function formatTimeRemaining(seconds) {
    if (seconds < 60) return `${Math.round(seconds)} sec`;
    if (seconds < 3600) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        return `${mins} min ${secs} sec`;
    }
    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    return `${hours} hr ${mins} min`;
}

// Progress callback from Python
function handleProgressUpdate(data) {
    if (data.type === 'progress') {
        const { count, total } = data;

        // Handle verification phase (Fast Pass check)
        if (count === -1) {
            setProgressPhase('Verifying', 'verifying');
            if (typeof setProgressStatusVisibility === 'function') {
                setProgressStatusVisibility(true);
            }
            progressTextContent.textContent = `Checking files already on disk... (${total.toLocaleString()} to verify)`;
            progressFill.style.width = '0%';
            progressEta.textContent = '';
            // Reset ETA tracking when entering verification
            etaTimestamps = [];
            lastProgressCount = 0;
            lastProgressTime = 0;
            return;
        }

        const percent = (count / total) * 100;
        progressFill.style.width = `${percent}%`;
        setProgressPhase('Processing', 'processing');
        if (typeof setProgressStatusVisibility === 'function') {
            setProgressStatusVisibility(true);
        }
        progressTextContent.textContent = `Organizing memories: ${count.toLocaleString()} / ${total.toLocaleString()}`;
        progressEta.textContent = '';

        // Calculate ETA using rolling window (last 100 items)
        const now = Date.now();
        if (count > lastProgressCount && lastProgressTime > 0) {
            const elapsed = (now - lastProgressTime) / 1000; // seconds
            const itemsProcessed = count - lastProgressCount;
            const timePerItem = elapsed / itemsProcessed;

            // Ignore very fast items (likely cached/skipped) to avoid underestimating
            if (timePerItem > 0.01) {
                // Add to rolling window
                etaTimestamps.push(timePerItem);
                if (etaTimestamps.length > 100) {
                    etaTimestamps.shift();
                }
            }

            // Calculate average time per item (ignore outliers)
            if (etaTimestamps.length > 10) {
                // Sort and remove top/bottom 10% outliers
                const sorted = [...etaTimestamps].sort((a, b) => a - b);
                const trimCount = Math.floor(sorted.length * 0.1);
                const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
                const avgTimePerItem = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;

                const remaining = total - count;
                const etaSeconds = remaining * avgTimePerItem;

                if (etaSeconds > 0 && count > 20) { // Wait for more items before showing ETA
                    progressEta.textContent = `Est. remaining: ${formatTimeRemaining(etaSeconds)}`;
                }
            }
        }

        lastProgressCount = count;
        lastProgressTime = now;

    } else if (data.type === 'batch_pause') {
        // Python is requesting a pause after a completed batch
        setProgressPhase('Paused', 'paused');
        if (typeof setProgressStatusVisibility === 'function') {
            setProgressStatusVisibility(true);
        }
        progressTextContent.textContent = `Batch ${data.batch} is ready.`;
        progressEta.textContent = '';
        // Note: signal file path is now handled by main process, not renderer
        showBatchPauseModal(data.batch, data.totalBatches);

    } else if (data.type === 'upload_progress') {
        const now = Date.now();
        if (now - lastUploadUiUpdateAt < 250) {
            return;
        }
        lastUploadUiUpdateAt = now;
        const stagedCount = Number.isFinite(data.staged_count) ? data.staged_count : 0;
        const stagingBytes = Number.isFinite(data.staging_bytes) ? data.staging_bytes : 0;
        const uploadedCount = Number.isFinite(data.uploaded_count) ? data.uploaded_count : 0;
        setProgressPhase('Uploading', 'uploading');
        if (typeof setProgressStatusVisibility === 'function') {
            setProgressStatusVisibility(true);
        }
        progressTextContent.textContent = 'Copying memories into your cloud folder...';
        progressEta.textContent = `${uploadedCount.toLocaleString()} copied, ${stagedCount.toLocaleString()} waiting in staging (${formatBytes(stagingBytes)})`;

    } else if (data.type === 'auto_pause') {
        const stagingGb = Number.isFinite(data.staging_gb) ? data.staging_gb : 0;
        const cacheGb = Number.isFinite(data.cache_gb) ? data.cache_gb : 0;
        setProgressPhase('Waiting for Space', 'paused');
        if (typeof setProgressStatusVisibility === 'function') {
            setProgressStatusVisibility(true);
        }
        progressTextContent.textContent = 'Cloud sync needs to catch up before DateBack can continue.';
        progressEta.textContent = `Temporary staging reached ${stagingGb} GB of ${cacheGb} GB. Keep your cloud app running, or free space, and DateBack will resume automatically.`;

    } else if (data.type === 'auto_resume') {
        const stagingGb = Number.isFinite(data.staging_gb) ? data.staging_gb : 0;
        const lowGb = Number.isFinite(data.cache_low_gb) ? data.cache_low_gb : 0;
        setProgressPhase('Uploading', 'uploading');
        if (typeof setProgressStatusVisibility === 'function') {
            setProgressStatusVisibility(true);
        }
        progressTextContent.textContent = 'Cloud delivery resumed after space recovered.';
        progressEta.textContent = `Temporary staging dropped to ${stagingGb} GB, below the ${lowGb} GB resume threshold.`;

    } else if (data.type === 'upload_error') {
        const attempt = Number.isFinite(data.attempt) ? data.attempt : 0;
        setProgressPhase('Retrying', 'retrying');
        if (typeof setProgressStatusVisibility === 'function') {
            setProgressStatusVisibility(true);
        }
        progressTextContent.textContent = 'Retrying cloud delivery...';
        progressEta.textContent = `Attempt ${attempt}: ${data.error || 'temporary upload issue'}`;

    } else if (data.type === 'upload_fatal') {
        enterNeedsAttentionState({
            message: 'Cloud delivery needs attention.',
            hint: data.last_error || data.message || 'Open the log for details. If this keeps happening, contact support.'
        });

    } else if (data.type === 'companion_found') {
        const count = data.companion_count || 0;
        appendToLog(`Found ${count} companion ZIP file${count !== 1 ? 's' : ''} — loading all memories…\n`);
        return;

    } else if (data.type === 'disk_full') {
        enterRuntimeDiskFullState(data);

    } else if (data.type === 'complete') {
        setProgressPhase('Complete', 'complete');
        if (typeof setProgressStatusVisibility === 'function') {
            setProgressStatusVisibility(true);
        }
        progressEta.textContent = '';
        etaTimestamps = [];
        lastProgressCount = 0;
        lastProgressTime = 0;
        if (!stoppedByUser) {
            showSuccessModal(data.stats);
        }
    }
}

window.api.onProgressUpdate(handleProgressUpdate);

// Log messages from Python
let expiredLinkAlertShown = false;

window.api.onLogMessage((message) => {
    appendToLog(message + '\n');

    // Detect expired link errors and show alert once
    if (message.includes('LINKS_EXPIRED') && !expiredLinkAlertShown) {
        expiredLinkAlertShown = true;
        setProgressPhase('Needs Attention', 'error');
        setProgressStatusVisibility(true);
        progressTextContent.textContent = 'Snapchat download links expired.';
        progressFill.style.background = 'var(--accent-red)';
        revealRecoveryUi('Request a fresh Snapchat export, then restart processing.');

        // Show custom modal instead of alert
        expiredLinkModal.classList.remove('hidden');

        // Close modal on OK button click
        btnExpiredLinkOk.addEventListener('click', () => {
            expiredLinkModal.classList.add('hidden');
        }, { once: true });
    }
});

// Listen for logs export success (process-lifetime listener; no cleanup needed)
window.api.onLogsExported((data) => {
    openLogsExportModal(data.filename);
});

// Show a non-intrusive banner when an update arrives during a job.
// The banner disappears once the job ends and the main process shows the download dialog.
const updateBanner = document.getElementById('update-banner');
if (window.api.onUpdateAvailable) {
    window.api.onUpdateAvailable(({ version }) => {
        if (updateBanner) {
            const textEl = updateBanner.querySelector('.update-banner-text');
            if (textEl) {
                textEl.textContent = `📦 DateBack ${version} is available — you'll be prompted to install when this job finishes.`;
            }
            updateBanner.classList.remove('hidden');
        }
    });
}

// Show success modal with stats
let lastStats = null;

function showSuccessModal(stats) {
    lastStats = stats; // Store for View Summary button
    if (typeof clearRecoveryUi === 'function') {
        clearRecoveryUi();
    }
    if (typeof setProgressPhase === 'function') {
        setProgressPhase('Complete', 'complete');
    }
    if (typeof setProgressStatusVisibility === 'function') {
        setProgressStatusVisibility(true);
    }
    const summary = buildSuccessModalCopyHelper(stats);
    const {
        isCloudModeStats,
        headline,
        subtext
    } = summary;

    // Update modal headline
    const modalTitle = document.getElementById('success-modal-title');
    if (modalTitle) modalTitle.textContent = headline;

    const subtitleEl = document.getElementById('success-modal-subtitle');
    if (subtitleEl) {
        if (isCloudModeStats) {
            subtitleEl.textContent = '';
            subtitleEl.style.display = 'none';
        } else {
            subtitleEl.textContent = 'Your Snapchat Memories are safely stored.';
            subtitleEl.style.display = 'block';
        }
    }

    // Add subtext if we have one
    const subtextEl = document.getElementById('success-modal-subtext');
    if (subtextEl) {
        subtextEl.textContent = subtext;
        subtextEl.style.display = subtext ? 'block' : 'none';
    }

    const thanksEl = document.getElementById('success-modal-thanks');
    if (thanksEl) {
        thanksEl.textContent = 'Thanks for using DateBack!';
        thanksEl.style.display = 'block';
    }

    // ELEC-004: Safe DOM manipulation instead of innerHTML
    // Clear existing content
    statsContainer.textContent = '';

    // Helper to create a stat row
    function createStatRow(label, value, valueClass = '', isDivider = false) {
        const row = document.createElement('div');
        row.className = 'stat-row' + (isDivider ? ' divider' : '');

        const labelSpan = document.createElement('span');
        labelSpan.className = 'stat-label';
        labelSpan.textContent = label;

        const valueSpan = document.createElement('span');
        valueSpan.className = 'stat-value' + (valueClass ? ' ' + valueClass : '');
        valueSpan.textContent = value;

        row.appendChild(labelSpan);
        row.appendChild(valueSpan);
        return row;
    }

    const rowItems = buildSuccessModalRowsHelper(stats, summary);
    for (const item of rowItems) {
        if (item.type === 'row') {
            statsContainer.appendChild(createStatRow(item.label, item.value, item.valueClass, item.isDivider));
            continue;
        }
        if (item.type === 'note') {
            const noteDiv = document.createElement('div');
            noteDiv.className = `stat-note ${item.noteClass}`;
            if (item.style) {
                if (item.style.marginTop) noteDiv.style.marginTop = item.style.marginTop;
                if (item.style.fontWeight) noteDiv.style.fontWeight = item.style.fontWeight;
            }
            noteDiv.textContent = item.text;
            statsContainer.appendChild(noteDiv);
        }
    }

    configureNextStepsGuide(stats);
    successModal.classList.remove('hidden');
    btnOpenFolder.disabled = false;
    btnViewSummary.classList.remove('hidden'); // Show View Summary button
    if (btnNextStepsGuide) {
        btnNextStepsGuide.classList.remove('hidden');
    }

    if (btnOpenStagingFolder) {
        btnOpenStagingFolder.classList.add('hidden');
        delete btnOpenStagingFolder.dataset.stagingPath;
    }

    // Show retry button if there were errors
    if (stats.errors > 0) {
        btnRetryCorrupted.classList.remove('hidden');
    } else {
        btnRetryCorrupted.classList.add('hidden');
    }
}

// Track if we're showing partial summary (to reset UI on close)
let isShowingPartialSummary = false;

// Show partial summary modal when restarting after stopping
function showPartialSummaryModal(processedCount, totalCount) {
    isShowingPartialSummary = true;

    // Update modal headline
    const modalTitle = document.getElementById('success-modal-title');
    if (modalTitle) modalTitle.textContent = 'Progress Saved';

    const subtitleEl = document.getElementById('success-modal-subtitle');
    if (subtitleEl) {
        subtitleEl.textContent = 'This run is paused, not complete.';
        subtitleEl.style.display = 'block';
    }

    // Update subtext
    const subtextEl = document.getElementById('success-modal-subtext');
    if (subtextEl) {
        subtextEl.textContent = 'Resume anytime to continue with the remaining memories.';
        subtextEl.style.display = 'block';
    }

    const thanksEl = document.getElementById('success-modal-thanks');
    if (thanksEl) {
        thanksEl.style.display = 'none';
    }

    // Clear and populate stats container
    statsContainer.textContent = '';

    // Helper to create a stat row
    function createStatRow(label, value, valueClass = '', isDivider = false) {
        const row = document.createElement('div');
        row.className = 'stat-row' + (isDivider ? ' divider' : '');

        const labelSpan = document.createElement('span');
        labelSpan.className = 'stat-label';
        labelSpan.textContent = label;

        const valueSpan = document.createElement('span');
        valueSpan.className = 'stat-value' + (valueClass ? ' ' + valueClass : '');
        valueSpan.textContent = value;

        row.appendChild(labelSpan);
        row.appendChild(valueSpan);
        return row;
    }

    // Build simple stats for partial run
    statsContainer.appendChild(createStatRow('Files Processed:', processedCount.toLocaleString(), 'green'));
    statsContainer.appendChild(createStatRow('Total in Export:', totalCount.toLocaleString()));

    const remainingCount = totalCount - processedCount;
    if (remainingCount > 0) {
        statsContainer.appendChild(createStatRow('Remaining:', remainingCount.toLocaleString(), 'orange', true));

        // Add note about continuing later
        const noteDiv = document.createElement('div');
        noteDiv.className = 'stat-note info';
        noteDiv.textContent = `ℹ️ Your ${processedCount.toLocaleString()} processed files are saved. Click "Start Processing" anytime to continue from where you left off.`;
        statsContainer.appendChild(noteDiv);
    }

    // Hide "What's Next?" button for partial summary
    const btnNextSteps = document.getElementById('btn-next-steps-guide');
    if (btnNextSteps) btnNextSteps.classList.add('hidden');

    // Hide retry button
    btnRetryCorrupted.classList.add('hidden');
    if (btnOpenStagingFolder) {
        btnOpenStagingFolder.classList.add('hidden');
        delete btnOpenStagingFolder.dataset.stagingPath;
    }

    // Hide View Summary button (doesn't make sense for partial)
    btnViewSummary.classList.add('hidden');

    // Show the modal
    successModal.classList.remove('hidden');
}

// View Summary button - reopen success modal
btnViewSummary.addEventListener('click', () => {
    if (lastStats) {
        showSuccessModal(lastStats);
    }
});

// Retry Corrupted Files button
btnRetryCorrupted.addEventListener('click', async () => {
    successModal.classList.add('hidden');
    btnRetryCorrupted.classList.add('hidden');

    clearRecoveryUi();
    setProgressPhase('Retrying', 'retrying');
    if (typeof setProgressStatusVisibility === 'function') {
        setProgressStatusVisibility(true);
    }
    progressTextContent.textContent = 'Retrying failed files...';
    progressText.classList.add('processing');
    progressFill.style.width = '50%'; // Indeterminate
    progressBar.classList.remove('ready');
    progressEta.textContent = 'DateBack is redownloading regular photo/video failures. Overlay memories may need a fresh full run.';

    try {
        const outputDir = getEffectiveOutputDir();
        const storageMode = getStorageMode();
        const autoUpload = storageMode === 'CLOUD';
        const destinationDir = destinationPathInput.value.trim();
        const stagingDir = stagingPathInput.value.trim();
        const uploadMode = uploadModeSelect.value === 'move' ? 'move' : 'copy';

        let retryCacheGb = Number.parseFloat(cacheGbInput.value);
        let retryCacheLowGb = Number.parseFloat(cacheLowGbInput.value);
        if (autoUpload) {
            if (!destinationDir) {
                setProgressPhase('Needs Attention', 'error');
                progressTextContent.textContent = 'Retry needs a cloud destination folder.';
                progressEta.textContent = 'Choose your cloud destination in Step 3, then try Retry Corrupted Files again.';
                showMessage(
                    'Choose a cloud destination first',
                    'Retrying failed files in Cloud mode requires a cloud destination folder.',
                    'Choose a destination in Step 3, then try Retry Corrupted Files again.'
                );
                return;
            }
            if (getDiskUsageMode() === 'automatic') {
                const autoCache = await resolveAutoCacheForStart(outputDir, stagingDir);
                retryCacheGb = autoCache.cacheGb;
                retryCacheLowGb = autoCache.cacheLowGb;
            }
            if (!Number.isFinite(retryCacheGb) || retryCacheGb <= 0) {
                retryCacheGb = 5.0;
            }
            if (!Number.isFinite(retryCacheLowGb) || retryCacheLowGb < 0 || retryCacheLowGb > retryCacheGb) {
                retryCacheLowGb = Math.max(1, roundOneDecimal(retryCacheGb * 0.6));
                if (retryCacheLowGb >= retryCacheGb) {
                    retryCacheLowGb = Math.max(0, retryCacheGb - 0.1);
                }
            }
        }

        const result = await window.api.retryCorrupted({
            outputDir,
            autoUpload,
            destinationDir: autoUpload ? destinationDir : '',
            cacheGb: autoUpload ? retryCacheGb : undefined,
            cacheLowGb: autoUpload ? retryCacheLowGb : undefined,
            uploadMode: autoUpload ? uploadMode : undefined,
            stagingDir: autoUpload ? stagingDir : '',
            maxUploadRetries: 20
        });

        if (result.success) {
            setProgressPhase('Complete', 'complete');
            progressTextContent.textContent = 'Retry complete.';
            progressEta.textContent = 'DateBack finished reprocessing the files that failed last time.';
            progressFill.style.width = '100%';
            progressFill.classList.add('complete');

            // Show updated stats if available
            if (result.stats) {
                showSuccessModal(result.stats);
            }
        } else {
            enterNeedsAttentionState({
                message: 'Retry could not finish.',
                hint: friendlyErrorHint(result.error)
            });
        }
    } catch (error) {
        enterNeedsAttentionState({
            message: 'Retry stopped unexpectedly.',
            hint: friendlyErrorHint(error.message)
        });
    } finally {
        progressText.classList.remove('processing');
        if (!progressSection || !progressSection.classList.contains('needs-attention')) {
            progressBar.classList.add('ready');
        }
    }
});

// Initialize on load
init();

// Next Steps Guide Modal
btnNextStepsGuide.addEventListener('click', () => {
    successModal.classList.add('hidden');
    nextStepsModal.classList.remove('hidden');
});

btnCloseNextSteps.addEventListener('click', () => {
    nextStepsModal.classList.add('hidden');
});

// Tab switching
guideTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        // Remove active from all tabs
        guideTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        // Show/hide content
        const tabName = tab.dataset.tab;
        if (tabName === 'google') {
            tabGoogle.classList.remove('hidden');
            tabIcloud.classList.add('hidden');
        } else if (tabName === 'icloud') {
            tabIcloud.classList.remove('hidden');
            tabGoogle.classList.add('hidden');
        }
    });
});

// External link handler for allowed HTTP(S) anchors.
document.addEventListener('click', (e) => {
    if (e.defaultPrevented) return;
    const target = e.target;
    if (!target || typeof target.closest !== 'function') return;
    const anchor = target.closest('a[href]');
    if (!anchor) return;

    let url;
    try {
        url = new URL(anchor.getAttribute('href'), window.location.href);
    } catch (_error) {
        return;
    }

    if (url.protocol === 'http:' || url.protocol === 'https:') {
        e.preventDefault();
        window.api.openUrl(url.href);
    }
});

// Folder links in Next Steps modal - open Output Folder
const linkFolderGoogle = document.getElementById('link-folder-google');
const linkFolderGoogle2 = document.getElementById('link-folder-google-2');
const linkFolderIcloud = document.getElementById('link-folder-icloud');

function openProcessedFolder(e) {
    e.preventDefault();
    const outputDir = getEffectiveOutputDir();
    if (outputDir) {
        window.api.openFolder(outputDir);
    }
}

if (linkFolderGoogle) {
    linkFolderGoogle.addEventListener('click', openProcessedFolder);
}
if (linkFolderGoogle2) {
    linkFolderGoogle2.addEventListener('click', openProcessedFolder);
}
if (linkFolderIcloud) {
    linkFolderIcloud.addEventListener('click', openProcessedFolder);
}

if (btnOpenCloudFolderGuide) {
    btnOpenCloudFolderGuide.addEventListener('click', (e) => {
        e.preventDefault();
        const destinationDir = destinationPathInput.value.trim();
        if (destinationDir) {
            window.api.openFolder(destinationDir);
        }
    });
}

// Walkthrough link - open website export guide section
const linkWalkthrough = document.getElementById('link-walkthrough');
if (linkWalkthrough) {
    linkWalkthrough.addEventListener('click', (e) => {
        e.preventDefault();
        window.api.openUrl('https://dateback.app/#export-guide');
    });
}

const BMAC_URL = 'https://www.buymeacoffee.com/giovannilunetta';
const linkCoffee = document.getElementById('link-coffee');
if (linkCoffee) {
    linkCoffee.addEventListener('click', (e) => {
        e.preventDefault();
        window.api.openExternal(BMAC_URL);
    });
}
const linkCoffeeSuccess = document.getElementById('link-coffee-success');
if (linkCoffeeSuccess) {
    linkCoffeeSuccess.addEventListener('click', (e) => {
        e.preventDefault();
        window.api.openExternal(BMAC_URL);
    });
}

// Pro Tip folder button - open working/output folder
if (btnOpenFolderTip) {
    btnOpenFolderTip.addEventListener('click', (e) => {
        e.preventDefault();
        const localWorkingDir = getEffectiveOutputDir();
        if (localWorkingDir) {
            window.api.openFolder(localWorkingDir);
        }
    });
}

// ============================================
// Contact Support Modal
// ============================================

const contactModal = document.getElementById('contact-modal');
const btnContactSupport = document.getElementById('btn-contact-support');
const btnEmailSupport = document.getElementById('btn-email-support');

// Open contact modal
function openContactModal() {
    contactModal.classList.remove('hidden');
}

// Close contact modal
function closeContactModal() {
    contactModal.classList.add('hidden');
}

async function getSupportEmailVersion() {
    try {
        return await window.api.getAppVersion() || 'Unknown';
    } catch {
        return 'Unknown';
    }
}

// Handle email support button - opens user's default email client
if (btnEmailSupport) {
    btnEmailSupport.addEventListener('click', async () => {
        const appVersion = await getSupportEmailVersion();
        const subject = encodeURIComponent('DateBack Support Request');
        const body = encodeURIComponent(`Please describe your issue:\n\n\n\n---\nDateBack Version: ${appVersion}\nPlatform: macOS`);
        window.api.openExternal(`mailto:support@dateback.app?subject=${subject}&body=${body}`);
        closeContactModal(); // Close modal after opening email
    });
} else {
    console.error('Email support button not found in DOM');
}

// Event listeners
btnContactSupport.addEventListener('click', openContactModal);

// Close button event listener
const contactModalCloseBtn = document.getElementById('contact-modal-close-btn');
contactModalCloseBtn.addEventListener('click', closeContactModal);

// Close modal when clicking outside
contactModal.addEventListener('click', (e) => {
    if (e.target === contactModal) {
        closeContactModal();
    }
});

// ============================================
// Focus Trap Utility
// ============================================
const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const _focusTrapStack = [];

function trapFocus(modal) {
    const focusable = Array.from(modal.querySelectorAll(FOCUSABLE_SELECTOR));
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (focusable.length) focusable[0].focus();

    function handler(e) {
        if (e.key !== 'Tab') return;
        const els = Array.from(modal.querySelectorAll(FOCUSABLE_SELECTOR));
        if (!els.length) { e.preventDefault(); return; }
        if (e.shiftKey) {
            if (!modal.contains(document.activeElement) || document.activeElement === els[0]) {
                e.preventDefault();
                els[els.length - 1].focus();
            }
        } else {
            if (!modal.contains(document.activeElement) || document.activeElement === els[els.length - 1]) {
                e.preventDefault();
                els[0].focus();
            }
        }
    }
    document.addEventListener('keydown', handler);
    _focusTrapStack.push({ modal, handler, returnFocus });
}

function releaseFocus(modal) {
    const idx = _focusTrapStack.findIndex(entry => entry.modal === modal);
    if (idx === -1) return;
    const [entry] = _focusTrapStack.splice(idx, 1);
    document.removeEventListener('keydown', entry.handler);
    if (entry.returnFocus && document.body.contains(entry.returnFocus)) {
        entry.returnFocus.focus();
    }
}

// Auto-wire focus trap: observe every .modal for visibility changes
document.querySelectorAll('.modal').forEach(modal => {
    new MutationObserver(() => {
        const visible = !modal.classList.contains('hidden');
        const trapped = _focusTrapStack.some(e => e.modal === modal);
        if (visible && !trapped) trapFocus(modal);
        else if (!visible && trapped) releaseFocus(modal);
    }).observe(modal, { attributes: true, attributeFilter: ['class'] });
});

// Trap focus in any modal that starts visible (instructions-modal has no hidden class on load)
document.querySelectorAll('.modal:not(.hidden)').forEach(trapFocus);

// Close modal with ESC key
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!contactModal.classList.contains('hidden')) {
        closeContactModal();
    } else if (!logsExportModal.classList.contains('hidden')) {
        closeLogsExportModal();
    } else if (!instructionsModal.classList.contains('hidden')) {
        btnCloseModal.click();
    } else if (!successModal.classList.contains('hidden')) {
        successModal.classList.add('hidden');
    } else if (!nextStepsModal.classList.contains('hidden')) {
        nextStepsModal.classList.add('hidden');
    } else if (!stopConfirmModal.classList.contains('hidden')) {
        btnResume.click();
    } else if (!multiZipModal.classList.contains('hidden')) {
        const btns = multiZipModalButtons.querySelectorAll('button');
        if (btns.length > 0) btns[btns.length - 1].click();
    } else if (!batteryWarningModal.classList.contains('hidden')) {
        btnCancelBattery.click();
    } else if (!offlineWarningModal.classList.contains('hidden')) {
        btnCancelOffline.click();
    } else if (!restartConfirmModal.classList.contains('hidden')) {
        btnCancelRestart.click();
    } else if (!resumeModeModal.classList.contains('hidden')) {
        btnResumeCancel.click();
    } else if (!batchPauseModal.classList.contains('hidden')) {
        btnPauseAfterBatch.click();
    } else if (!storageWarningModal.classList.contains('hidden')) {
        btnStorageCancel.click();
    } else if (!messageModal.classList.contains('hidden')) {
        btnMessageOk.click();
    } else if (!expiredLinkModal.classList.contains('hidden')) {
        btnExpiredLinkOk.click();
    }
});

// ============================================
// Support Logs Export Modal
// ============================================

const logsExportModal = document.getElementById('logs-export-modal');
const logsExportFilename = document.getElementById('logs-export-filename');
const logsSupportEmail = document.getElementById('logs-support-email');
const btnLogsExportOk = document.getElementById('btn-logs-export-ok');
const logsExportModalCloseBtn = document.getElementById('logs-export-modal-close-btn');

// Open logs export modal
function openLogsExportModal(filename) {
    logsExportFilename.textContent = filename;
    logsExportModal.classList.remove('hidden');
}

// Close logs export modal
function closeLogsExportModal() {
    logsExportModal.classList.add('hidden');
}

// Email link click handler
if (logsSupportEmail) {
    logsSupportEmail.addEventListener('click', async () => {
        const appVersion = await getSupportEmailVersion();
        const subject = encodeURIComponent('DateBack Support Request - Logs Attached');
        const body = encodeURIComponent(`Please describe your issue:\n\n\n\n---\nDateBack Version: ${appVersion}\nPlatform: macOS\n\nSupport logs are attached to this email.`);
        window.api.openExternal(`mailto:support@dateback.app?subject=${subject}&body=${body}`);
    });
}

// OK button
if (btnLogsExportOk) {
    btnLogsExportOk.addEventListener('click', closeLogsExportModal);
}

// Close button
if (logsExportModalCloseBtn) {
    logsExportModalCloseBtn.addEventListener('click', closeLogsExportModal);
}

// Close modal when clicking outside
logsExportModal.addEventListener('click', (e) => {
    if (e.target === logsExportModal) {
        closeLogsExportModal();
    }
});
