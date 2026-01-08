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
const storageAvailable = document.getElementById('storage-available');
const storageRequired = document.getElementById('storage-required');
const storageWarning = document.getElementById('storage-warning');
const storageCount = document.getElementById('storage-count');

// Modals
const instructionsModal = document.getElementById('instructions-modal');
const successModal = document.getElementById('success-modal');
const btnOpenSnapchat = document.getElementById('btn-open-snapchat');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCloseSuccess = document.getElementById('btn-close-success');
const btnRetryCorrupted = document.getElementById('btn-retry-corrupted');
const statsContainer = document.getElementById('stats-container');
const dontShowAgainCheckbox = document.getElementById('dont-show-again');
const btnShowInstructions = document.getElementById('btn-show-instructions');

// Cloud Mode Info Modal
const cloudModeInfoModal = document.getElementById('cloud-mode-info-modal');
const btnCloudModeInfo = document.getElementById('btn-cloud-mode-info');
const btnCloseCloudInfo = document.getElementById('btn-close-cloud-info');
const pauseBetweenBatchesCheckbox = document.getElementById('pause-between-batches');

// Next Steps Guide elements
const nextStepsModal = document.getElementById('next-steps-modal');
const btnNextStepsGuide = document.getElementById('btn-next-steps-guide');
const btnCloseNextSteps = document.getElementById('btn-close-next-steps');
const guideTabs = document.querySelectorAll('.guide-tabs .tab');
const tabGoogle = document.getElementById('tab-google');
const tabIcloud = document.getElementById('tab-icloud');
const linkGooglePhotos = document.getElementById('link-google-photos');

// License Modal elements
const licenseModal = document.getElementById('license-modal');
const licenseKeyInput = document.getElementById('license-key-input');
const btnBuyLicense = document.getElementById('btn-buy-license');
const btnActivateLicense = document.getElementById('btn-activate-license');
const licenseStatus = document.getElementById('license-status');

// Storage Warning Modal elements
const storageWarningModal = document.getElementById('storage-warning-modal');
const storageWarningTitle = document.getElementById('storage-warning-title');
const storageWarningText = document.getElementById('storage-warning-text');
const storageWarningSubtext = document.getElementById('storage-warning-subtext');
const btnStorageCancel = document.getElementById('btn-storage-cancel');
const btnStorageContinue = document.getElementById('btn-storage-continue');

// State
let isProcessing = false;
let currentOutputDir = '';
let currentMemoryCount = 0;
let isLicensed = false;
let hadPartialRun = false;  // Track if user stopped mid-processing
let lastProcessedCount = 0; // Track how many files were processed before stopping

// Helper: Format bytes
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Helper: Show Storage Warning Modal
function showStorageWarningModal(title, text, subtext, allowContinue) {
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
            btnStorageCancel.textContent = 'Cancel';
            btnStorageContinue.addEventListener('click', handleContinue);
        } else {
            btnStorageContinue.style.display = 'none';
            btnStorageCancel.textContent = 'OK';
        }

        btnStorageCancel.addEventListener('click', handleCancel);
    });
}

// Helper: Check Storage
async function checkStorage(count) {
    storageCheckSection.classList.remove('hidden');
    if (storageCount) storageCount.textContent = count.toLocaleString();

    // Check if Cloud Mode is enabled
    const isCloudMode = pauseBetweenBatchesCheckbox.checked;

    // Estimate 8MB per file (conservative - videos can be large)
    let requiredBytes;
    if (isCloudMode) {
        // Cloud Mode: Only need space for ~2 batches (500 files each = 1000 files)
        // This gives buffer for processing while uploading/deleting
        const batchSize = 1000; // 2 batches worth
        const filesNeeded = Math.min(count, batchSize);
        requiredBytes = filesNeeded * 8 * 1024 * 1024;
    } else {
        // Normal Mode: Need space for all files
        requiredBytes = count * 8 * 1024 * 1024;
    }

    storageRequired.textContent = formatBytes(requiredBytes) + (isCloudMode ? ' (per batch)' : '');

    // Get storage status icon element
    const storageStatusIcon = document.getElementById('storage-status-icon');

    // Get available space
    let pathToCheck = outputPathInput.value;
    if (!pathToCheck) {
        // Fallback to defaults or won't work perfectly until path is set, 
        // but we can try to guess based on existing input or current dir
        const defaults = await window.api.getDefaults();
        pathToCheck = defaults.outputDir || '.';
    }

    const disk = await window.api.getDiskSpace(pathToCheck);

    if (disk.success) {
        storageAvailable.textContent = formatBytes(disk.free);

        // Minimum free space threshold: 5GB absolute minimum
        const absoluteMinimum = 5 * 1024 * 1024 * 1024; // 5GB

        // Warning if free space is less than required (plus buffer)
        const isCriticallyLow = disk.free < absoluteMinimum;
        const isLowSpace = disk.free < requiredBytes;

        // Get the available space stat box
        const availableStatBox = storageAvailable.closest('.stat-box');

        if (isLowSpace || isCriticallyLow) {
            storageWarning.classList.remove('hidden');
            storageWarning.innerHTML = isCriticallyLow
                ? '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" style="display: inline-block; vertical-align: middle; margin-right: 6px;"><path d="M10 2L2 17h16L10 2z" fill="var(--accent-red)" stroke="var(--accent-red)" stroke-width="1.5"/><path d="M10 8v4M10 14h.01" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg><strong>CRITICAL:</strong> You need at least 5GB free to process files safely.'
                : (isCloudMode
                    ? '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" style="display: inline-block; vertical-align: middle; margin-right: 6px;"><path d="M10 2L2 17h16L10 2z" fill="var(--accent-red)" stroke="var(--accent-red)" stroke-width="1.5"/><path d="M10 8v4M10 14h.01" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg><strong>Warning:</strong> Low space detected. Make sure to delete each batch after uploading!'
                    : '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" style="display: inline-block; vertical-align: middle; margin-right: 6px;"><path d="M10 2L2 17h16L10 2z" fill="var(--accent-red)" stroke="var(--accent-red)" stroke-width="1.5"/><path d="M10 8v4M10 14h.01" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg><strong>Warning:</strong> You might run out of space! Consider enabling Cloud Mode or freeing up storage.');
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

            // Disable START button and Cloud Mode checkbox if critically low
            if (isCriticallyLow) {
                btnStart.disabled = true;
                pauseBetweenBatchesCheckbox.disabled = true;
            }
        } else {
            storageWarning.classList.add('hidden');
            storageAvailable.style.color = 'var(--accent-green)';
            storageStatusIcon.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="10" cy="10" r="9" fill="var(--accent-green)" stroke="var(--accent-green)" stroke-width="1.5"/>
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

            // Re-enable START button, Cloud Mode checkbox, and output location change if storage is OK (and validation passed)
            pauseBetweenBatchesCheckbox.disabled = false;
            btnBrowseOutput.disabled = false;
            if (zipValidation.classList.contains('valid')) {
                btnStart.disabled = false;
            }
        }
    } else {
        storageAvailable.textContent = 'Unknown';
        storageStatusIcon.textContent = '❓';
        storageStatusIcon.className = 'status-icon-inline';
    }
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
                <circle cx="10" cy="10" r="9" fill="var(--accent-green)" stroke="var(--accent-green)" stroke-width="1.5"/>
                <path d="M6 10L9 13L14 7" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            memories_history.json found
        `;
        btnValidationHelp.classList.add('hidden');
        btnStart.disabled = false;

        // Memory count and storage check
        if (result.count) {
            currentMemoryCount = result.count; // Store count for later re-checks
            checkStorage(result.count);
        }
    } else {
        zipValidation.classList.add('invalid');
        validationStatus.classList.add('invalid');
        validationStatus.textContent = '❌ memories_history.json not found';
        btnValidationHelp.classList.remove('hidden');
        btnStart.disabled = true;
        storageCheckSection.classList.add('hidden');
    }
}

// Helper: Set file path and update UI
async function setFilePath(path) {
    if (!path) return;

    // Validate and check if it's a zip file
    if (!path.toLowerCase().endsWith('.zip')) {
        alert('Please select a valid ZIP file');
        return;
    }

    zipPathInput.value = path;
    fileName.textContent = path.split('/').pop();
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
}

// Initialize
async function init() {
    // Check license status first
    await checkLicense();

    // Get default paths
    const defaults = await window.api.getDefaults();
    if (defaults.zipPath) {
        setFilePath(defaults.zipPath);
    }
    if (defaults.outputDir) {
        outputPathInput.value = defaults.outputDir;
        currentOutputDir = defaults.outputDir;
    }

    // Show instructions modal only on first launch
    const hasSeenInstructions = localStorage.getItem('hasSeenInstructions');
    if (!hasSeenInstructions) {
        instructionsModal.classList.remove('hidden');
    }
}

// ==========================================
// Drag and Drop
// ==========================================

// Click to browse
dropZone.addEventListener('click', async () => {
    const zipPath = await window.api.selectZip();
    if (zipPath) {
        await setFilePath(zipPath);
    }
});

// Find My Zip button handler
const btnFindZip = document.getElementById('btn-find-zip');
btnFindZip.addEventListener('click', async (e) => {
    e.stopPropagation(); // Prevent event bubbling
    e.preventDefault();

    btnFindZip.disabled = true;
    btnFindZip.textContent = '🔍 Searching...';

    const result = await window.api.findZip();

    if (result.success) {
        await setFilePath(result.path);
        // Reset text but keep disabled (setFilePath already disables it)
        btnFindZip.textContent = '🔍 Find My Zip Automatically';
    } else {
        alert(`Could not find mydata~*.zip file.\n\n${result.error}\n\nPlease select your ZIP file manually.`);
        // Only re-enable if search failed
        btnFindZip.disabled = false;
        btnFindZip.textContent = '🔍 Find My Zip Automatically';
    }
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

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
        const file = files[0];
        if (file.name.endsWith('.zip')) {
            setFilePath(file.path);
        } else {
            alert('Please drop a .zip file');
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
    const path = await window.api.selectFolder();
    if (path) {
        outputPathInput.value = path;
        currentOutputDir = path;

        // Re-check storage if we have a count
        if (currentMemoryCount > 0) {
            checkStorage(currentMemoryCount);
        }
    }
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

// Main Processing Routine
async function startProcessingRoutine(isResume = false, resumeMode = 'verify') {
    console.log('[START] startProcessingRoutine called - isResume:', isResume, 'resumeMode:', resumeMode, 'isProcessing:', isProcessing);

    if (isProcessing) {
        console.log('[START] Already processing, returning early');
        return;
    }

    const zipPath = zipPathInput.value;
    const outputDir = outputPathInput.value;
    console.log('[START] zipPath:', zipPath, 'outputDir:', outputDir);

    if (!zipPath) {
        alert('Please select your mydata.zip file first!');
        return;
    }

    // Connectivity Guard: Warn if offline and using cloud storage folder
    const isOffline = !navigator.onLine;
    const cloudKeywords = ['Google Drive', 'iCloud', 'OneDrive', 'Dropbox', 'CloudStorage'];
    const isCloudPath = cloudKeywords.some(keyword => outputDir.includes(keyword));

    if (isOffline && isCloudPath) {
        const continueAnyway = await showOfflineWarning();
        if (!continueAnyway) {
            return;
        }
    }

    // Hard block if less than 5GB free (absolute minimum)
    const disk = await window.api.getDiskSpace(outputDir);
    const absoluteMinimum = 5 * 1024 * 1024 * 1024; // 5GB
    if (disk.success && disk.free < absoluteMinimum) {
        await showStorageWarningModal(
            '❌ Cannot Start Processing',
            `You only have ${formatBytes(disk.free)} free.`,
            'MemSavr requires at least 5GB of free space to process files safely.\n\nPlease free up space and try again.',
            false // No continue option
        );
        return;
    }

    // Check for storage warning (soft warning, allows continuation)
    if (!storageWarning.classList.contains('hidden')) {
        const isCloudMode = pauseBetweenBatchesCheckbox.checked;
        const warningMsg = isCloudMode
            ? "Cloud Mode is enabled, but storage is still tight.\n\nMake sure to upload and delete each batch immediately after it completes."
            : "You may run out of space during processing.\n\nConsider enabling 'Cloud Mode' or freeing up storage.";

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

    isProcessing = true;
    stoppedByUser = false; // Reset stop flag

    // Disable Cloud Mode checkbox and output location change during processing
    pauseBetweenBatchesCheckbox.disabled = true;
    btnBrowseOutput.disabled = true;

    // UI Updates
    btnStart.classList.add('hidden');
    resumeRestartContainer.classList.add('hidden'); // Hide restart options
    btnStop.classList.remove('hidden');

    progressFill.style.background = ''; // Reset any error styling
    progressFill.classList.remove('complete'); // Reset complete state
    progressBar.classList.remove('ready'); // Remove ready pulse

    if (isResume) {
        progressTextContent.textContent = resumeMode === 'trust' ? 'Resuming (Skip Files Already Processed)...' : 'Resuming...';
    } else {
        progressFill.style.width = '0%';
        progressTextContent.textContent = 'Starting...';
        logOutput.textContent = ''; // Only clear log on fresh start/restart
    }

    progressEta.textContent = '';

    // Get pause between batches preference
    const pauseBetweenBatches = document.getElementById('pause-between-batches').checked;

    try {
        const args = { zipPath, outputDir, pauseBetweenBatches };
        if (isResume) {
            args.resumeMode = resumeMode;
        }
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
                    hasProcessedBefore = true;
                    resumeRestartContainer.classList.add('hidden');
                    btnStart.classList.add('hidden');
                    document.getElementById('btn-restart-complete').classList.remove('hidden');
                } else {
                    progressTextContent.innerHTML = `
                        <svg class="status-icon" width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="10" cy="10" r="9" fill="var(--accent-green)" stroke="var(--accent-green)" stroke-width="1.5"/>
                            <path d="M6 10L9 13L14 7" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                        Complete!
                    `;
                    progressFill.style.width = '100%';
                    progressFill.classList.add('complete'); // Solid green, no animation
                    hasProcessedBefore = true;
                    // Show the Restart button (not Start) after successful completion
                    resumeRestartContainer.classList.add('hidden');
                    btnStart.classList.add('hidden');
                    document.getElementById('btn-restart-complete').classList.remove('hidden');
                }
            } else {
                // Error occurred - show Resume/Restart options (not Start)
                progressTextContent.textContent = `❌ Error: ${result.error}`;
                progressFill.style.background = 'var(--accent-red)';
                btnStart.classList.add('hidden');
                resumeRestartContainer.classList.remove('hidden');
            }
        }
    } catch (error) {
        if (!stoppedByUser) {
            // Error in try/catch - show Resume/Restart options
            progressTextContent.textContent = `❌ Error: ${error.message}`;
            console.error(error);
            btnStart.classList.add('hidden');
            resumeRestartContainer.classList.remove('hidden');
        }
    } finally {
        isProcessing = false;
        btnStop.classList.add('hidden');
        progressText.classList.remove('processing');
        progressBar.classList.add('ready'); // Restore ready pulse

        // Only re-enable Cloud Mode checkbox and output change if not stopped by user
        // If stopped, controls stay disabled until Restart is clicked
        if (!stoppedByUser) {
            pauseBetweenBatchesCheckbox.disabled = false;
            btnBrowseOutput.disabled = false;
        }

        // Note: We don't blindly show btnStart here anymore, handled in catch/success
        // If stopped by user, btnStart stays hidden and resume buttons show (handled in stop handler)
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

    // Create nicer formatted summary with HTML
    const totalText = totalFiles ? `<span style="opacity: 0.6;"> / ${totalFiles.toLocaleString()}</span>` : '';
    resumeModeSummary.innerHTML = `
        <div style="margin-bottom: 4px;">
            <span style="color: var(--text-muted); font-size: 13px;">Previously processed:</span>
            <span style="font-size: 20px; font-weight: 600; color: var(--accent-green); margin-left: 8px;">${processedCount.toLocaleString()}</span>${totalText}
        </div>
        <div style="color: var(--text-muted); font-size: 13px;">
            Last run: ${lastRun}
        </div>
    `;

    const trustAvailable = processedCount > 0 && zipMatch !== false;
    btnResumeTrust.disabled = !trustAvailable;
    btnResumeTrust.textContent = trustAvailable ? 'Skip Files Already Processed' : 'Skip Files Already Processed (Unavailable)';

    if (zipMatch === false) {
        // Show warning in info tooltip
        const infoTooltip = document.getElementById('resume-mode-info');
        if (infoTooltip) {
            infoTooltip.classList.remove('hidden');
            infoTooltip.innerHTML = '<p style="color: var(--accent-orange);"><strong>⚠️ Warning:</strong> Selected ZIP does not match the previous run. "Skip Files Already Processed" is disabled.</p>';
        }
    }

    resumeModeModal.classList.remove('hidden');
}

function closeResumeModeModal() {
    resumeModeModal.classList.add('hidden');
    // Hide info tooltip when closing
    const infoTooltip = document.getElementById('resume-mode-info');
    if (infoTooltip) {
        infoTooltip.classList.add('hidden');
    }
}

// Info button toggle
const btnResumeInfo = document.getElementById('btn-resume-info');
const resumeModeInfo = document.getElementById('resume-mode-info');

if (btnResumeInfo && resumeModeInfo) {
    btnResumeInfo.addEventListener('click', (e) => {
        e.preventDefault();
        resumeModeInfo.classList.toggle('hidden');
    });
}

// Start Processing (Initial)
btnStart.addEventListener('click', async () => {
    const outputDir = outputPathInput.value;
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
        }
    }
    await startProcessingRoutine(false);
});

// Resume Processing
btnResumeProc.addEventListener('click', async () => {
    const outputDir = outputPathInput.value;
    const zipPath = zipPathInput.value;
    console.log('[Resume Processing] Output dir:', outputDir);
    console.log('[Resume Processing] ZIP path:', zipPath);
    console.log('[Resume Processing] Just paused:', justPaused);

    try {
        const result = await window.api.getResumeManifest({ outputDir, zipPath });
        console.log('[Resume Processing] Manifest result:', result);

        if (result && result.success && result.manifest) {
            const isCloudMode = result.manifest.icloud_mode === true;
            console.log('[Resume Processing] Cloud mode:', isCloudMode);

            // If just paused and NOT in cloud mode, skip modal and go to verify
            if (justPaused && !isCloudMode) {
                console.log('[Resume Processing] Non-cloud paused state - skipping modal, using verify');
                justPaused = false; // Reset flag
                await startProcessingRoutine(true, 'verify');
                return;
            }

            // Otherwise show modal (cloud mode OR from start screen)
            console.log('[Resume Processing] Showing resume modal');
            showResumeModeModal(result.manifest, result.zipMatch);
            return;
        } else {
            console.log('[Resume Processing] No manifest found, starting verify mode');
        }
    } catch (e) {
        console.error('[Resume Processing] Error loading manifest:', e);
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
    const outputDir = document.getElementById('output-path').value;
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
    const outputDir = outputPathInput.value;
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
    btnStart.classList.remove('hidden');
    resumeRestartContainer.classList.add('hidden');

    // Re-enable Cloud Mode checkbox and output location change on restart
    pauseBetweenBatchesCheckbox.disabled = false;
    btnBrowseOutput.disabled = false;

    // Reset progress visuals
    progressFill.style.width = '0%';
    progressFill.style.background = '';
    progressFill.classList.remove('complete'); // Remove complete class
    progressTextContent.textContent = 'Ready';
    progressText.classList.remove('processing');
    progressEta.textContent = '';
    logOutput.textContent = '';

    // Reset partial run tracking
    hadPartialRun = false;
    lastProcessedCount = 0;
    stoppedByUser = false; // Reset stop flag
}

// Cancel Restart
btnCancelRestart.addEventListener('click', () => {
    restartConfirmModal.classList.add('hidden');
});

// Restart button after successful completion (resets UI to start state)
const btnRestartComplete = document.getElementById('btn-restart-complete');
btnRestartComplete.addEventListener('click', () => {
    // Hide the restart button, show the start button
    btnRestartComplete.classList.add('hidden');
    btnStart.classList.remove('hidden');

    // Reset progress visuals
    progressFill.style.width = '0%';
    progressFill.style.background = '';
    progressFill.classList.remove('complete');
    progressTextContent.textContent = 'Ready';
    progressText.classList.remove('processing');
    progressEta.textContent = '';
    logOutput.textContent = '';
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

    // Ensure checkbox stays disabled
    pauseBetweenBatchesCheckbox.disabled = true;

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
    progressTextContent.textContent = '⏸️ Pausing...';
    progressFill.style.background = 'var(--accent-orange)';
    progressEta.textContent = '';

    // Show Resume/Restart options but DISABLED initially
    btnStart.classList.add('hidden');
    resumeRestartContainer.classList.remove('hidden');

    // Disable all buttons while Python is cleaning up
    btnResumeProc.disabled = true;
    btnContinueLater.disabled = true;
    btnRestartProc.disabled = true;

    const result = await window.api.stopProcessing();
    if (result.success) {
        // Python is cleaning up - buttons stay disabled
        progressTextContent.textContent = '⏸️ Paused - Cleaning up...';

        // Wait for Python to fully exit (indicated by isProcessing becoming false)
        // This happens in the finally block of startProcessingRoutine
        const checkCleanupComplete = setInterval(() => {
            if (!isProcessing) {
                clearInterval(checkCleanupComplete);

                // Cleanup complete - enable buttons
                btnResumeProc.disabled = false;
                btnContinueLater.disabled = false;
                btnRestartProc.disabled = false;

                progressTextContent.textContent = '⏹️ Paused';
                btnOpenFolder.disabled = false;

                // Cloud Mode UX: Hide "Start Over" if Cloud Mode is active to prevent accidental deletion
                const isCloudMode = pauseBetweenBatchesCheckbox.checked;
                if (isCloudMode) {
                    btnRestartProc.classList.add('hidden'); // Hide Start Over
                } else {
                    btnRestartProc.classList.remove('hidden'); // Show Start Over
                }

                // Show warning/info log
                logOutput.textContent += '\n⚠️ Process paused by user.\n';
                logOutput.scrollTop = logOutput.scrollHeight;
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
    alert(`Your ZIP file is missing "memories_history.json"

This happens when you didn't select the right options on Snapchat's download page.

To fix this:
1. Go back to Snapchat's "Download My Data" page
2. Make sure you toggle ON:
   • "Export your Memories"
   • "Export JSON Files"
3. Request a new data download
4. Wait for the email and download the new ZIP

Your current ZIP file cannot be processed without the JSON file.`);
});

// Toggle Log
btnToggleLog.addEventListener('click', () => {
    logContainer.classList.toggle('hidden');
    const textSpan = btnToggleLog.querySelector('span');
    textSpan.textContent = logContainer.classList.contains('hidden') ? 'View Log' : 'Hide Log';
});

// Batch Pause Modal Elements
const batchPauseModal = document.getElementById('batch-pause-modal');
const batchPauseMessage = document.getElementById('batch-pause-message');
const btnContinueBatch = document.getElementById('btn-continue-batch');
const btnPauseAfterBatch = document.getElementById('btn-pause-after-batch');

// Generic Message Modal
const messageModal = document.getElementById('message-modal');
const messageModalTitle = document.getElementById('message-modal-title');
const messageModalText = document.getElementById('message-modal-text');
const btnMessageOk = document.getElementById('btn-message-ok');

function showMessage(title, text) {
    messageModalTitle.textContent = title;
    messageModalText.textContent = text;
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
    batchPauseMessage.textContent = `Batch ${batchNum} of ${totalBatches} complete. Paused for cloud sync.`;
    batchPauseModal.classList.remove('hidden');
}

// Continue to Next Batch - sends resume signal to Python
btnContinueBatch.addEventListener('click', async () => {
    console.log('[Cloud Mode] Continue Batch button clicked');
    batchPauseModal.classList.add('hidden');
    // Don't set "Resuming..." text - it will update automatically with the next progress message

    try {
        console.log('[Cloud Mode] Calling resumeBatch API');
        const result = await window.api.resumeBatch();
        console.log('[Cloud Mode] resumeBatch result:', result);
        if (!result.success) {
            console.error('[Cloud Mode] Failed to resume batch:', result.error);
            alert(`Failed to resume processing: ${result.error}\n\nPlease restart the application.`);
            progressTextContent.textContent = '⚠️ Resume failed';
        } else {
            console.log('[Cloud Mode] Successfully resumed batch');
            // Progress will update automatically when Python sends next progress message
        }
    } catch (err) {
        console.error('[Cloud Mode] Error resuming batch:', err);
        alert(`Error resuming processing: ${err.message}\n\nPlease restart the application.`);
        progressTextContent.textContent = '⚠️ Resume error';
    }
});

// Pause After Batch - User wants to stop and come back later
btnPauseAfterBatch.addEventListener('click', async () => {
    console.log('[Cloud Mode] Pause After Batch button clicked');
    batchPauseModal.classList.add('hidden');
    progressTextContent.textContent = 'Pausing...';

    try {
        // Set stoppedByUser to prevent completion handler from overriding our pause state
        stoppedByUser = true;

        console.log('[Cloud Mode] Stopping processing');

        // Hide Cancel button immediately
        btnStop.classList.add('hidden');

        // Show Resume/Restart options but DISABLED initially (while cleaning up)
        btnStart.classList.add('hidden');
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
        console.log('[Cloud Mode] Set hadPartialRun=true, lastProcessedCount=', lastProcessedCount);

        // Update UI to show cleaning up state
        progressTextContent.textContent = '⏸️ Paused - Cleaning up...';

        // Wait for Python to fully exit (indicated by isProcessing becoming false)
        const checkCleanupComplete = setInterval(() => {
            if (!isProcessing) {
                clearInterval(checkCleanupComplete);

                // Cleanup complete - enable buttons
                btnResumeProc.disabled = false;
                btnContinueLater.disabled = false;
                btnRestartProc.disabled = false;

                progressTextContent.textContent = '⏹️ Paused';
                btnOpenFolder.disabled = false;

                // Cloud Mode UX: Hide "Start Over" button (since we are definitely in Cloud Mode here)
                btnRestartProc.classList.add('hidden');
                console.log('[Cloud Mode] UI updated - showing Resume/Continue Later buttons');
            }
        }, 100); // Check every 100ms

    } catch (err) {
        console.error('Error pausing after batch:', err);
        stoppedByUser = false; // Reset on error
        progressTextContent.textContent = '⚠️ Pause error';

        // Re-enable buttons on error
        btnResumeProc.disabled = false;
        btnContinueLater.disabled = false;
        btnRestartProc.disabled = false;
    }
});

// Open Output Folder
btnOpenFolder.addEventListener('click', () => {
    const outputDir = outputPathInput.value;
    if (outputDir) {
        window.api.openFolder(outputDir);
    }
});

// Open Snapchat URL
btnOpenSnapchat.addEventListener('click', () => {
    window.api.openUrl('https://accounts.snapchat.com/v2/download-my-data');
});

// Close Instructions Modal
btnCloseModal.addEventListener('click', () => {
    instructionsModal.classList.add('hidden');
    // Only save "don't show again" if checkbox is checked
    if (dontShowAgainCheckbox.checked) {
        localStorage.setItem('hasSeenInstructions', 'true');
    }
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

// Cloud Mode Info - Show on info icon click
btnCloudModeInfo.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    cloudModeInfoModal.classList.remove('hidden');
});

// Cloud Mode Info - Close modal
btnCloseCloudInfo.addEventListener('click', () => {
    cloudModeInfoModal.classList.add('hidden');
});

// Cloud Mode - Show info modal on first check (per session)
let hasSeenCloudModeInfoThisSession = false;

pauseBetweenBatchesCheckbox.addEventListener('change', (e) => {
    if (e.target.checked) {
        // Show modal on first check of this session
        if (!hasSeenCloudModeInfoThisSession) {
            cloudModeInfoModal.classList.remove('hidden');
            hasSeenCloudModeInfoThisSession = true;
        }
    }

    // Re-calculate storage requirements when Cloud Mode is toggled
    if (currentMemoryCount > 0) {
        checkStorage(currentMemoryCount);
    }
});

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
window.api.onProgressUpdate((data) => {
    if (data.type === 'progress') {
        const { count, total } = data;

        // Handle verification phase (Fast Pass check)
        if (count === -1) {
            progressTextContent.textContent = `Verifying existing files... (${total.toLocaleString()} to check)`;
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
        progressTextContent.textContent = `Processed: ${count} / ${total}`;

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
        // Python is requesting a pause for cloud sync
        progressTextContent.textContent = `Batch ${data.batch} complete - Paused`;
        progressEta.textContent = '';
        // Note: signal file path is now handled by main process, not renderer
        showBatchPauseModal(data.batch, data.totalBatches);

    } else if (data.type === 'complete') {
        progressEta.textContent = '';
        etaTimestamps = [];
        lastProgressCount = 0;
        lastProgressTime = 0;
        showSuccessModal(data.stats);
    }
});

// Log messages from Python
let expiredLinkAlertShown = false;

window.api.onLogMessage((message) => {
    logOutput.textContent += message + '\n';
    logOutput.scrollTop = logOutput.scrollHeight;

    // Detect expired link errors and show alert once
    if (message.includes('LINKS_EXPIRED') && !expiredLinkAlertShown) {
        expiredLinkAlertShown = true;
        progressTextContent.textContent = '⚠️ Download links expired!';
        progressFill.style.background = 'var(--accent-red)';

        // Show custom modal instead of alert
        const expiredLinkModal = document.getElementById('expired-link-modal');
        expiredLinkModal.classList.remove('hidden');

        // Close modal on OK button click
        const btnExpiredLinkOk = document.getElementById('btn-expired-link-ok');
        btnExpiredLinkOk.onclick = () => {
            expiredLinkModal.classList.add('hidden');
        };
    }
});

// Listen for logs export success
window.api.onLogsExported((data) => {
    openLogsExportModal(data.filename);
});

// Show success modal with stats
let lastStats = null;

function showSuccessModal(stats) {
    lastStats = stats; // Store for View Summary button
    const usedTrustManifest = !!stats.used_trust_manifest || (typeof stats.previously_processed === 'number' && stats.previously_processed > 0);
    const manifestTotalFiles = typeof stats.manifest_total_files === 'number' ? stats.manifest_total_files : null;
    const previousProcessed = typeof stats.previously_processed === 'number' ? stats.previously_processed : 0;
    const currentRunNew = typeof stats.current_run_new === 'number' ? stats.current_run_new : stats.success;
    const currentRunImages = typeof stats.current_run_images === 'number' ? stats.current_run_images : (stats.images || 0);
    const currentRunVideos = typeof stats.current_run_videos === 'number' ? stats.current_run_videos : (stats.videos || 0);

    // Use manifest_processed_count if available (source of truth), otherwise calculate
    const totalProcessedAcrossRuns = typeof stats.manifest_processed_count === 'number'
        ? stats.manifest_processed_count
        : previousProcessed + currentRunNew;

    const total = usedTrustManifest && manifestTotalFiles ? manifestTotalFiles : stats.success + stats.duplicates + stats.errors + (stats.skipped || 0);
    const newCount = usedTrustManifest ? currentRunNew : stats.success;
    const skippedCount = stats.duplicates;

    // Dynamic headline based on scenario
    let headline = 'Congratulations!';
    let subtext = '';

    if (usedTrustManifest && manifestTotalFiles) {
        if (totalProcessedAcrossRuns >= manifestTotalFiles) {
            headline = '🎉 All memories processed!';
        } else {
            headline = 'Processing Complete!';
        }

        if (newCount > 0) {
            subtext = `Your Snapchat Memories are safely stored. Saved ${newCount.toLocaleString()} new memories this run.`;
        } else {
            subtext = 'Your Snapchat Memories are safely stored. No new memories were processed this run.';
        }
    } else if (newCount > 0 && skippedCount === 0) {
        // Scenario A: Clean Sweep
        headline = 'Success! Processing Complete.';
        subtext = 'Your memories have been successfully archived.';
    } else if (newCount > 0 && skippedCount > 0) {
        // Scenario B: Mixed/Normal
        headline = 'Processing Complete!';
        subtext = `Saved ${newCount.toLocaleString()} new memories. We skipped ${skippedCount.toLocaleString()} files that were already in your folder.`;
    } else if (newCount === 0 && skippedCount > 0) {
        // Scenario C: Already Up to Date
        headline = 'You are Up to Date!';
        subtext = 'No new memories found. All files in this export already exist in your destination folder.';
    }

    // Update modal headline
    const modalTitle = successModal.querySelector('h2');
    if (modalTitle) modalTitle.textContent = headline;

    // Add subtext if we have one
    const subtextEl = successModal.querySelector('.modal-subtext');
    if (subtextEl) {
        subtextEl.textContent = subtext;
        subtextEl.style.display = subtext ? 'block' : 'none';
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

    // Build stats using safe DOM creation
    statsContainer.appendChild(createStatRow('Total Memories Found:', total.toLocaleString()));
    if (usedTrustManifest && manifestTotalFiles) {
        statsContainer.appendChild(createStatRow('Total Processed Across All Runs:', `${totalProcessedAcrossRuns.toLocaleString()} / ${manifestTotalFiles.toLocaleString()}`, 'green', true));
        statsContainer.appendChild(createStatRow('Images Saved (This Run):', currentRunImages.toLocaleString(), 'blue', true));
        statsContainer.appendChild(createStatRow('Videos Saved (This Run):', currentRunVideos.toLocaleString(), 'blue'));
        statsContainer.appendChild(createStatRow('Previously Processed:', previousProcessed.toLocaleString(), 'blue', true));
    } else {
        statsContainer.appendChild(createStatRow('Images Saved:', (stats.images || 0).toLocaleString(), 'blue', true));
        statsContainer.appendChild(createStatRow('Videos Saved:', (stats.videos || 0).toLocaleString(), 'blue'));
    }
    statsContainer.appendChild(createStatRow('Already Existed (Skipped):', stats.duplicates.toLocaleString(), 'orange', true));

    // Duplicate info note (if applicable)
    if (stats.duplicates > 0) {
        const noteDiv = document.createElement('div');
        noteDiv.className = 'stat-note info';
        noteDiv.textContent = `ℹ️ Skipped ${stats.duplicates.toLocaleString()} files that already exist in the destination folder.`;
        statsContainer.appendChild(noteDiv);
    }

    statsContainer.appendChild(createStatRow('Corrupted/Errors:', stats.errors.toString(), 'red'));

    // REMOVED: "Downloaded from Cloud" - redundant with Images/Videos this run

    successModal.classList.remove('hidden');
    btnOpenFolder.disabled = false;
    btnViewSummary.classList.remove('hidden'); // Show View Summary button

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
    const modalTitle = successModal.querySelector('h2');
    if (modalTitle) modalTitle.textContent = 'Previous Run Summary';

    // Update subtext
    const subtextEl = successModal.querySelector('.modal-subtext');
    if (subtextEl) {
        subtextEl.textContent = 'Your progress is saved! You can continue anytime.';
        subtextEl.style.display = 'block';
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

    progressTextContent.textContent = 'Retrying corrupted files...';
    progressText.classList.add('processing');
    progressFill.style.width = '50%'; // Indeterminate
    progressBar.classList.remove('ready');

    try {
        const result = await window.api.retryCorrupted({ outputDir: currentOutputDir });

        if (result.success) {
            progressTextContent.textContent = '✅ Retry complete!';
            progressFill.style.width = '100%';
            progressFill.classList.add('complete');

            // Show updated stats if available
            if (result.stats) {
                showSuccessModal(result.stats);
            }
        } else {
            progressTextContent.textContent = `❌ Retry failed: ${result.error}`;
        }
    } catch (error) {
        progressTextContent.textContent = `❌ Error: ${error.message}`;
    } finally {
        progressText.classList.remove('processing');
        progressBar.classList.add('ready');
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

// External link handler
linkGooglePhotos.addEventListener('click', (e) => {
    e.preventDefault();
    window.api.openUrl('https://photos.google.com');
});

// Folder links in Next Steps modal - open Output Folder
const linkFolderGoogle = document.getElementById('link-folder-google');
const linkFolderGoogle2 = document.getElementById('link-folder-google-2');
const linkFolderIcloud = document.getElementById('link-folder-icloud');

function openProcessedFolder(e) {
    e.preventDefault();
    if (currentOutputDir) {
        window.api.openFolder(currentOutputDir);
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

// Walkthrough link - open website export guide section
const linkWalkthrough = document.getElementById('link-walkthrough');
if (linkWalkthrough) {
    linkWalkthrough.addEventListener('click', (e) => {
        e.preventDefault();
        window.api.openUrl('https://savemymemories.app/#export-guide');
    });
}

// Pro Tip folder button - open Output Folder
const btnOpenFolderTip = document.getElementById('btn-open-folder-tip');
if (btnOpenFolderTip) {
    btnOpenFolderTip.addEventListener('click', (e) => {
        e.preventDefault();
        if (currentOutputDir) {
            window.api.openFolder(currentOutputDir);
        }
    });
}

// ===== LICENSE MANAGEMENT =====

async function checkLicense() {
    try {
        const status = await window.api.getLicenseStatus();

        if (status.valid) {
            isLicensed = true;
            licenseModal.classList.add('hidden');
        } else {
            isLicensed = false;
            showLicenseModal();
        }
    } catch (error) {
        console.error('Error checking license:', error);
        isLicensed = false;
        showLicenseModal();
    }
}

function showLicenseModal() {
    licenseModal.classList.remove('hidden');
    licenseKeyInput.value = '';
    licenseStatus.classList.add('hidden');
}

function showLicenseStatus(message, isError = false) {
    licenseStatus.classList.remove('hidden');

    // Security: Use safe DOM creation instead of innerHTML to prevent XSS from API responses
    licenseStatus.textContent = ''; // Clear existing content

    // Create SVG element
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('fill', 'none');
    svg.style.display = 'inline-block';
    svg.style.verticalAlign = 'middle';
    svg.style.marginRight = '6px';

    if (isError) {
        licenseStatus.style.backgroundColor = 'rgba(255, 99, 71, 0.1)';
        licenseStatus.style.color = 'var(--accent-red)';

        // Warning triangle icon
        const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path1.setAttribute('d', 'M10 2L2 17h16L10 2z');
        path1.setAttribute('fill', 'var(--accent-red)');
        path1.setAttribute('stroke', 'var(--accent-red)');
        path1.setAttribute('stroke-width', '1.5');

        const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path2.setAttribute('d', 'M10 8v4M10 14h.01');
        path2.setAttribute('stroke', 'white');
        path2.setAttribute('stroke-width', '1.5');
        path2.setAttribute('stroke-linecap', 'round');

        svg.appendChild(path1);
        svg.appendChild(path2);
    } else {
        licenseStatus.style.backgroundColor = 'rgba(76, 175, 80, 0.1)';
        licenseStatus.style.color = 'var(--accent-green)';

        // Success checkmark icon
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', '10');
        circle.setAttribute('cy', '10');
        circle.setAttribute('r', '9');
        circle.setAttribute('fill', 'var(--accent-green)');
        circle.setAttribute('stroke', 'var(--accent-green)');
        circle.setAttribute('stroke-width', '1.5');

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M6 10L9 13L14 7');
        path.setAttribute('stroke', 'white');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');

        svg.appendChild(circle);
        svg.appendChild(path);
    }

    // Append SVG and message text safely
    licenseStatus.appendChild(svg);
    licenseStatus.appendChild(document.createTextNode(message));
}

// Buy License button
btnBuyLicense.addEventListener('click', () => {
    window.api.openUrl('https://memsavr.lemonsqueezy.com/checkout/buy/19bf4156-9c6d-4bbf-9592-37d3e09dba82');
});

// Activate License button
btnActivateLicense.addEventListener('click', async () => {
    const licenseKey = licenseKeyInput.value.trim().toUpperCase();

    if (!licenseKey) {
        showLicenseStatus('Please enter a license key', true);
        return;
    }

    btnActivateLicense.disabled = true;
    btnActivateLicense.textContent = 'Validating...';

    try {
        const result = await window.api.validateLicense(licenseKey);

        if (result.valid) {
            showLicenseStatus('License activated successfully!', false);
            isLicensed = true;

            // Close modal after success
            setTimeout(() => {
                licenseModal.classList.add('hidden');
            }, 1500);
        } else {
            showLicenseStatus('License key not recognized. Please verify your key or contact support.', true);
        }
    } catch (error) {
        showLicenseStatus('Failed to validate license. Please check your internet connection.', true);
    } finally {
        btnActivateLicense.disabled = false;
        btnActivateLicense.textContent = 'Activate';
    }
});

// Auto-format license key input (add dashes)
licenseKeyInput.addEventListener('input', (e) => {
    let value = e.target.value.replace(/[^A-Z0-9-]/g, '').toUpperCase();
    e.target.value = value;
});

// ============================================
// Contact Support Modal
// ============================================

const contactModal = document.getElementById('contact-modal');
const btnContactSupport = document.getElementById('btn-contact-support');
const btnEmailSupport = document.getElementById('btn-email-support');

// Open contact modal
function openContactModal() {
    contactModal.classList.add('active');
}

// Close contact modal
function closeContactModal() {
    contactModal.classList.remove('active');
}

// Handle email support button - opens user's default email client
if (btnEmailSupport) {
    btnEmailSupport.addEventListener('click', () => {
        const subject = encodeURIComponent('MemSavr Support Request');
        const body = encodeURIComponent('Please describe your issue:\n\n\n\n---\nMemSavr Version: 1.0.4\nPlatform: macOS');
        window.api.openExternal(`mailto:support@savemymemories.app?subject=${subject}&body=${body}`);
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

// Close modal with ESC key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && contactModal.classList.contains('active')) {
        closeContactModal();
    }
    if (e.key === 'Escape' && logsExportModal.classList.contains('active')) {
        closeLogsExportModal();
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
    logsExportModal.classList.add('active');
}

// Close logs export modal
function closeLogsExportModal() {
    logsExportModal.classList.remove('active');
}

// Email link click handler
if (logsSupportEmail) {
    logsSupportEmail.addEventListener('click', () => {
        const subject = encodeURIComponent('MemSavr Support Request - Logs Attached');
        const body = encodeURIComponent('Please describe your issue:\n\n\n\n---\nMemSavr Version: 1.0.4\nPlatform: macOS\n\nSupport logs are attached to this email.');
        window.api.openExternal(`mailto:support@savemymemories.app?subject=${subject}&body=${body}`);
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

// Listen for logs export success from main process
window.api.onLogsExported = (callback) => {
    window.addEventListener('logs-exported', (event) => {
        callback(event.detail);
    });
};
