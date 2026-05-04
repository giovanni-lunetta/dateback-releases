(function attachRendererHelpers(root, factory) {
    const helpers = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = helpers;
    }
    if (root) {
        root.DateBackRendererHelpers = {
            ...(root.DateBackRendererHelpers || {}),
            ...helpers
        };
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRendererHelpers() {
    function computeWorkingFolderHelpText(mode) {
        if (mode === 'COMPUTER') {
            return 'Your processed memories will be saved here.';
        }
        if (mode === 'CLOUD') {
            return 'DateBack uses a default local working folder in Cloud mode. Change it in Advanced Cloud Settings if needed.';
        }
        return 'Choose a storage mode above to continue.';
    }

    function resolveStorageMode({ computerChecked, cloudChecked }) {
        if (cloudChecked && !computerChecked) {
            return 'CLOUD';
        }
        if (computerChecked && !cloudChecked) {
            return 'COMPUTER';
        }
        return 'NONE';
    }

    function resolveRunModeFlags({
        storageMode,
        pauseAfterBatchChecked,
        isResume = false,
        resumeMode = 'verify'
    }) {
        return {
            autoUpload: storageMode === 'CLOUD',
            pauseBetweenBatches: storageMode === 'COMPUTER' && !!pauseAfterBatchChecked,
            shouldSendResumeMode: !!isResume,
            resumeModeToSend: isResume ? resumeMode : undefined
        };
    }

    function buildStartProcessingArgs({
        storageMode,
        pauseAfterBatchChecked,
        isResume = false,
        resumeMode = 'verify',
        zipPath,
        outputDir,
        destinationDir,
        stagingDir,
        uploadMode,
        resolvedCacheGb,
        resolvedCacheLowGb,
        cacheComputation
    }) {
        const runModeFlags = resolveRunModeFlags({
            storageMode,
            pauseAfterBatchChecked,
            isResume,
            resumeMode
        });
        const autoUpload = runModeFlags.autoUpload;
        const args = {
            zipPath,
            outputDir,
            pauseBetweenBatches: runModeFlags.pauseBetweenBatches,
            autoUpload,
            destinationDir: autoUpload ? destinationDir : '',
            cacheGb: autoUpload ? resolvedCacheGb : undefined,
            cacheLowGb: autoUpload ? resolvedCacheLowGb : undefined,
            uploadMode: autoUpload ? uploadMode : undefined,
            stagingDir: autoUpload ? stagingDir : '',
            cacheComputation: autoUpload ? cacheComputation : undefined
        };
        if (runModeFlags.shouldSendResumeMode) {
            args.resumeMode = runModeFlags.resumeModeToSend;
        }
        return { args, runModeFlags };
    }

    function computePauseAfterBatchState({ computerEnabled, isProcessing, pauseAfterBatchChecked }) {
        return {
            pauseAfterBatchDisabled: !computerEnabled || isProcessing,
            shouldUncheckPauseAfterBatch: !computerEnabled && !!pauseAfterBatchChecked
        };
    }

    function computeStorageEstimates({
        mode,
        count,
        pauseAfterBatchChecked,
        avgFileBytes,
        formatBytes,
        autoUploadEstimate
    }) {
        const isAutoUploadMode = mode === 'CLOUD';
        const isPauseAfterBatchMode = mode === 'COMPUTER' && !!pauseAfterBatchChecked;

        if (isAutoUploadMode) {
            const estimate = autoUploadEstimate || {};
            const requiredBytes = Number.isFinite(estimate.requiredBytes) ? estimate.requiredBytes : 0;
            return {
                estimateKind: estimate.estimateKind || 'AUTO_FALLBACK',
                requiredBytes,
                requiredText: formatBytes(requiredBytes),
                availableBytes: Number.isFinite(estimate.availableBytes) ? estimate.availableBytes : null,
                autoCacheGb: Number.isFinite(estimate.autoCacheGb) ? estimate.autoCacheGb : null,
                autoSafetyBufferGb: Number.isFinite(estimate.autoSafetyBufferGb) ? estimate.autoSafetyBufferGb : null
            };
        }

        if (isPauseAfterBatchMode) {
            const filesNeeded = Math.min(count, 1000);
            const requiredBytes = filesNeeded * avgFileBytes;
            return {
                estimateKind: 'MANUAL',
                requiredBytes,
                requiredText: `${formatBytes(requiredBytes)} per batch`,
                availableBytes: null,
                autoCacheGb: null,
                autoSafetyBufferGb: null
            };
        }

        const requiredBytes = count * avgFileBytes;
        return {
            estimateKind: 'STANDARD',
            requiredBytes,
            requiredText: formatBytes(requiredBytes),
            availableBytes: null,
            autoCacheGb: null,
            autoSafetyBufferGb: null
        };
    }

    function computeStorageWarningState({
        isAutoUploadMode,
        isPauseAfterBatchMode,
        requiredBytes,
        availableBytes,
        autoCacheGb,
        autoSafetyBufferGb,
        roundOneDecimal,
        gib
    }) {
        const absoluteMinimum = 5 * gib;
        const isLowSpace = availableBytes < requiredBytes;
        const showAbsoluteCritical = !isAutoUploadMode && availableBytes < absoluteMinimum;
        const isCriticallyLow = isAutoUploadMode ? isLowSpace : showAbsoluteCritical;
        const showWarning = isLowSpace || isCriticallyLow;

        let warningHtml = '';
        if (showWarning) {
            const autoCacheText = Number.isFinite(autoCacheGb) ? `${roundOneDecimal(autoCacheGb)} GB` : 'configured cache';
            const autoBufferText = Number.isFinite(autoSafetyBufferGb) ? `${roundOneDecimal(autoSafetyBufferGb)} GB` : 'safety buffer';
            warningHtml = showAbsoluteCritical
                ? '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" style="display: inline-block; vertical-align: middle; margin-right: 6px;"><path d="M10 2L2 17h16L10 2z" fill="var(--accent-red)" stroke="var(--accent-red)" stroke-width="1.5"/><path d="M10 8v4M10 14h.01" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg><strong>CRITICAL:</strong> You need at least 5GB free to process files safely.'
                : (isPauseAfterBatchMode
                    ? '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" style="display: inline-block; vertical-align: middle; margin-right: 6px;"><path d="M10 2L2 17h16L10 2z" fill="var(--accent-red)" stroke="var(--accent-red)" stroke-width="1.5"/><path d="M10 8v4M10 14h.01" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg><strong>Warning:</strong> Pause after each batch is enabled. If space is tight, move or delete finished batch folders before continuing.'
                    : isAutoUploadMode
                        ? `<svg width="16" height="16" viewBox="0 0 20 20" fill="none" style="display: inline-block; vertical-align: middle; margin-right: 6px;"><path d="M10 2L2 17h16L10 2z" fill="var(--accent-red)" stroke="var(--accent-red)" stroke-width="1.5"/><path d="M10 8v4M10 14h.01" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg><strong>Warning:</strong> Store on Cloud needs temporary cache + buffer (${autoCacheText} + ${autoBufferText}). Keep destination available.`
                        : '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" style="display: inline-block; vertical-align: middle; margin-right: 6px;"><path d="M10 2L2 17h16L10 2z" fill="var(--accent-red)" stroke="var(--accent-red)" stroke-width="1.5"/><path d="M10 8v4M10 14h.01" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg><strong>Warning:</strong> You might run out of space. Choose a larger working drive or switch to Store on Cloud.');
        }

        return {
            absoluteMinimum,
            isLowSpace,
            showAbsoluteCritical,
            isCriticallyLow,
            showWarning,
            warningHtml
        };
    }

    function computeProcessingUiState({
        isProcessing,
        stoppedByUser = false
    }) {
        const controlsLocked = !!isProcessing || !!stoppedByUser;
        return {
            btnBrowseOutputDisabled: controlsLocked,
            computerModeDisabled: controlsLocked,
            cloudModeDisabled: controlsLocked,
            pauseAfterBatchDisabled: controlsLocked,
            btnBrowseDestinationDisabled: controlsLocked,
            btnBrowseStagingDisabled: controlsLocked,
            cacheGbDisabled: controlsLocked,
            cacheLowGbDisabled: controlsLocked,
            uploadModeDisabled: controlsLocked,
            diskUsageAutoDisabled: controlsLocked,
            diskUsageManualDisabled: controlsLocked,
            showStopButton: !!isProcessing,
            hideResumeRestartContainer: !!isProcessing
        };
    }

    function buildSuccessModalCopy(stats) {
        const isCloudModeStats = !!stats.auto_upload;
        const hasCloudDeliveryStats = isCloudModeStats && (
            typeof stats.upload_confirmed_in_destination === 'number' ||
            typeof stats.upload_copied_this_run === 'number' ||
            typeof stats.uploaded_to_destination === 'number' ||
            typeof stats.upload_remaining_in_staging === 'number' ||
            typeof stats.upload_error_events === 'number'
        );
        const confirmedInDestination = Number.isFinite(stats.upload_confirmed_in_destination)
            ? stats.upload_confirmed_in_destination
            : (Number.isFinite(stats.uploaded_to_destination) ? stats.uploaded_to_destination : 0);
        const copiedThisRun = Number.isFinite(stats.upload_copied_this_run)
            ? stats.upload_copied_this_run
            : 0;
        const alreadyInDestination = Math.max(0, confirmedInDestination - copiedThisRun);
        const uploadErrorEvents = Number.isFinite(stats.upload_error_events) ? stats.upload_error_events : 0;
        const hasProcessingErrors = Number(stats.errors || 0) > 0;
        const cloudHasErrors = isCloudModeStats && hasProcessingErrors;

        const usedTrustManifest = !!stats.used_trust_manifest || (typeof stats.previously_processed === 'number' && stats.previously_processed > 0);
        const manifestTotalFiles = typeof stats.manifest_total_files === 'number' ? stats.manifest_total_files : null;
        const previousProcessed = typeof stats.previously_processed === 'number' ? stats.previously_processed : 0;
        const currentRunNew = typeof stats.current_run_new === 'number' ? stats.current_run_new : stats.success;
        const currentRunImages = typeof stats.current_run_images === 'number' ? stats.current_run_images : (stats.images || 0);
        const currentRunVideos = typeof stats.current_run_videos === 'number' ? stats.current_run_videos : (stats.videos || 0);
        const totalProcessedAcrossRuns = typeof stats.manifest_processed_count === 'number'
            ? stats.manifest_processed_count
            : previousProcessed + currentRunNew;

        const total = usedTrustManifest && manifestTotalFiles ? manifestTotalFiles : stats.success + stats.duplicates + stats.errors + (stats.skipped || 0);
        const newCount = usedTrustManifest ? currentRunNew : stats.success;
        const skippedCount = stats.duplicates;
        const displayTotal = manifestTotalFiles || total;

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
            headline = 'Success! Processing Complete.';
            subtext = 'Your memories have been successfully archived.';
        } else if (newCount > 0 && skippedCount > 0) {
            headline = 'Processing Complete!';
            subtext = `Saved ${newCount.toLocaleString()} new memories. We skipped ${skippedCount.toLocaleString()} files that were already in your folder.`;
        } else if (newCount === 0 && skippedCount > 0) {
            headline = 'You are Up to Date!';
            subtext = 'No new memories found. All files in this export already exist in your destination folder.';
        }

        if (!isCloudModeStats && hasProcessingErrors) {
            subtext = 'Completed with errors. Retry can redownload regular photo/video files; overlay memories may need a fresh full run.';
        }

        if (isCloudModeStats) {
            if (hasCloudDeliveryStats) {
                headline = 'Cloud Processing Complete!';
                if (cloudHasErrors) {
                    subtext = 'Completed with errors. Retry can redownload regular photo/video files; overlay memories may need a fresh full run.';
                } else {
                    subtext = 'Processing and cloud delivery completed.';
                }
            } else {
                headline = 'Cloud Processing Complete!';
                subtext = 'Processing complete. Cloud delivery details are unavailable for this run.';
            }
        }

        return {
            isCloudModeStats,
            hasCloudDeliveryStats,
            confirmedInDestination,
            copiedThisRun,
            alreadyInDestination,
            uploadErrorEvents,
            cloudHasErrors,
            usedTrustManifest,
            manifestTotalFiles,
            previousProcessed,
            currentRunNew,
            currentRunImages,
            currentRunVideos,
            totalProcessedAcrossRuns,
            total,
            newCount,
            skippedCount,
            displayTotal,
            headline,
            subtext
        };
    }

    function buildSuccessModalRows(stats, summary) {
        const items = [];
        items.push({
            type: 'row',
            label: 'Total Memories in Export:',
            value: summary.displayTotal.toLocaleString(),
            valueClass: '',
            isDivider: false
        });

        if (summary.usedTrustManifest && summary.manifestTotalFiles) {
            items.push({
                type: 'row',
                label: 'Total Processed Across All Runs:',
                value: `${summary.totalProcessedAcrossRuns.toLocaleString()} / ${summary.manifestTotalFiles.toLocaleString()}`,
                valueClass: 'green',
                isDivider: true
            });
            items.push({
                type: 'row',
                label: 'Images Saved (This Run):',
                value: summary.currentRunImages.toLocaleString(),
                valueClass: 'blue',
                isDivider: true
            });
            items.push({
                type: 'row',
                label: 'Videos Saved (This Run):',
                value: summary.currentRunVideos.toLocaleString(),
                valueClass: 'blue',
                isDivider: false
            });
            items.push({
                type: 'row',
                label: 'Previously Processed:',
                value: summary.previousProcessed.toLocaleString(),
                valueClass: 'blue',
                isDivider: true
            });
        } else {
            items.push({
                type: 'row',
                label: 'Images Downloaded:',
                value: (stats.images || 0).toLocaleString(),
                valueClass: 'blue',
                isDivider: true
            });
            items.push({
                type: 'row',
                label: 'Videos Downloaded:',
                value: (stats.videos || 0).toLocaleString(),
                valueClass: 'blue',
                isDivider: false
            });
            const reportSuccessCount = typeof stats.report_success_count === 'number' ? stats.report_success_count : stats.success;
            const actualFilesOnDisk = typeof stats.actual_files_on_disk === 'number' ? stats.actual_files_on_disk : stats.success;
            if (reportSuccessCount > actualFilesOnDisk) {
                items.push({
                    type: 'row',
                    label: 'Unique Memories Downloaded:',
                    value: actualFilesOnDisk.toLocaleString(),
                    valueClass: 'blue',
                    isDivider: false
                });
            }
        }

        if (summary.isCloudModeStats) {
            items.push({
                type: 'row',
                label: 'Delivered to Cloud Folder:',
                value: summary.confirmedInDestination.toLocaleString(),
                valueClass: summary.cloudHasErrors ? 'orange' : 'green',
                isDivider: true
            });
            items.push({
                type: 'row',
                label: 'Copied this run:',
                value: summary.copiedThisRun.toLocaleString(),
                valueClass: summary.cloudHasErrors ? 'orange' : 'green',
                isDivider: false
            });
            items.push({
                type: 'row',
                label: 'Already in Cloud Folder:',
                value: summary.alreadyInDestination.toLocaleString(),
                valueClass: summary.cloudHasErrors ? 'orange' : 'green',
                isDivider: false
            });
            if (summary.uploadErrorEvents > 0) {
                items.push({
                    type: 'row',
                    label: 'Upload Error Events:',
                    value: summary.uploadErrorEvents.toLocaleString(),
                    valueClass: 'orange',
                    isDivider: false
                });
            }
        }

        if (!summary.isCloudModeStats) {
            items.push({
                type: 'row',
                label: 'Already Existed (Skipped):',
                value: stats.duplicates.toLocaleString(),
                valueClass: 'orange',
                isDivider: true
            });
            if (stats.duplicates > 0) {
                items.push({
                    type: 'note',
                    noteClass: 'info',
                    text: `ℹ️ Skipped ${stats.duplicates.toLocaleString()} files that already exist in the destination folder.`,
                    style: null
                });
            }
        }

        items.push({
            type: 'row',
            label: 'Corrupted/Errors:',
            value: stats.errors.toString(),
            valueClass: 'red',
            isDivider: false
        });

        const cumulativeSuccessCount = summary.usedTrustManifest && typeof stats.manifest_processed_count === 'number'
            ? stats.manifest_processed_count
            : (typeof stats.report_success_count === 'number' ? stats.report_success_count : stats.success);
        const actualFilesOnDisk = typeof stats.actual_files_on_disk === 'number' ? stats.actual_files_on_disk : stats.success;
        if (cumulativeSuccessCount > actualFilesOnDisk) {
            const timestampCollisions = cumulativeSuccessCount - actualFilesOnDisk;
            items.push({
                type: 'note',
                noteClass: 'info',
                text: `ℹ️ ${timestampCollisions} ${timestampCollisions === 1 ? 'memory shares' : 'memories share'} identical timestamps - saved as single ${timestampCollisions === 1 ? 'file' : 'files'}`,
                style: { marginTop: '12px' }
            });
        }

        if (summary.manifestTotalFiles && !summary.isCloudModeStats) {
            const totalAccountedFor = cumulativeSuccessCount + stats.duplicates + stats.errors;
            if (totalAccountedFor === summary.manifestTotalFiles) {
                items.push({
                    type: 'note',
                    noteClass: 'success',
                    text: `✅ All ${summary.manifestTotalFiles.toLocaleString()} memories accounted for!`,
                    style: { marginTop: '12px', fontWeight: '600' }
                });
            }
        }

        if (summary.isCloudModeStats && summary.hasCloudDeliveryStats && summary.confirmedInDestination > 0) {
            const prefix = summary.cloudHasErrors ? 'ℹ️ Delivery summary:' : 'ℹ️ Delivered:';
            items.push({
                type: 'note',
                noteClass: 'info',
                text: `${prefix} ${summary.copiedThisRun.toLocaleString()} copied + ${summary.alreadyInDestination.toLocaleString()} already present = ${summary.confirmedInDestination.toLocaleString()} total. Errors: ${stats.errors.toLocaleString()}.`,
                style: { marginTop: '12px' }
            });
        }

        return items;
    }

    function buildNextStepsGuideState(stats = {}) {
        const isCloudMode = !!stats.auto_upload;
        const hasErrors = Number(stats.errors || 0) > 0;

        if (isCloudMode) {
            return {
                isCloudMode,
                intro: hasErrors
                    ? 'DateBack copied finished memories into your synced cloud folder, but this run finished with some errors.'
                    : 'DateBack already copied finished memories into your synced cloud folder.',
                showLocalStorageSection: false,
                showManualCloudUploadSection: false,
                showCloudDeliveredSection: true,
                cloudDeliveredCopy: hasErrors
                    ? 'Open your synced cloud folder and confirm the delivered Batch folders are present. Keep your cloud app running. Retry can redownload regular photo/video failures; overlay memories may need a fresh full run before you clean up local space.'
                    : 'Open your synced cloud folder and confirm the delivered Batch folders are present. Keep your cloud app running until it finishes syncing everything upstream.',
                cloudDeliveredFollowup: 'Keep the local working and staging folders until your cloud provider finishes. After that, you can remove local leftovers to reclaim disk space.',
                cloudFolderButtonLabel: 'Open Cloud Folder',
                storageTipTitle: 'Clean Up Local Space',
                storageTipText: 'After your cloud provider finishes uploading, you can delete DateBack\'s local working folder and any custom staging folder to reclaim disk space.',
                storageTipButtonLabel: 'Open Working Folder'
            };
        }

        return {
            isCloudMode,
            intro: 'Your memories are organized locally. You can leave them on your computer, back them up, or upload them elsewhere later.',
            showLocalStorageSection: true,
            showManualCloudUploadSection: true,
            showCloudDeliveredSection: false,
            cloudDeliveredCopy: '',
            cloudDeliveredFollowup: '',
            cloudFolderButtonLabel: 'Open Cloud Folder',
            storageTipTitle: 'Pro Tip: Free Up Space',
            storageTipText: 'Once your memories are safely backed up somewhere else, delete the local folder to reclaim disk space.',
            storageTipButtonLabel: 'Open Output Folder'
        };
    }

    function computeModeVisibilityState({
        mode,
        isProcessing,
        pauseAfterBatchChecked,
        advancedOpen,
        diskUsageMode
    }) {
        const cloudEnabled = mode === 'CLOUD';
        const computerEnabled = mode === 'COMPUTER';
        const manualMode = diskUsageMode === 'manual';
        const workingFolderHelpText = computeWorkingFolderHelpText(mode);
        const pauseAfterBatchState = computePauseAfterBatchState({
            computerEnabled,
            isProcessing,
            pauseAfterBatchChecked
        });

        return {
            cloudEnabled,
            computerEnabled,
            workingFolderHelpText,
            showWorkingFolderSection: computerEnabled,
            pauseAfterBatchDisabled: pauseAfterBatchState.pauseAfterBatchDisabled,
            shouldUncheckPauseAfterBatch: pauseAfterBatchState.shouldUncheckPauseAfterBatch,
            computerModeSettingsExpanded: computerEnabled,
            showCloudDestinationSection: cloudEnabled,
            showAutoUploadSettings: cloudEnabled,
            showHandoffHelperRow: false,
            showManualCacheSettings: cloudEnabled && manualMode && advancedOpen,
            showCacheAutoHint: cloudEnabled && !manualMode && advancedOpen,
            showAutoCachePreview: cloudEnabled && !manualMode && advancedOpen,
            shouldHideCacheLowSpaceWarning: !cloudEnabled || manualMode || !advancedOpen,
            disableComputerModeCheckbox: isProcessing,
            disableCloudModeCheckbox: isProcessing,
            computerCardSelected: computerEnabled,
            cloudCardSelected: cloudEnabled,
            computerModeDescriptionHidden: cloudEnabled,
            computerModeDisabledHintHidden: !cloudEnabled,
            cloudModeDescriptionHidden: computerEnabled,
            cloudModeDisabledHintHidden: !computerEnabled,
            shouldHideCloudDestinationError: !cloudEnabled,
            shouldHideSyncFolderWarning: !cloudEnabled,
            shouldRefreshCloudHelpers: cloudEnabled
        };
    }

    return {
        computeWorkingFolderHelpText,
        computePauseAfterBatchState,
        computeStorageEstimates,
        computeStorageWarningState,
        computeProcessingUiState,
        buildSuccessModalCopy,
        buildSuccessModalRows,
        buildNextStepsGuideState,
        resolveStorageMode,
        buildStartProcessingArgs,
        resolveRunModeFlags,
        computeModeVisibilityState
    };
});
