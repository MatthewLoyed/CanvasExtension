/**
 * api.js
 * Extracted Canvas API resolution logic.
 */

window.CanvasDownloader = window.CanvasDownloader || {};

// ============================================================
// Shared Filename Utilities
// Used by both content.js (surface scrape) and api.js (deep scan)
// ============================================================

/**
 * Check if link text is generic/unhelpful and shouldn't be used as a filename.
 * Examples: "PDF", "Download", "Click Here", "File", ".docx", "Word Document"
 *
 * @param {string} text - The link's display text.
 * @returns {boolean} True if the text is generic.
 */
window.CanvasDownloader.isGenericLinkText = function (text) {
    if (!text) return true;
    const t = text.trim().toLowerCase();
    if (t.length === 0) return true;

    const GENERIC_PATTERNS = [
        /^\.?pdf$/,
        /^\.?docx?$/,
        /^\.?pptx?$/,
        /^\.?xlsx?$/,
        /^\.?zip$/,
        /^\.?txt$/,
        /^download$/,
        /^download file$/,
        /^click here$/,
        /^here$/,
        /^link$/,
        /^file$/,
        /^view$/,
        /^open$/,
        /^word\s*doc(ument)?$/,
        /^powerpoint$/,
        /^spreadsheet$/,
        /^no text$/,
        /^unknown file$/
    ];

    return GENERIC_PATTERNS.some(p => p.test(t));
};

/**
 * Extract a human-readable filename from a URL path.
 * Strips trailing "/download", removes query/hash, decodes URI components,
 * and replaces underscores/hyphens with spaces for readability.
 *
 * @param {string} href - The absolute URL.
 * @returns {string|null} A cleaned filename, or null if nothing useful found.
 */
window.CanvasDownloader.extractFilenameFromUrl = function (href) {
    try {
        const u = new URL(href);
        let path = u.pathname;

        // Strip trailing /download
        path = path.replace(/\/download\/?$/, '');

        // Get the last segment
        const segments = path.split('/').filter(Boolean);
        if (segments.length === 0) return null;

        let lastSegment = segments[segments.length - 1];

        // Skip if it's just a numeric ID (e.g., /files/12345)
        if (/^\d+$/.test(lastSegment)) return null;

        // Decode URI component (e.g., %20 → space)
        lastSegment = decodeURIComponent(lastSegment);

        // If it has a file extension, keep it as-is (just clean up separators)
        // Otherwise return null — it's not a useful filename
        if (!/\.[a-z0-9]{2,5}$/i.test(lastSegment)) return null;

        return lastSegment;
    } catch (e) {
        return null;
    }
};

/**
 * Map a MIME Content-Type to a file extension.
 * Used to resolve the actual type when the parser only detected 'file'.
 *
 * @param {string} contentType - The Content-Type header value (e.g., 'application/pdf').
 * @returns {string|null} The extension (e.g., '.pdf') or null if unmapped.
 */
window.CanvasDownloader.mimeToExtension = function (contentType) {
    if (!contentType) return null;
    const mime = contentType.split(';')[0].trim().toLowerCase();

    const MIME_MAP = {
        'application/pdf': '.pdf',
        'application/msword': '.doc',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
        'application/vnd.ms-powerpoint': '.ppt',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
        'application/vnd.ms-excel': '.xls',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
        'application/zip': '.zip',
        'application/x-zip-compressed': '.zip',
        'text/plain': '.txt',
    };

    return MIME_MAP[mime] || null;
};

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

                    // Refine type from API response when we only detected 'file'
                    if (file.type === 'file' && data) {
                        // Try content-type header from API response
                        const mimeExt = window.CanvasDownloader.mimeToExtension(data['content-type']);
                        if (mimeExt) {
                            file.resolvedType = mimeExt;
                        }
                        // Also try extracting extension from the API filename
                        if (!file.resolvedType && data.filename) {
                            const fnMatch = data.filename.match(/\.([a-z0-9]{2,5})$/i);
                            if (fnMatch) {
                                file.resolvedType = '.' + fnMatch[1].toLowerCase();
                            }
                        }
                        // Also update display name if ours is generic
                        if (data.display_name && window.CanvasDownloader.isGenericLinkText(file.text)) {
                            file.resolvedName = data.display_name;
                        }
                    }

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
            // Refine type from Content-Type header for external files
            if (file.type === 'file' && type) {
                const mimeExt = window.CanvasDownloader.mimeToExtension(type);
                if (mimeExt) {
                    file.resolvedType = mimeExt;
                }
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

// ============================================================
// Deep Scan — Phase 1: API Module Fetching
// These functions are isolated and not called by existing code.
// They provide the foundation for the Deep Scan feature.
// ============================================================

/**
 * Extract the Canvas course ID from the current page.
 * Tries URL path first, then falls back to Canvas ENV object.
 * 
 * @returns {string|null} The course ID, or null if not on a course page.
 */
window.CanvasDownloader.extractCourseId = function () {
    // Strategy 1: Parse from URL path (most reliable)
    const match = window.location.pathname.match(/\/courses\/(\d+)/);
    if (match) return match[1];

    // Strategy 2: Canvas ENV object (set on every Canvas page)
    if (typeof window.ENV !== 'undefined' && window.ENV.COURSE_ID) {
        return String(window.ENV.COURSE_ID);
    }

    return null;
};

/**
 * Generic paginated Canvas API fetcher.
 * Follows Link headers to collect all pages of results.
 * Includes rate-limit awareness via X-Rate-Limit-Remaining header.
 * 
 * @param {string} url - The initial API URL (with query params).
 * @param {number} delayMs - Delay between paginated requests (default 800ms).
 * @param {function|null} onProgress - Optional callback(pageNumber) for progress.
 * @returns {Promise<Array>} All results concatenated across pages.
 */
window.CanvasDownloader.fetchCanvasApi = async function (url, delayMs = 800, onProgress = null) {
    const allResults = [];
    let nextUrl = url;
    let pageNum = 0;

    while (nextUrl) {
        pageNum++;
        if (onProgress) onProgress(pageNum);

        const response = await fetch(nextUrl, { credentials: 'include' });

        // Handle rate limiting
        if (response.status === 429) {
            const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
            console.warn(`[Canvas Downloader] Rate limited. Waiting ${retryAfter}s...`);
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            continue; // Retry same URL
        }

        if (!response.ok) {
            console.error(`[Canvas Downloader] API error ${response.status} for ${nextUrl}`);
            break;
        }

        // Check remaining rate limit budget
        const remaining = response.headers.get('X-Rate-Limit-Remaining');
        if (remaining !== null && parseFloat(remaining) < 50) {
            console.warn(`[Canvas Downloader] Rate limit low (${remaining}). Adding extra delay.`);
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        const data = await response.json();

        if (Array.isArray(data)) {
            allResults.push(...data);
        } else {
            allResults.push(data);
        }

        // Parse Link header for next page
        nextUrl = parseLinkHeader(response.headers.get('Link'));

        // Rate-limit delay between pages
        if (nextUrl) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    return allResults;
};

/**
 * Parse the Link header to extract the "next" page URL.
 * Canvas returns: <https://...?page=2&per_page=50>; rel="next", ...
 * 
 * @param {string|null} linkHeader - The raw Link header value.
 * @returns {string|null} The next page URL, or null if no more pages.
 */
function parseLinkHeader(linkHeader) {
    if (!linkHeader) return null;

    const parts = linkHeader.split(',');
    for (const part of parts) {
        const match = part.match(/<([^>]+)>;\s*rel="next"/);
        if (match) return match[1];
    }

    return null;
}

/**
 * Fetch all modules and their items for a course.
 * Uses the Canvas Modules API with include[]=items and include[]=content_details.
 * 
 * @param {string} courseId - The Canvas course ID.
 * @param {function|null} onProgress - Optional callback(pageNumber) for progress.
 * @returns {Promise<Array>} Array of module objects, each with an `items` array.
 */
window.CanvasDownloader.fetchCourseModules = async function (courseId, onProgress = null) {
    const origin = window.location.origin;
    const url = `${origin}/api/v1/courses/${courseId}/modules?include[]=items&include[]=content_details&per_page=50`;

    const modules = await window.CanvasDownloader.fetchCanvasApi(url, 800, onProgress);
    return modules;
};

/**
 * Categorize module items by type into actionable buckets.
 * This tells the deep scan which items to fetch further and which to skip.
 * 
 * @param {Array} modules - Array of module objects from fetchCourseModules().
 * @returns {Object} { files: [...], pages: [...], skipped: [...] }
 *   - files: items of type "File" (can be downloaded directly via content_id)
 *   - pages: items of type "Page" (need body fetched to find embedded file links)
 *   - skipped: items of other types (SubHeader, ExternalUrl, ExternalTool, etc.)
 */
window.CanvasDownloader.categorizeModuleItems = function (modules) {
    const result = { files: [], pages: [], skipped: [] };

    for (const mod of modules) {
        const items = mod.items || [];
        for (const item of items) {
            const enrichedItem = {
                ...item,
                moduleName: mod.name || 'Unknown Module',
                moduleId: mod.id
            };

            switch (item.type) {
                case 'File':
                    result.files.push(enrichedItem);
                    break;
                case 'Page':
                    result.pages.push(enrichedItem);
                    break;
                default:
                    result.skipped.push(enrichedItem);
                    break;
            }
        }
    }

    return result;
};

// ============================================================
// Deep Scan — Phase 2: Page Body Parsing
// These functions fetch Canvas Page content and extract file links.
// ============================================================

/**
 * Fetch the HTML body of a single Canvas wiki page via the Pages API.
 * 
 * @param {string} courseId - The Canvas course ID.
 * @param {string} pageUrl - The page URL slug (e.g., 'day-1-course-introduction-and-operating-systems-overview').
 * @returns {Promise<{title: string, body: string}|null>} Page data with title and HTML body, or null on error.
 */
window.CanvasDownloader.fetchPageBody = async function (courseId, pageUrl) {
    const origin = window.location.origin;
    const apiUrl = `${origin}/api/v1/courses/${courseId}/pages/${encodeURIComponent(pageUrl)}`;

    try {
        const response = await fetch(apiUrl, { credentials: 'include' });

        if (response.status === 429) {
            const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
            console.warn(`[Canvas Downloader] Rate limited on page fetch. Waiting ${retryAfter}s...`);
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            return window.CanvasDownloader.fetchPageBody(courseId, pageUrl); // Retry once
        }

        if (!response.ok) {
            console.warn(`[Canvas Downloader] Could not fetch page "${pageUrl}": ${response.status}`);
            return null;
        }

        const data = await response.json();
        return { title: data.title || '', body: data.body || '' };
    } catch (e) {
        console.error(`[Canvas Downloader] Error fetching page "${pageUrl}":`, e);
        return null;
    }
};

/**
 * Parse an HTML body string and extract all downloadable file links.
 * Uses selectors consistent with the existing unpackIntermediatePage() approach,
 * plus additional patterns for Canvas page body content (tables, inline links).
 * 
 * @param {string} htmlBody - The raw HTML body content from a Canvas page.
 * @param {string} baseUrl - The base URL to resolve relative links against.
 * @returns {Array<{href: string, text: string, type: string}>} Discovered file references.
 */
window.CanvasDownloader.parsePageBodyForFiles = function (htmlBody, baseUrl) {
    if (!htmlBody) return [];

    const doc = new DOMParser().parseFromString(htmlBody, 'text/html');
    const results = [];
    const seenHrefs = new Set();

    const TARGET_EXTENSIONS = ['.pdf', '.docx', '.pptx', '.zip', '.xlsx', '.txt', '.doc', '.ppt', '.xls'];

    // Collect all <a> tags in the page body
    const allLinks = doc.querySelectorAll('a[href]');

    for (const link of allLinks) {
        const rawHref = link.getAttribute('href');
        if (!rawHref) continue;

        let absoluteHref;
        try {
            absoluteHref = new URL(rawHref, baseUrl).href;
        } catch (e) {
            continue; // Skip malformed URLs
        }

        // Skip obvious non-file links
        const lowerHref = absoluteHref.toLowerCase();
        if (lowerHref.includes('javascript:') || lowerHref.includes('mailto:')) continue;

        // Determine if this is a downloadable file
        const fileType = detectFileType(absoluteHref, link, TARGET_EXTENSIONS);
        if (!fileType) continue;

        // Deduplicate by href
        if (seenHrefs.has(absoluteHref)) continue;
        seenHrefs.add(absoluteHref);

        // Extract display text — fall back to URL filename if text is generic
        let text = link.textContent?.trim() || link.getAttribute('title') || 'Unknown File';
        if (window.CanvasDownloader.isGenericLinkText(text)) {
            text = window.CanvasDownloader.extractFilenameFromUrl(absoluteHref) || text;
        }

        results.push({
            href: absoluteHref,
            text: text,
            type: fileType
        });
    }

    return results;
};

/**
 * Detect whether a link points to a downloadable file.
 * Returns the file extension type or null if not a file.
 * 
 * @param {string} href - The absolute URL.
 * @param {Element} linkElement - The <a> DOM element.
 * @param {Array<string>} extensions - Target file extensions to match.
 * @returns {string|null} The file type (e.g., '.pdf') or null.
 */
function detectFileType(href, linkElement, extensions) {
    const lowerHref = href.toLowerCase();
    const linkText = (linkElement.textContent || '').toLowerCase();
    const titleAttr = (linkElement.getAttribute('title') || '').toLowerCase();

    // Check: extension in URL
    for (const ext of extensions) {
        if (lowerHref.includes(ext)) return ext;
    }

    // Check: Canvas /files/ path
    if (lowerHref.includes('/files/') && !lowerHref.includes('/folder')) {
        // Try to detect extension from link text or title
        for (const ext of extensions) {
            if (linkText.includes(ext) || titleAttr.includes(ext)) return ext;
        }
        return 'file'; // Generic file type for /files/ links
    }

    // Check: instructure_file_link class (Canvas-specific)
    if (linkElement.classList.contains('instructure_file_link') ||
        linkElement.classList.contains('instructure_scribd_file')) {
        for (const ext of extensions) {
            if (linkText.includes(ext) || titleAttr.includes(ext) || lowerHref.includes(ext)) return ext;
        }
        return 'file';
    }

    // Check: extension in link text or title
    for (const ext of extensions) {
        if (linkText.includes(ext) || titleAttr.includes(ext)) return ext;
    }

    return null;
}

/**
 * Orchestrate deep scanning all Page-type module items.
 * Fetches each page's body, parses for files, and collects all results.
 * 
 * @param {string} courseId - The Canvas course ID.
 * @param {Array} pageItems - Array of Page-type module items from categorizeModuleItems().
 * @param {number} delayMs - Delay between page fetches (default 800ms).
 * @param {function|null} onProgress - Optional callback({current, total, pageTitle}) for progress.
 * @returns {Promise<Array>} Array of discovered file objects with source metadata.
 */
window.CanvasDownloader.deepScanPages = async function (courseId, pageItems, delayMs = 800, onProgress = null, onFilesFound = null) {
    const allFiles = [];

    for (let i = 0; i < pageItems.length; i++) {
        const pageItem = pageItems[i];

        if (onProgress) {
            onProgress({ current: i + 1, total: pageItems.length, pageTitle: pageItem.title });
        }

        // Extract the page_url slug from the module item
        const pageUrl = pageItem.page_url;
        if (!pageUrl) {
            console.warn(`[Canvas Downloader] Page item "${pageItem.title}" has no page_url, skipping.`);
            continue;
        }

        // Fetch the page body
        const pageData = await window.CanvasDownloader.fetchPageBody(courseId, pageUrl);
        if (!pageData || !pageData.body) continue;

        // Parse the body for file links
        const baseUrl = `${window.location.origin}/courses/${courseId}/pages/${pageUrl}`;
        const files = window.CanvasDownloader.parsePageBodyForFiles(pageData.body, baseUrl);

        // Enrich each file with source metadata
        const enrichedFiles = [];
        for (const file of files) {
            enrichedFiles.push({
                ...file,
                href: window.CanvasDownloader.transformDownloadUrl(file.href).url,
                source: 'deep',
                parentPage: pageItem.title,
                moduleName: pageItem.moduleName,
                moduleId: pageItem.moduleId,
                courseName: pageItem.moduleName
            });
        }

        allFiles.push(...enrichedFiles);

        // Stream: notify caller immediately when new files are found
        if (enrichedFiles.length > 0 && onFilesFound) {
            onFilesFound(enrichedFiles);
        }

        // Rate-limit delay between page fetches
        if (i < pageItems.length - 1) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    return allFiles;
};
