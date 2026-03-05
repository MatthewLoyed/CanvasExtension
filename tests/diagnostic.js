/**
 * Canvas Downloader Diagnostic Script v2
 * 
 * Runs on a Canvas course MODULES page.
 * Checks both surface links AND deep scan (API → page bodies → embedded files).
 */
(async function CDL_DIAG_V2() {
    console.log('=== CDL Diagnostic v2 ===');
    console.log('URL:', window.location.href);

    const courseIdMatch = window.location.pathname.match(/\/courses\/(\d+)/);
    const courseId = courseIdMatch ? courseIdMatch[1] : null;
    if (!courseId) { console.error('❌ Not on a course page'); return; }
    console.log('Course ID:', courseId);

    const origin = window.location.origin;
    const TARGET_EXT = ['.pdf', '.docx', '.pptx', '.zip', '.xlsx', '.txt', '.doc', '.ppt', '.xls'];

    // ---- Step 1: Fetch modules from Canvas API ----
    console.log('\n📦 Fetching modules from Canvas API...');
    let allModules = [];
    let nextUrl = `${origin}/api/v1/courses/${courseId}/modules?include[]=items&include[]=content_details&per_page=50`;
    while (nextUrl) {
        const resp = await fetch(nextUrl, { credentials: 'include' });
        if (!resp.ok) { console.error('API error', resp.status); break; }
        const data = await resp.json();
        allModules.push(...data);
        // Parse Link header for pagination
        const link = resp.headers.get('Link');
        const nextMatch = link && link.match(/<([^>]+)>;\s*rel="next"/);
        nextUrl = nextMatch ? nextMatch[1] : null;
    }
    console.log(`  Found ${allModules.length} modules`);

    // ---- Step 2: Categorize module items ----
    const files = [], pages = [], skipped = [];
    for (const mod of allModules) {
        for (const item of (mod.items || [])) {
            const enriched = { ...item, moduleName: mod.name };
            if (item.type === 'File') files.push(enriched);
            else if (item.type === 'Page') pages.push(enriched);
            else skipped.push(enriched);
        }
    }
    console.log(`  File items: ${files.length} | Page items: ${pages.length} | Skipped: ${skipped.length}`);

    // ---- Step 3: Check File-type items via API ----
    console.log('\n📄 File-type module items (direct files):');
    const fileResults = [];
    for (const f of files) {
        const result = { title: f.title, type: f.type, contentId: f.content_id, moduleName: f.moduleName };
        if (f.content_id) {
            try {
                const resp = await fetch(`${origin}/api/v1/files/${f.content_id}`, { credentials: 'include' });
                if (resp.ok) {
                    const data = await resp.json();
                    result.apiContentType = data['content-type'] || '(missing)';
                    result.apiFilename = data.filename || '(missing)';
                    result.apiDisplayName = data.display_name || '(missing)';
                } else {
                    result.apiError = `HTTP ${resp.status}`;
                }
            } catch (e) { result.apiError = e.message; }
        }
        fileResults.push(result);
    }
    if (fileResults.length > 0) {
        console.table(fileResults.map(r => ({
            'Title': (r.title || '').substring(0, 40),
            'Content ID': r.contentId || '—',
            'API Type': r.apiContentType || '—',
            'API Filename': (r.apiFilename || '—').substring(0, 35),
            'API Display': (r.apiDisplayName || '—').substring(0, 35),
            'Error': r.apiError || '',
        })));
    } else {
        console.log('  (none)');
    }

    // ---- Step 4: Deep scan a sample of Page items ----
    const MAX_PAGES = 5; // Only scan first 5 pages to keep it quick
    const pagesToScan = pages.slice(0, MAX_PAGES);
    console.log(`\n📖 Scanning ${pagesToScan.length} of ${pages.length} pages for embedded files...`);

    const deepResults = [];
    for (const p of pagesToScan) {
        const pageUrl = p.page_url;
        if (!pageUrl) continue;

        let pageData;
        try {
            const resp = await fetch(`${origin}/api/v1/courses/${courseId}/pages/${encodeURIComponent(pageUrl)}`, { credentials: 'include' });
            if (!resp.ok) { console.warn(`  ⚠️ Page "${p.title}": HTTP ${resp.status}`); continue; }
            pageData = await resp.json();
        } catch (e) { console.warn(`  ⚠️ Page "${p.title}": ${e.message}`); continue; }

        if (!pageData.body) { continue; }

        // Parse body for links
        const doc = new DOMParser().parseFromString(pageData.body, 'text/html');
        const links = doc.querySelectorAll('a[href]');

        for (const link of links) {
            const href = link.getAttribute('href');
            if (!href) continue;

            let absHref;
            try { absHref = new URL(href, `${origin}/courses/${courseId}/pages/${pageUrl}`).href; } catch { continue; }

            const lower = absHref.toLowerCase();
            if (lower.includes('javascript:') || lower.includes('mailto:')) continue;

            // Check if file-related
            const hasFilePath = lower.includes('/files/');
            const hasExt = TARGET_EXT.some(ext => lower.includes(ext));
            const hasFileClass = link.classList.contains('instructure_file_link') || link.classList.contains('instructure_scribd_file');
            if (!hasFilePath && !hasExt && !hasFileClass) continue;

            const text = link.textContent?.trim() || '(no text)';
            const fileIdMatch = absHref.match(/\/files\/(\d+)/);
            const fileId = fileIdMatch ? fileIdMatch[1] : null;
            const isExternal = (() => { try { return new URL(absHref).hostname !== window.location.hostname; } catch { return false; } })();

            const result = {
                pageTitle: p.title,
                moduleName: p.moduleName,
                linkText: text,
                href: absHref,
                fileId,
                isExternal,
                cssClasses: Array.from(link.classList).join(', ') || '(none)',
                apiContentType: '—',
                apiFilename: '—',
                apiError: null,
            };

            // Query API for files with an ID
            if (fileId) {
                try {
                    const resp = await fetch(`${origin}/api/v1/files/${fileId}`, { credentials: 'include' });
                    if (resp.ok) {
                        const data = await resp.json();
                        result.apiContentType = data['content-type'] || '(missing)';
                        result.apiFilename = data.filename || '(missing)';
                    } else {
                        result.apiError = `HTTP ${resp.status}`;
                    }
                } catch (e) { result.apiError = e.message; }
            }

            deepResults.push(result);
        }
    }

    if (deepResults.length > 0) {
        console.log(`\n🔍 Found ${deepResults.length} embedded file links:`);
        console.table(deepResults.map(r => ({
            'Page': (r.pageTitle || '').substring(0, 25),
            'Link Text': (r.linkText || '').substring(0, 30),
            'File ID': r.fileId || '—',
            'API Type': r.apiContentType,
            'API Filename': (r.apiFilename || '—').substring(0, 30),
            'External?': r.isExternal ? '🌐 YES' : '',
            'CSS Classes': r.cssClasses,
            'Error': r.apiError || '',
            'href': r.href.substring(0, 60),
        })));
    } else {
        console.log('  (no embedded files found in scanned pages)');
    }

    // ---- Step 5: JSON dump ----
    const output = {
        fileItems: fileResults, deepScanFiles: deepResults, summary: {
            modules: allModules.length, fileItems: files.length, pageItems: pages.length,
            deepFilesFound: deepResults.length, pagesScanned: pagesToScan.length, totalPages: pages.length
        }
    };
    console.log('\n📋 Copy this JSON:\n');
    console.log(JSON.stringify(output, null, 2));

    return output;
})();
