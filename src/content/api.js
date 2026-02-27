/**
 * api.js
 * Extracted Canvas API resolution logic.
 */

window.CanvasDownloader = window.CanvasDownloader || {};

window.CanvasDownloader.transformDownloadUrl = function (urlStr) {
    try {
        const u = new URL(urlStr);
        // Dynamic: a Canvas link is one on the same hostname as the current page
        const isCanvasLink = u.hostname === window.location.hostname;

        if (!isCanvasLink) return { url: urlStr, isExternal: true };

        // --- NEW FIX FOR MODULE LINKS ---
        if (u.searchParams.has('module_item_id')) {
            u.searchParams.delete('module_item_id');
        }
        // --------------------------------

        if (u.pathname.includes('/files')) {
            const verifier = u.searchParams.get('verifier');
            const previewId = u.searchParams.get('preview');

            // Handle "Preview" wrapper links
            if (u.pathname.endsWith('/files') && previewId) {
                u.pathname += `/${previewId}/download`;
                u.searchParams.delete('preview');
                u.searchParams.delete('wrap');
            } else {
                // Handle standard file links
                u.searchParams.delete('wrap');
                u.searchParams.delete('preview');
                if (!u.pathname.endsWith('/download')) {
                    u.pathname = u.pathname.replace(/\/+$/, '') + '/download';
                }
            }

            if (verifier) u.searchParams.set('verifier', verifier);

            // Force the "File Read" download mode
            u.searchParams.set('download_frd', '1');

            return { url: u.href, isExternal: false };
        }
        return { url: u.href, isExternal: false };
    } catch (e) {
        return { url: urlStr, isExternal: false };
    }
};

window.CanvasDownloader.resolveFileUrl = async function (file) {
    try {
        const u = new URL(file.href);

        // Already a direct CDN link
        if (file.href.includes('canvas-user-content.com')) return file.href;

        // Canvas API strategy for /files/ URLs
        const fileIdMatch = u.pathname.match(/\/files\/(\d+)/);
        if (fileIdMatch) {
            const fileId = fileIdMatch[1];
            const apiUrl = `${u.origin}/api/v1/files/${fileId}`;
            try {
                const response = await fetch(apiUrl, { credentials: 'include' });
                if (response.ok) {
                    const data = await response.json();
                    if (data.url) return data.url;
                }
            } catch (e) {
                // API failed, fall through
            }
            return null; // Strict: if Canvas API fails, don't risk .htm
        }

        // External files: check content type
        try {
            const response = await fetch(u.href, { method: 'HEAD', credentials: 'include' });
            if (!response.ok) return null;
            const type = response.headers.get('Content-Type');
            if (type && type.includes('text/html')) {
                // Try to unpack wrapper page
                return await window.CanvasDownloader.unpackIntermediatePage(u.href);
            }
            return u.href;
        } catch (e) {
            return null;
        }
    } catch (e) {
        return null;
    }
};

window.CanvasDownloader.unpackIntermediatePage = async function (wrapperUrl) {
    try {
        const response = await fetch(wrapperUrl, { credentials: 'include' });
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const selectors = [
            'a[href$=".pdf"]', 'a[href$=".docx"]', 'a[href$=".pptx"]',
            'a[href$=".zip"]', 'a[href$=".xlsx"]',
            'a[href*="/files/"][href*="/download"]',
            'a.download-button', '.instructure_file_link', '#download_url'
        ];
        for (const selector of selectors) {
            const link = doc.querySelector(selector);
            if (link && link.getAttribute('href')) {
                const absolute = new URL(link.getAttribute('href'), wrapperUrl).href;
                if (absolute !== wrapperUrl) return absolute;
            }
        }
        return null;
    } catch (e) {
        return null;
    }
};
