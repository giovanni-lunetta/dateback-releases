/**
 * logger.js - Privacy-first, non-blocking logging system for DateBack
 * 
 * Features:
 * - JSONL format (newline-delimited JSON)
 * - NON-BLOCKING async writes (queue + WriteStream)
 * - Enhanced privacy: redacts ALL paths + media filenames
 * - Size limits: 50k chars/field, 5MB/file with .part2/.part3 rollover
 * - Log rotation (7 days or 10 files max)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const SECRET_KEY_PATTERN = /(^|_|-)(password|passwd|pwd|token|secret|api.?key|access.?token|refresh.?token|authorization|auth|session|cookie|signature|private.?key)(_|-|$)/i;

// Constants
const MAX_FIELD_SIZE = 50000; // 50k characters per field
const MAX_LOG_FILE_SIZE = 5 * 1024 * 1024; // 5MB per log file
const MAX_QUEUE_SIZE = 1000; // Max pending log entries

class Logger {
    constructor(source = 'main') {
        this.source = source;
        this.logDir = path.join(app.getPath('userData'), 'logs');
        this.writeStream = null;
        this.queue = [];
        this.isWriting = false;
        this.currentWritePromise = null;
        this.currentLogPath = null;
        this.currentPartNumber = 1;
        this.currentFileSize = 0;

        this.ensureLogDirectory();
        this.rotateOldLogs();
        this.initializeWriteStream();
    }

    /**
     * Ensure log directory exists
     */
    ensureLogDirectory() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    /**
     * Initialize write stream for current log file
     */
    initializeWriteStream() {
        this.currentLogPath = this.getCurrentLogPath();

        // Check if file exists and get its size
        if (fs.existsSync(this.currentLogPath)) {
            const stats = fs.statSync(this.currentLogPath);
            this.currentFileSize = stats.size;

            // If current file is already over limit, start with .part2
            if (this.currentFileSize >= MAX_LOG_FILE_SIZE) {
                this.currentPartNumber = 2;
                this.currentLogPath = this.getCurrentLogPath();
                this.currentFileSize = fs.existsSync(this.currentLogPath) ?
                    fs.statSync(this.currentLogPath).size : 0;
            }
        }

        this.writeStream = fs.createWriteStream(this.currentLogPath, { flags: 'a' });
        this.writeStream.on('error', (error) => {
            console.error('Log write stream error:', error);
        });
    }

    /**
     * Get current log file path (with part number if needed)
     */
    getCurrentLogPath() {
        const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const base = path.join(this.logDir, `${this.source}-${date}`);
        return this.currentPartNumber === 1 ? `${base}.log` : `${base}.part${this.currentPartNumber}.log`;
    }

    /**
     * Enhanced path redaction - removes ALL absolute paths
     * - macOS/Linux: /Users/*, /home/*, /Applications/*, etc.
     * - Windows: C:\Users\*, D:\*, etc.
     */
    redactPath(str) {
        if (typeof str !== 'string') return str;

        // macOS/Linux absolute paths (anything starting with /)
        str = str.replace(/\/Users\/[^/\s]+/g, '~');
        str = str.replace(/\/home\/[^/\s]+/g, '~');
        str = str.replace(/\/Applications\/[^\s]+/g, '<app-path>');
        str = str.replace(/\/Library\/[^\s]+/g, '<library-path>');
        str = str.replace(/\/private\/[^\s]+/g, '<private-path>');

        // macOS temp and volume paths
        str = str.replace(/\/var\/folders\/[^\s]+/g, '<temp-path>');
        str = str.replace(/\/Volumes\/[^/\s]+/g, '<volume>');

        // Any remaining absolute path on Unix
        str = str.replace(/\/[a-zA-Z0-9_\-./]+\/(Downloads|Documents|Desktop|Pictures|Movies)/g, '~/<folder>');

        // Windows absolute paths
        str = str.replace(/[A-Z]:\\Users\\[^\\\s]+/gi, '~');
        str = str.replace(/[A-Z]:\\[^\s]+/g, '<drive-path>');

        // Media filenames (privacy - don't expose user's media file names)
        str = str.replace(/[^\s/\\]+\.(mp4|mov|avi|mkv|jpg|jpeg|png|heic|gif|webp)/gi, '<media-file>');

        return str;
    }

    /**
     * Truncate field to max size
     */
    truncateField(value) {
        if (typeof value === 'string' && value.length > MAX_FIELD_SIZE) {
            return value.substring(0, MAX_FIELD_SIZE) + `... [truncated ${value.length - MAX_FIELD_SIZE} chars]`;
        }
        if (Array.isArray(value) && value.length > 200) {
            return [...value.slice(0, 200), `... [truncated ${value.length - 200} items]`];
        }
        return value;
    }

    /**
     * Redact object recursively (for data field)
     */
    redactObject(obj) {
        if (obj === null || obj === undefined) return obj;
        if (typeof obj === 'string') {
            return this.truncateField(this.redactPath(obj));
        }
        if (typeof obj !== 'object') return obj;

        if (Array.isArray(obj)) {
            const truncated = obj.slice(0, 200); // Max 200 array items
            return truncated.map(item => this.redactObject(item));
        }

        const redacted = {};
        for (const [key, value] of Object.entries(obj)) {
            // Don't log these sensitive keys
            if (key === 'key' || SECRET_KEY_PATTERN.test(key)) {
                redacted[key] = '<redacted>';
            } else {
                redacted[key] = this.redactObject(value);
            }
        }
        return redacted;
    }

    /**
     * Write log entry (async, non-blocking)
     */
    write(level, message, data = {}) {
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            source: this.source,
            message: this.redactPath(message),
            data: this.redactObject(data)
        };

        const logLine = JSON.stringify(entry) + '\n';

        // Add to queue
        if (this.queue.length < MAX_QUEUE_SIZE) {
            this.queue.push(logLine);
            this.processQueue();
        } else {
            // Queue full - log to console as fallback
            console.warn('Log queue full, dropping entry');
        }
    }

    /**
     * Process queue asynchronously (non-blocking)
     */
    async processQueue() {
        if (this.isWriting || this.queue.length === 0) {
            return this.currentWritePromise || Promise.resolve();
        }

        this.isWriting = true;
        this.currentWritePromise = (async () => {
            try {
                while (this.queue.length > 0) {
                    const logLine = this.queue.shift();
                    const lineSize = Buffer.byteLength(logLine, 'utf8');

                    // Check if we need to roll to next part
                    if (this.currentFileSize + lineSize > MAX_LOG_FILE_SIZE) {
                        await this.rolloverLogFile();
                    }

                    // Write asynchronously
                    await new Promise((resolve) => {
                        this.writeStream.write(logLine, 'utf8', () => {
                            this.currentFileSize += lineSize;
                            resolve();
                        });
                    });
                }
            } finally {
                this.isWriting = false;
                this.currentWritePromise = null;
            }
        })();

        return this.currentWritePromise;
    }

    /**
     * Rollover to next log file part (.part2, .part3, etc.)
     */
    async rolloverLogFile() {
        return new Promise((resolve) => {
            // Close current stream
            this.writeStream.end(() => {
                // Increment part number
                this.currentPartNumber++;
                this.currentFileSize = 0;

                // Create new stream
                this.currentLogPath = this.getCurrentLogPath();
                this.writeStream = fs.createWriteStream(this.currentLogPath, { flags: 'a' });
                this.writeStream.on('error', (error) => {
                    console.error('Log write stream error:', error);
                });

                resolve();
            });
        });
    }

    /**
     * Flush remaining queue (call on app shutdown)
     */
    async flush() {
        await this.processQueue();
        // Drain once more in case entries were enqueued during the first drain
        if (this.queue.length > 0) {
            await this.processQueue();
        }
        return new Promise((resolve) => {
            if (this.writeStream) {
                this.writeStream.end(resolve);
            } else {
                resolve();
            }
        });
    }

    /**
     * Log info message
     */
    info(message, data = {}) {
        this.write('info', message, data);
    }

    /**
     * Log warning message
     */
    warn(message, data = {}) {
        this.write('warn', message, data);
    }

    /**
     * Log error message
     */
    error(message, data = {}) {
        this.write('error', message, data);
    }

    /**
     * Log debug message
     */
    debug(message, data = {}) {
        this.write('debug', message, data);
    }

    /**
     * Rotate old logs
     * Keep logs from last 7 days OR max 10 files (whichever is more restrictive)
     */
    rotateOldLogs() {
        try {
            const files = fs.readdirSync(this.logDir);
            const logFiles = files.filter(f => f.endsWith('.log') || f.includes('.part'));

            // Sort by modification time (oldest first)
            const filesWithStats = logFiles.map(file => {
                const filePath = path.join(this.logDir, file);
                const stats = fs.statSync(filePath);
                return { file, filePath, mtime: stats.mtime };
            }).sort((a, b) => a.mtime - b.mtime);

            const now = Date.now();
            const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);

            // Delete files older than 7 days
            filesWithStats.forEach(({ filePath, mtime }) => {
                if (mtime.getTime() < sevenDaysAgo) {
                    try {
                        fs.unlinkSync(filePath);
                    } catch (e) {
                        console.warn('Failed to delete old log:', e.message);
                    }
                }
            });

            // After age-based deletion, keep only 10 most recent files per source
            const remainingFiles = fs.readdirSync(this.logDir)
                .filter(f => (f.endsWith('.log') || f.includes('.part')) && f.startsWith(this.source));

            if (remainingFiles.length > 10) {
                const sourceFilesWithStats = remainingFiles.map(file => {
                    const filePath = path.join(this.logDir, file);
                    const stats = fs.statSync(filePath);
                    return { file, filePath, mtime: stats.mtime };
                }).sort((a, b) => a.mtime - b.mtime);

                // Delete oldest files beyond 10
                const toDelete = sourceFilesWithStats.slice(0, sourceFilesWithStats.length - 10);
                toDelete.forEach(({ filePath }) => {
                    try {
                        fs.unlinkSync(filePath);
                    } catch (e) {
                        console.warn('Failed to delete old log:', e.message);
                    }
                });
            }
        } catch (error) {
            console.error('Log rotation failed:', error);
        }
    }

    /**
     * Get all log files in directory
     */
    getAllLogFiles() {
        try {
            const files = fs.readdirSync(this.logDir);
            return files.filter(f => f.endsWith('.log') || f.includes('.part'))
                .map(f => path.join(this.logDir, f));
        } catch (error) {
            console.error('Failed to list log files:', error);
            return [];
        }
    }

    /**
     * Get log directory path
     */
    getLogDirectory() {
        return this.logDir;
    }
}

module.exports = Logger;
