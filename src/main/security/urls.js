const { shell } = require('electron');

const ALLOWED_EXTERNAL_HOSTS = new Set([
    'dateback.app',
    'www.dateback.app',
    'accounts.snapchat.com',
    'photos.google.com',
    'buymeacoffee.com',
    'www.buymeacoffee.com'
]);
const ALLOWED_MAILTO_RECIPIENTS = new Set(['support@dateback.app']);
const ALLOWED_MAILTO_QUERY_KEYS = new Set(['subject', 'body']);

function validateExternalUrlPolicy(rawUrl) {
    let parsedUrl;
    try {
        parsedUrl = new URL(rawUrl);
    } catch {
        return { success: false, error: 'Invalid URL' };
    }

    if (parsedUrl.protocol === 'mailto:') {
        let recipient = '';
        try {
            recipient = decodeURIComponent(parsedUrl.pathname || '').trim().toLowerCase();
        } catch {
            return { success: false, error: 'Invalid URL' };
        }
        if (!recipient || !ALLOWED_MAILTO_RECIPIENTS.has(recipient)) {
            return { success: false, error: 'Email recipient is not allowed' };
        }
        for (const key of parsedUrl.searchParams.keys()) {
            if (!ALLOWED_MAILTO_QUERY_KEYS.has(key.toLowerCase())) {
                return { success: false, error: 'Email query parameter is not allowed' };
            }
        }
        return null;
    }

    if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
        const hostname = parsedUrl.hostname.toLowerCase().replace(/\.$/, '');
        if (!ALLOWED_EXTERNAL_HOSTS.has(hostname)) {
            return { success: false, error: 'URL host is not allowed' };
        }
        return null;
    }

    return { success: false, error: `Protocol ${parsedUrl.protocol} is not allowed` };
}

// Security: Safely open external URLs with protocol, host, and recipient allowlists.
function openExternalSafely(rawUrl) {
    const policyResponse = validateExternalUrlPolicy(rawUrl);
    if (policyResponse) {
        console.error(`[SECURITY] Blocked openExternal: ${policyResponse.error}`);
        return policyResponse;
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(rawUrl);
    } catch {
        console.error(`[SECURITY] Invalid URL passed to openExternal: ${rawUrl}`);
        return { success: false, error: 'Invalid URL' };
    }

    shell.openExternal(parsedUrl.toString());
    return { success: true };
}

module.exports = {
    ALLOWED_EXTERNAL_HOSTS,
    ALLOWED_MAILTO_RECIPIENTS,
    ALLOWED_MAILTO_QUERY_KEYS,
    validateExternalUrlPolicy,
    openExternalSafely
};
