// Shared constants for the main process.
// Renderer-side constants live as named consts at the top of renderer.js (no require() in sandbox).

module.exports = {
    // Cloud upload defaults (CLI args)
    DEFAULT_CACHE_GB: 5.0,
    DEFAULT_CACHE_LOW_GB: 3.0,
    DEFAULT_MAX_UPLOAD_RETRIES: 20,

    // ZIP validation
    MAX_ZIP_ENTRIES: 100000,
};
