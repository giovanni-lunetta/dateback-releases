/**
 * supportLogs.js - Privacy-first support logs export (NON-BLOCKING + HARDENED)
 * 
 * Features:
 * - Memory-efficient log collection
 * - Stream-based time range scanning (no full file reads)
 * - Enhanced privacy in system.json
 * - ZIP export with complete metadata
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');
const { createReadStream } = require('fs');
const { createInterface } = require('readline');
const AdmZip = require('adm-zip');

class SupportLogs {
    constructor(logger) {
        this.logger = logger;
        this.logDir = logger.getLogDirectory();
    }

    /**
     * Get all log files from the last 7 days
     */
    collectLogFiles() {
        try {
            const files = fs.readdirSync(this.logDir);
            const logFiles = files.filter(f => f.endsWith('.log') || f.includes('.part'));

            const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

            const recentLogs = logFiles.filter(file => {
                const filePath = path.join(this.logDir, file);
                try {
                    const stats = fs.statSync(filePath);
                    return stats.mtime.getTime() >= sevenDaysAgo;
                } catch (e) {
                    return false;
                }
            }).map(file => path.join(this.logDir, file));

            return recentLogs;
        } catch (error) {
            this.logger.error('Failed to collect log files', { error: error.message });
            return [];
        }
    }

    /**
     * Get time range covered by logs (STREAM-BASED, memory-efficient)
     * Reads first and last valid JSON lines without loading entire file
     */
    async getLogTimeRange(logFiles) {
        let earliest = null;
        let latest = null;

        for (const filePath of logFiles) {
            try {
                // Get first timestamp (read first valid JSON line)
                const firstTimestamp = await this.getFirstTimestamp(filePath);
                if (firstTimestamp) {
                    const firstTime = new Date(firstTimestamp);
                    if (!earliest || firstTime < earliest) {
                        earliest = firstTime;
                    }
                }

                // Get last timestamp (read last lines until valid JSON found)
                const lastTimestamp = await this.getLastTimestamp(filePath);
                if (lastTimestamp) {
                    const lastTime = new Date(lastTimestamp);
                    if (!latest || lastTime > latest) {
                        latest = lastTime;
                    }
                }
            } catch (error) {
                // Skip malformed log files
                this.logger.warn('Failed to parse log file for time range', {
                    file: path.basename(filePath),
                    error: error.message
                });
            }
        }

        return {
            start: earliest ? earliest.toISOString() : null,
            end: latest ? latest.toISOString() : null
        };
    }

    /**
     * Get first timestamp from log file (stream-based)
     */
    async getFirstTimestamp(filePath) {
        return new Promise((resolve) => {
            const stream = createReadStream(filePath, { encoding: 'utf8' });
            const rl = createInterface({ input: stream });

            rl.on('line', (line) => {
                try {
                    const entry = JSON.parse(line.trim());
                    if (entry.timestamp) {
                        rl.close();
                        stream.destroy();
                        resolve(entry.timestamp);
                    }
                } catch (e) {
                    // Skip invalid JSON lines
                }
            });

            rl.on('close', () => resolve(null));
            rl.on('error', () => resolve(null));
        });
    }

    /**
     * Get last timestamp from log file (read last N lines)
     */
    async getLastTimestamp(filePath) {
        try {
            const { size } = await fs.promises.stat(filePath);
            const readSize = Math.min(4096, size);
            const buffer = Buffer.alloc(readSize);
            const fh = await fs.promises.open(filePath, 'r');
            try {
                await fh.read(buffer, 0, readSize, size - readSize);
            } finally {
                await fh.close();
            }
            const lines = buffer.toString('utf8').split('\n').filter(l => l.trim()).reverse();
            for (const line of lines) {
                try {
                    const entry = JSON.parse(line.trim());
                    if (entry.timestamp) return entry.timestamp;
                } catch {
                    // skip invalid JSON
                }
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * Generate system.json metadata (privacy-hardened)
     */
    async generateSystemInfo(logFiles) {
        const timeRange = await this.getLogTimeRange(logFiles);

        return {
            appName: app.getName(),
            appVersion: app.getVersion(),
            buildNumber: app.getVersion(), // Can be enhanced with separate build number
            platform: process.platform,
            arch: process.arch,
            osVersion: `${os.type()} ${os.release()}`,
            nodeVersion: process.versions.node,
            electronVersion: process.versions.electron,
            exportedAt: new Date().toISOString(),
            logsIncluded: logFiles.map(f => path.basename(f)), // Only basenames, no full paths
            timeRange: timeRange,
            features: {
                cloudMode: null, // Populated if available
                totalLogSizeMB: this.getTotalLogSize(logFiles)
            }
        };
    }

    /**
     * Get total size of log files (in MB)
     */
    getTotalLogSize(logFiles) {
        let totalBytes = 0;
        logFiles.forEach(filePath => {
            try {
                const stats = fs.statSync(filePath);
                totalBytes += stats.size;
            } catch (e) {
                // Skip files that can't be read
            }
        });
        return (totalBytes / (1024 * 1024)).toFixed(2);
    }

    /**
     * Create support logs ZIP file (privacy-hardened)
     * @param {string} savePath - Where to save the ZIP file
     * @returns {Promise<string>} - Path to created ZIP file
     */
    async createSupportZip(savePath) {
        try {
            // Privacy: Only log basename, not full savePath
            this.logger.info('Creating support logs ZIP', {
                filename: path.basename(savePath)
            });

            // Collect log files
            const logFiles = this.collectLogFiles();

            if (logFiles.length === 0) {
                throw new Error('No log files found to export');
            }

            // Generate system info
            const systemInfo = await this.generateSystemInfo(logFiles);

            // Create ZIP
            const zip = new AdmZip();

            // Add system.json
            zip.addFile('system.json', Buffer.from(JSON.stringify(systemInfo, null, 2), 'utf8'));

            // Add each log file under logs/ directory
            logFiles.forEach(logFilePath => {
                const filename = path.basename(logFilePath);
                const content = fs.readFileSync(logFilePath);
                zip.addFile(`logs/${filename}`, content);
            });

            // Write ZIP file
            zip.writeZip(savePath);

            this.logger.info('Support logs ZIP created successfully', {
                filename: path.basename(savePath),
                fileCount: logFiles.length,
                sizeKB: (fs.statSync(savePath).size / 1024).toFixed(2)
            });

            return savePath;
        } catch (error) {
            this.logger.error('Failed to create support logs ZIP', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Generate default filename for support logs ZIP
     */
    getDefaultZipFilename() {
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
        const timeStr = now.toISOString().split('T')[1].split('.')[0].replace(/:/g, ''); // HHMMSS
        return `DateBack-SupportLogs-${dateStr}-${timeStr}.zip`;
    }

    /**
     * Generate error report string for copying to clipboard
     * @param {Error} error - The error object
     * @param {string} step - What step was executing
     * @param {object} context - Additional context (e.g., ffmpeg exit code)
     */
    generateErrorReport(error, step = 'Unknown', context = {}) {
        const lines = [
            '=== DateBack Error Report ===',
            `App Version: ${app.getVersion()}`,
            `Platform: ${process.platform} ${process.arch}`,
            `OS: ${os.type()} ${os.release()}`,
            `Timestamp: ${new Date().toISOString()}`,
            '',
            `Step: ${step}`,
            `Error: ${error.message}`,
            ''
        ];

        if (context.ffmpegExitCode !== undefined) {
            lines.push(`FFmpeg Exit Code: ${context.ffmpegExitCode}`);
        }

        if (context.pythonExitCode !== undefined) {
            lines.push(`Python Exit Code: ${context.pythonExitCode}`);
        }

        if (context.filesProcessed !== undefined) {
            lines.push(`Files Processed: ${context.filesProcessed}`);
        }

        if (error.stack) {
            lines.push('');
            lines.push('Stack Trace (redacted):');
            lines.push(this.logger.redactPath(error.stack));
        }

        lines.push('');
        lines.push('=== End Report ===');
        lines.push('');
        lines.push('To resolve this issue:');
        lines.push('1. Try the "Export Support Logs" feature (Help menu)');
        lines.push('2. Email the generated ZIP file to support@dateback.app');
        lines.push('3. Include this error report in your email');

        return lines.join('\n');
    }
}

module.exports = SupportLogs;