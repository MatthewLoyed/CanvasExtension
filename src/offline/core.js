/* Archive model, collection, sanitization, and HTML rendering. No UI or persistent storage. */
(function (root) {
    'use strict';
    const LIMITS = Object.freeze({ bytes: 250 * 1024 * 1024, fileBytes: 50 * 1024 * 1024, records: 5000, pages: 250 });
    const CSS = 'body{font:16px/1.6 system-ui,sans-serif;max-width:72rem;margin:2rem auto;padding:0 1.5rem;color:#202124;background:white}a{color:#174ea6}nav{margin:1rem 0}table{border-collapse:collapse;display:block;overflow:auto}td,th{padding:.5rem;border:1px solid #aaa}img{max-width:100%;height:auto}pre{overflow:auto;background:#f3f4f5;padding:1rem}blockquote{border-left:3px solid #aaa;padding-left:1rem}.notice{padding:.65rem;background:#f3f4f5}small{color:#555}li{margin:.3rem 0}@media print{nav{display:none}}';
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const bytesOf = text => new TextEncoder().encode(text).byteLength;
    const allowedAsset = (url, origin) => url.protocol === 'https:' && !url.username && !url.password &&
        (url.origin === origin || /(^|\.)(?:canvas-user-content\.com|inscloudgate\.net)$/i.test(url.hostname) ||
            (url.hostname === 'instructure-uploads.s3.amazonaws.com' && /^\/account_\d+\/attachments\/\d+\//.test(url.pathname)));
    function safeName(value, max = 85) {
        let name = String(value || 'Untitled').normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').trim().replace(/[. ]+$/, '');
        if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
        let short = '';
        for (const character of name) { if (short.length + character.length > max || bytesOf(short + character) > 180) break; short += character; }
        name = short.replace(/[. ]+$/, '');
        return !name || /^\.+$/.test(name) ? 'Untitled' : name;
    }
    function canonical(href, base) {
        try {
            const u = new URL(href, base);
            if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
            if (u.origin === new URL(base).origin) u.search = '';
            else for (const key of [...u.searchParams.keys()]) if (/token|verifier|signature|credential|secure|x-amz|policy|expires|api.?key|auth|session|secret|^code$|^key$/i.test(key)) u.searchParams.delete(key);
            return u.href;
        } catch { return null; }
    }
    function fileIdentity(href, base) {
        try {
            const u = new URL(href, base);
            if (u.origin !== new URL(base).origin) return null;
            const context = new URL(base).pathname.match(/^\/courses\/(\d+)/);
            const linkedContext = u.pathname.match(/^\/(?:api\/v1\/)?courses\/(\d+)/);
            if (context && linkedContext && context[1] !== linkedContext[1]) return null;
            const match = u.pathname.match(/^\/(?:api\/v1\/)?(?:courses\/\d+\/)?files\/(\d+)(?:\/(?:download|preview))?\/?$/);
            const preview = /\/files\/?$/.test(u.pathname) && u.searchParams.get('preview');
            return match?.[1] || (/^\d+$/.test(preview || '') ? preview : null);
        } catch { return null; }
    }
    function localHref(from, to, hash = '') {
        const segments = from.split('/'); segments.pop();
        return '../'.repeat(segments.length) + to.split('/').map(encodeURIComponent).join('/') + hash;
    }
    function shell(title, body, depth = 0) {
        const prefix = '../'.repeat(depth);
        // Even an accidentally retained URL cannot make the generated reader contact a server.
        return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><title>${esc(title)}</title><link rel="stylesheet" href="${prefix}reader.css"></head><body>${depth ? `<nav><a href="${prefix}index.html">Course index</a> · <a href="${prefix}export-report.html">Export report</a></nav>` : ''}<h1>${esc(title)}</h1>${body}</body></html>`;
    }
    function sanitizedBody(html, purifier = root.DOMPurify) {
        if (!purifier) throw new Error('The bundled HTML sanitizer is unavailable.');
        // Discard embeds and form controls while retaining a named placeholder, not broken widgets.
        const doc = new DOMParser().parseFromString(html || '', 'text/html');
        for (const el of doc.querySelectorAll('iframe,video,audio,object,embed,form')) {
            const note = doc.createElement('p');
            note.className = 'cdl-omitted-embed';
            note.textContent = `${el.getAttribute('title') || 'Embedded or interactive content'} — not included; open the original in Canvas.`;
            el.replaceWith(note);
        }
        const clean = purifier.sanitize(doc.body.innerHTML, { USE_PROFILES: { html: true, mathMl: true },
            FORBID_TAGS: ['style', 'input', 'button', 'select', 'textarea', 'source', 'link', 'meta', 'base'],
            FORBID_ATTR: ['srcset', 'background', 'ping', 'autofocus'], ALLOW_DATA_ATTR: false, RETURN_DOM_FRAGMENT: true });
        const box = document.createElement('div'); box.append(clean);
        // CSS allowlist prevents URL loads, layout overlays, animation, and hidden text.
        const allowed = /^(text-align|font-weight|font-style|text-decoration|white-space|vertical-align|border-collapse)$/;
        for (const el of box.querySelectorAll('[style]')) {
            const kept = [];
            for (const prop of Array.from({ length: el.style.length }, (_, i) => el.style[i])) {
                const value = el.style.getPropertyValue(prop);
                if (allowed.test(prop) && /^[\w\s-]+$/.test(value)) kept.push(`${prop}:${value}`);
            }
            el.removeAttribute('style'); if (kept.length) el.setAttribute('style', kept.join(';'));
        }
        return box;
    }
    function references(body, base) {
        const box = sanitizedBody(body);
        return [...box.querySelectorAll('a[href],img[src]')].map(el => ({
            url: canonical(el.getAttribute(el.tagName === 'IMG' ? 'src' : 'href'), base),
            fileId: fileIdentity(el.getAttribute(el.tagName === 'IMG' ? 'src' : 'href'), base),
            image: el.tagName === 'IMG'
        })).filter(ref => ref.url);
    }
    class ArchiveError extends Error { constructor(message, code) { super(message); this.code = code; } }
    class Session {
        constructor({ origin, courseId, request, signal, progress = () => {}, limits = {}, sleep }) {
            this.origin = origin; this.courseId = String(courseId); this.request = request;
            this.signal = signal; this.progress = progress; this.limits = { ...LIMITS, ...limits };
            this.sleep = sleep || (ms => new Promise((resolve, reject) => {
                const abort = () => { clearTimeout(timer); reject(new ArchiveError('Export cancelled.', 'cancelled')); };
                const timer = setTimeout(() => { this.signal?.removeEventListener('abort', abort); resolve(); }, ms);
                this.signal?.addEventListener('abort', abort, { once: true });
            }));
            this.documents = []; this.files = new Map(); this.modules = []; this.aliases = new Map();
            this.coverage = []; this.usedBytes = 0; this.started = new Date().toISOString();
            this.recordCount = 0; this.sourceBytes = 0; this.pendingBytes = 0; this.timings = {};
        }
        async parallel(items, work, concurrency = 3) {
            const parent = this.signal, controller = new AbortController();
            const abort = () => controller.abort();
            parent?.addEventListener('abort', abort, { once: true });
            if (parent?.aborted) abort();
            this.signal = controller.signal;
            let next = 0, failure;
            try {
                await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
                    try {
                        while (next < items.length) {
                            this.check();
                            if (this.backoffUntil > Date.now()) await this.sleep(this.backoffUntil - Date.now());
                            this.check(); const index = next++;
                            await work(items[index], index);
                        }
                    } catch (error) { if (!failure) failure = error; controller.abort(); }
                }));
                if (failure) throw failure;
            } finally { parent?.removeEventListener('abort', abort); this.signal = parent; }
        }
        check() { if (this.signal?.aborted) throw new ArchiveError('Export cancelled.', 'cancelled'); }
        record() { if (++this.recordCount > this.limits.records) throw new ArchiveError('Discovery reached its safety limit. Narrow the selection and scan again.', 'limit'); }
        accountBody(body) {
            this.sourceBytes += bytesOf(body || '');
            if (this.sourceBytes > this.limits.bytes) throw new ArchiveError('Content text exceeded the archive safety limit.', 'limit');
        }
        async get(path) {
            this.check();
            const url = new URL(path, this.origin);
            const cacheable = this.discoveryCache && !url.search && /\/(?:pages|assignments|discussion_topics|files)\/[^/]+$/.test(url.pathname);
            if (!cacheable) return this.requestChecked(path);
            const key = url.href;
            if (!this.discoveryCache.has(key)) {
                const pending = this.requestChecked(path);
                this.discoveryCache.set(key, pending);
                pending.catch(() => this.discoveryCache?.delete(key));
            }
            const response = await this.discoveryCache.get(key); this.check(); return response;
        }
        async requestChecked(path) {
            for (let attempt = 0; attempt < 4; attempt++) {
                this.check();
                let response;
                try { response = await this.request(path, this.signal); } catch { response = { error: 'Canvas tab unavailable or request interrupted.', status: 0 }; }
                this.check();
                if (!response.error) {
                    // Check the owner after each response, before retaining any private content.
                    if (this.viewer && new URL(path, this.origin).pathname !== '/api/v1/users/self/profile') {
                        let owner;
                        try { owner = await this.request('/api/v1/users/self/profile', this.signal); } catch { owner = null; }
                        this.check();
                        if (!owner || owner.error) throw new ArchiveError('Could not verify the Canvas account. Sign in and scan again.', 'auth');
                        if (String(owner.data?.id) !== this.viewer) throw new ArchiveError('Canvas account changed. Clear this export and scan again.', 'account');
                    }
                    if (response.remaining != null && Number(response.remaining) < 50) { this.backoffUntil = Date.now() + 1500; await this.sleep(1500); }
                    return response;
                }
                if (response.status === 401) throw new ArchiveError('Sign in to Canvas in the original course tab, then retry the scan.', 'auth');
                if ((response.status === 429 || response.status >= 500 || !response.status) && attempt < 3) {
                    const retry = Number(response.retryAfter) || (Date.parse(response.retryAfter) - Date.now()) / 1000;
                    const delay = Math.min(30000, Math.max(1000, (retry || 2 ** attempt) * 1000));
                    this.backoffUntil = Math.max(this.backoffUntil || 0, Date.now() + delay);
                    await this.sleep(delay); continue;
                }
                throw new ArchiveError(response.error, String(response.status || 'network'));
            }
        }
        async *list(path) {
            let next = new URL(path, this.origin).href;
            const seen = new Set();
            while (next) {
                const u = new URL(next);
                if (u.origin !== this.origin || seen.has(next)) throw new ArchiveError('Unsafe or repeated Canvas pagination link.', 'pagination');
                if (seen.size >= this.limits.pages) throw new ArchiveError('Canvas pagination reached the safety limit. Narrow the selection and scan again.', 'limit');
                seen.add(next);
                const response = await this.get(next);
                if (!Array.isArray(response.data)) throw new ArchiveError('Expected a Canvas list.', 'schema');
                for (const item of response.data) { this.record(); yield item; }
                const link = (response.link || '').split(',').find(part => /rel="?next"?/.test(part));
                next = link?.match(/<([^>]+)>/)?.[1] || null;
            }
        }
        async collection(name, task) {
            const started = Date.now();
            this.progress(`Scanning ${name}…`, undefined, { phase: 'scan', section: name });
            try { await task(); this.coverage.push({ name, state: 'enumerated' }); }
            catch (error) {
                if (['auth', 'account', 'cancelled', 'limit'].includes(error.code)) throw error;
                this.coverage.push({ name, state: 'incomplete', reason: error.message });
            } finally { (this.timings.discoveryStagesMs ||= {})[name] = Date.now() - started; }
        }
        addFile(id, referrer, metadata) {
            id = String(id);
            if (!/^\d+$/.test(id)) return;
            if (!this.files.has(id)) {
                this.record(); this.files.set(id, { id, title: `File ${id}`, state: 'pending', refs: [], source: `${this.origin}/courses/${this.courseId}/files/${id}` });
            }
            const file = this.files.get(id);
            if (referrer && !file.refs.includes(referrer)) file.refs.push(referrer);
            if (metadata) this.applyMetadata(file, metadata);
        }
        applyMetadata(file, data) {
            file.title = data.display_name || data.filename || file.title;
            file.mime = data['content-type'] || 'application/octet-stream';
            file.size = Number(data.size) || 0;
            file.updated = data.updated_at || null;
            if (data.locked_for_user || data.hidden_for_user || data.for_submissions) { file.state = 'unavailable'; file.reason = 'Unavailable to this Canvas login.'; }
            else if (/^(audio|video)\//i.test(file.mime) || /\.(mp4|m4v|mov|avi|webm|mp3|m4a|wav|ogg)$/i.test(file.title)) {
                file.state = 'excluded'; file.reason = 'Recordings and media are outside this release.';
            } else if (file.size > this.limits.fileBytes) { file.state = 'excluded'; file.reason = 'File exceeds the per-file safety limit.'; }
            // Signed URLs are deliberately not retained in the model or manifest.
            const filename = data.filename || file.title;
            const extension = filename.match(/\.[a-z0-9]{1,10}$/i)?.[0] || '';
            file.path = `files/${file.id}-${safeName(extension ? filename.slice(0, -extension.length) : filename, 85 - extension.length)}${extension}`;
        }
        addDocument(kind, data, body, title, source) {
            const id = String(data.page_id || data.id);
            if (!/^\d+$/.test(id)) throw new ArchiveError('Canvas returned an invalid content identity.', 'schema');
            if (this.documents.some(d => d.kind === kind && d.id === id)) return;
            this.accountBody(body);
            const record = { id, kind, title: title || 'Untitled', source, body: body || '',
                path: `${kind}/${id}-${safeName(title)}.html`, updated: data.updated_at || null,
                captured: new Date().toISOString(), due: data.due_at || null, posted: data.posted_at || null,
                state: data.locked_for_user || data.published === false ? 'unavailable' : typeof body === 'string' ? 'ready' : 'unavailable',
                reason: data.locked_for_user ? 'Locked for this user.' : typeof body !== 'string' ? 'Canvas did not supply a usable HTML body.' : '' };
            if (record.state === 'unavailable') record.body = '';
            this.documents.push(record); this.aliases.set(new URL(source).pathname, record);
            this.progress('Reading course content…', undefined, { phase: 'scan', section: kind, item: record.title });
            if (record.state === 'ready' && this.selected.files) this.collectReferences(record.body, record.source);
        }
        collectReferences(body, source) { for (const ref of references(body, source)) if (ref.fileId) this.addFile(ref.fileId, source); }
        async scan(selected) {
            this.discoveryCache = new Map();
            try { return await this.scanContent(selected); }
            finally { this.discoveryCache.clear(); this.discoveryCache = null; }
        }
        async scanContent(selected) {
            this.selected = { ...selected };
            this.viewer = String((await this.get('/api/v1/users/self/profile')).data.id);
            if (!this.viewer || this.viewer === 'undefined') throw new ArchiveError('Could not identify the Canvas session.', 'auth');
            const course = (await this.get(`/api/v1/courses/${this.courseId}`)).data;
            this.title = course.name || `Canvas course ${this.courseId}`;
            const base = `/api/v1/courses/${this.courseId}`;
            const moduleRecords = [], tasks = [];
            if (selected.pages) tasks.push(async () => {
                await this.collection('Pages', async () => {
                    for await (const data of this.list(`${base}/pages?include[]=body&per_page=50`)) {
                        if (data.body == null && !data.locked_for_user && data.published !== false) {
                            try { Object.assign(data, (await this.get(`${base}/pages/page_id:${data.page_id}`)).data); }
                            catch (e) { if (['auth','account','cancelled','limit'].includes(e.code)) throw e; data.body = null; }
                        }
                        this.addDocument('pages', data, data.body, data.title, `${this.origin}/courses/${this.courseId}/pages/${encodeURIComponent(data.url)}`);
                    }
                });
                // Some courses disable the Pages index while still exposing their home
                // page and module-linked pages. Preserve those without claiming a full list.
                if (selected.pages && this.coverage.some(c => c.name === 'Pages' && c.state === 'incomplete')) {
                    try {
                        const page = (await this.get(`${base}/front_page`)).data;
                        this.addDocument('pages', page, page.body, page.title, `${this.origin}/courses/${this.courseId}/pages/${encodeURIComponent(page.url)}`);
                    } catch (e) {
                        if (['auth','account','cancelled','limit'].includes(e.code)) throw e;
                        if (!['403','404'].includes(e.code)) this.coverage.push({ name: 'Course home page', state: 'incomplete', reason: e.message });
                    }
                }
            });
            if (selected.announcements) tasks.push(async () => {
                await this.collection('Announcements', async () => {
                    for await (const data of this.list(`${base}/discussion_topics?only_announcements=true&per_page=50`)) {
                        this.addDocument('announcements', data, data.message, data.title, `${this.origin}/courses/${this.courseId}/discussion_topics/${data.id}`);
                        const doc = this.documents.at(-1);
                        if (doc.state === 'ready') for (const a of data.attachments || []) {
                            const id = a.id || fileIdentity(a.url, this.origin);
                            if (id && /^\d+$/.test(String(id))) {
                                (doc.attachments ||= []).push(String(id));
                                if (selected.files) this.addFile(id, doc.source);
                            }
                        }
                    }
                });
            });
            if (selected.assignments) tasks.push(async () => {
                await this.collection('Assignment instructions', async () => {
                    for await (const data of this.list(`${base}/assignments?per_page=50`)) {
                        const excluded = data.is_quiz_assignment || data.quiz_id || data.submission_types?.some(t => ['online_quiz','discussion_topic','external_tool'].includes(t));
                        this.addDocument('assignments', data, excluded ? null : data.description, data.name, `${this.origin}/courses/${this.courseId}/assignments/${data.id}`);
                        if (excluded) Object.assign(this.documents.at(-1), { state: 'excluded', reason: 'Quiz, discussion, or external-tool assignment.', body: '' });
                    }
                });
            });
            if (selected.files) tasks.push(async () => {
                await this.collection('Other course files', async () => {
                    for await (const data of this.list(`${base}/files?per_page=50`)) this.addFile(data.id, 'Course Files', data);
                });
            });
            tasks.push(() => this.collection('Module list', async () => {
                for await (const mod of this.list(`${base}/modules?per_page=50`)) moduleRecords.push(mod);
            }));
            await this.parallel(tasks, task => task());
            await this.collection('Module structure and linked files', async () => {
                await this.parallel(moduleRecords, async mod => {
                    const group = { id: String(mod.id), title: mod.name, items: [], locked: mod.state === 'locked' || mod.locked_for_user };
                    this.modules.push(group);
                    this.progress('Reading course modules…', undefined, { phase: 'scan', section: 'modules', item: group.title });
                    if (group.locked) return;
                    for await (const item of this.list(`${base}/modules/${mod.id}/items?include[]=content_details&per_page=50`)) {
                        const target = item.type === 'Page' ? `/courses/${this.courseId}/pages/${encodeURIComponent(item.page_url)}` :
                            item.type === 'Assignment' ? `/courses/${this.courseId}/assignments/${item.content_id}` :
                            item.type === 'File' ? `/courses/${this.courseId}/files/${item.content_id}` : null;
                        group.items.push({ id: String(item.id), title: item.title, target, type: item.type,
                            unavailable: !!item.content_details?.locked_for_user });
                        const doc = target && this.aliases.get(target);
                        if (doc) this.aliases.set(`/courses/${this.courseId}/modules/items/${item.id}`, doc);
                        if (selected.pages && item.type === 'Page' && !doc && !item.content_details?.locked_for_user && item.published !== false) {
                            try {
                                const page = (await this.get(`${base}/pages/${encodeURIComponent(item.page_url)}`)).data;
                                this.addDocument('pages', page, page.body, page.title || item.title, `${this.origin}${target}`);
                                this.aliases.set(`/courses/${this.courseId}/modules/items/${item.id}`, this.aliases.get(target));
                            } catch (e) {
                                if (['auth','account','cancelled','limit'].includes(e.code)) throw e;
                                this.coverage.push({ name: `Page: ${item.title}`, state: 'incomplete', reason: e.message });
                            }
                        }
                        if (!selected.files || item.content_details?.locked_for_user || item.published === false) continue;
                        if (item.type === 'File') {
                            this.addFile(item.content_id, `Module: ${mod.name}`);
                            this.aliases.set(`/courses/${this.courseId}/modules/items/${item.id}`, this.files.get(String(item.content_id)));
                        }
                        // Files-only scans inspect bodies for references but never save the document.
                        if ((item.type === 'Page' && !selected.pages) || (item.type === 'Assignment' && !selected.assignments) || item.type === 'Discussion') {
                            const bucket = item.type === 'Page' ? `pages/${encodeURIComponent(item.page_url)}` : item.type === 'Assignment' ? `assignments/${item.content_id}` : `discussion_topics/${item.content_id}`;
                            try {
                                const data = (await this.get(`${base}/${bucket}`)).data;
                                if (data.locked_for_user || data.published === false || data.is_quiz_assignment || data.submission_types?.some(t => ['online_quiz','discussion_topic','external_tool'].includes(t))) continue;
                                this.accountBody(data.body || data.description || data.message);
                                this.collectReferences(data.body || data.description || data.message || '', `${this.origin}${target || `/courses/${this.courseId}`}`);
                            } catch (e) { if (['auth','account','cancelled','limit'].includes(e.code)) throw e; this.coverage.push({ name: `Module item ${item.title}`, state: 'incomplete', reason: e.message }); }
                        }
                    }
                });
            });
            let n = 0;
            const metadataStarted = Date.now();
            await this.parallel([...this.files.values()], async file => {
                this.progress(`Checking files ${++n} / ${this.files.size}…`, undefined, { phase: 'prepare', current: n, total: this.files.size, item: file.title });
                if (file.state !== 'pending' || file.mime) return;
                try { this.applyMetadata(file, (await this.get(`/api/v1/files/${file.id}`)).data); }
                catch (e) { if (['auth','account','cancelled','limit'].includes(e.code)) throw e; file.state = ['403','404'].includes(e.code) ? 'unavailable' : 'failed'; file.reason = e.message; }
            }, 6);
            const order = ['Pages', 'Announcements', 'Assignment instructions', 'Module list', 'Module structure and linked files', 'Other course files'];
            (this.timings.discoveryStagesMs ||= {})['Attachment metadata'] = Date.now() - metadataStarted;
            this.coverage.sort((a, b) => (order.indexOf(a.name) < 0 ? 99 : order.indexOf(a.name)) - (order.indexOf(b.name) < 0 ? 99 : order.indexOf(b.name)));
            this.scanned = new Date().toISOString();
            this.timings.discoveryMs = Date.now() - Date.parse(this.started);
            return this;
        }
        async verifyViewer() {
            const viewer = String((await this.get('/api/v1/users/self/profile')).data.id);
            if (viewer !== this.viewer) throw new ArchiveError('Canvas account changed. Clear this export and scan again.', 'account');
        }
        async fetchFiles(fetchAsset = fetch) {
            const accessStarted = Date.now();
            await this.verifyViewer();
            // Revalidate access to saved content before using scanned bodies in a new archive.
            const readable = this.documents.filter(d => ['ready','saved','failed'].includes(d.state));
            let checked = 0;
            await this.parallel(readable, async doc => {
                this.progress('Checking access to course content…', undefined, { phase: 'access', current: ++checked, total: readable.length, item: doc.title });
                const bucket = doc.kind === 'pages' ? `pages/page_id:${doc.id}` : doc.kind === 'announcements' ? `discussion_topics/${doc.id}` : `assignments/${doc.id}`;
                try {
                    const data = (await this.get(`/api/v1/courses/${this.courseId}/${bucket}`)).data;
                    if (data.locked_for_user || data.published === false) { doc.state = 'unavailable'; doc.reason = 'Access changed after scanning.'; doc.body = ''; }
                    else { doc.state = 'ready'; doc.reason = ''; }
                } catch (e) {
                    if (['auth','cancelled','account'].includes(e.code)) throw e;
                    doc.state = ['403','404'].includes(e.code) ? 'unavailable' : 'failed'; doc.reason = e.message;
                    if (doc.state === 'unavailable') doc.body = '';
                }
            }, 6);
            this.timings.accessMs = Date.now() - accessStarted;
            const downloadStarted = Date.now();
            const transferable = [...this.files.values()].filter(file => ['pending','failed','saved'].includes(file.state));
            // Fixed weights keep estimates stable when metadata changes. Unknown sizes
            // receive a modest placeholder; terminal failures still finish their work.
            const weights = transferable.map(file => file.size > 0 ? file.size : 1024 * 1024);
            const fractions = transferable.map(() => 0);
            const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
            let completed = 0;
            const reportTransfer = (file, index, bytes = 0) => {
                const percent = totalWeight ? 100 * fractions.reduce((sum, fraction, i) => sum + fraction * weights[i], 0) / totalWeight : 100;
                this.progress('Downloading attachments…', percent, { phase: 'download', current: completed, total: transferable.length,
                    item: file.title, bytes, size: file.size, estimated: true });
            };
            const transfer = async (file, index) => {
                this.check();
                reportTransfer(file, index);
                if (file.state === 'saved') {
                    try {
                        const metadata = (await this.get(`/api/v1/files/${file.id}`)).data;
                        if (metadata.locked_for_user || metadata.hidden_for_user) throw new ArchiveError('File access changed after the previous attempt.', '403');
                    } catch (e) {
                        if (['auth','account','cancelled'].includes(e.code)) throw e;
                        this.usedBytes -= file.bytes.size; delete file.bytes;
                        file.state = ['403','404'].includes(e.code) ? 'unavailable' : 'failed'; file.reason = e.message;
                    }
                    return;
                }
                if (!['pending','failed'].includes(file.state)) return;
                for (let attempt = 0; attempt < 3; attempt++) {
                    let reserved = 0;
                    try {
                        const metadata = (await this.get(`/api/v1/files/${file.id}`)).data;
                        this.applyMetadata(file, metadata);
                        if (!['pending','failed'].includes(file.state)) break;
                        const u = new URL(metadata.url);
                        if (!allowedAsset(u, this.origin)) throw new Error('File host is outside the supported Canvas hosts.');
                        const timeout = new AbortController();
                        const abort = () => timeout.abort(); this.signal?.addEventListener('abort', abort, { once: true });
                        const timer = setTimeout(abort, 60000);
                        try {
                            const response = await fetchAsset(u.href, { credentials: 'include', signal: timeout.signal });
                            const final = new URL(response.url || u.href);
                            if (/\/(login|sso|saml|cas)(?:[/?]|$)/i.test(final.href) || response.status === 401) throw new ArchiveError('Sign in to Canvas, then retry failed items.', 'auth');
                            if (!response.ok) {
                                const error = new ArchiveError(`File HTTP ${response.status}.`, response.status === 429 || response.status >= 500 ? 'transient' : 'file');
                                error.retryAfter = response.headers.get('retry-after'); throw error;
                            }
                            if (!allowedAsset(final, this.origin)) throw new Error('File redirected outside supported Canvas hosts.');
                            const mime = response.headers.get('content-type') || '';
                            if (/html/i.test(mime) && !/html/i.test(file.mime)) throw new ArchiveError('Unexpected HTML instead of a file. Sign in and retry.', 'auth');
                            const reader = response.body.getReader(); const chunks = []; let size = 0, lastReported = 0;
                            while (true) {
                                this.check(); const part = await reader.read(); if (part.done) break;
                                size += part.value.byteLength;
                                fractions[index] = Math.max(fractions[index], Math.min(.95, size / weights[index]));
                                if (size - lastReported >= 1024 * 1024) {
                                    reportTransfer(file, index, size);
                                    lastReported = size;
                                }
                                if (size > this.limits.fileBytes || this.usedBytes + this.sourceBytes + this.pendingBytes + part.value.byteLength > this.limits.bytes) {
                                    await reader.cancel(); throw new ArchiveError('File would exceed the archive safety limit. Omit it and retry.', 'size');
                                }
                                this.pendingBytes += part.value.byteLength; reserved += part.value.byteLength;
                                chunks.push(part.value);
                            }
                            const blob = new Blob(chunks, { type: file.mime });
                            const head = new Uint8Array(Math.min(size, 8192)); let offset = 0;
                            for (const chunk of chunks) { const part = chunk.subarray(0, head.length - offset); head.set(part, offset); offset += part.length; if (offset === head.length) break; }
                            const prefix = new TextDecoder().decode(head);
                            if (/<form[^>]*(?:login|cas|saml|session)/i.test(prefix) || /<title[^>]*>[^<]*(?:sign in|log ?in|central authentication)/i.test(prefix)) {
                                throw new ArchiveError('Received a sign-in page instead of the attachment. Sign in and retry.', 'auth');
                            }
                            file.bytes = blob; this.usedBytes += size;
                            file.state = 'saved'; file.reason = ''; file.fetched = new Date().toISOString();
                        } finally { clearTimeout(timer); this.signal?.removeEventListener('abort', abort); }
                    } catch (e) {
                        this.check(); file.state = 'failed'; file.reason = e.message;
                        if (['auth','account'].includes(e.code)) throw e;
                        if ((e.code === 'transient' || e instanceof TypeError || e.name === 'AbortError') && attempt < 2) {
                            const retry = Number(e.retryAfter) || (Date.parse(e.retryAfter) - Date.now()) / 1000;
                            const delay = Math.min(30000, Math.max(1000, (retry || 2 ** attempt) * 1000));
                            this.backoffUntil = Math.max(this.backoffUntil || 0, Date.now() + delay);
                            await this.sleep(delay); continue;
                        }
                    } finally {
                        this.pendingBytes -= reserved;
                    }
                    break;
                }
            };
            await this.parallel(transferable, async (file, index) => {
                try { await transfer(file, index); }
                finally {
                    if (!this.signal?.aborted) { fractions[index] = 1; completed++; reportTransfer(file, index); }
                }
            }, 9);
            this.timings.downloadMs = Date.now() - downloadStarted;
        }
        renderBody(doc) {
            const box = sanitizedBody(doc.body); doc.notices = [];
            if (box.querySelector('.cdl-omitted-embed')) doc.notices.push('Embedded or interactive content not saved.');
            for (const id of doc.attachments || []) {
                const p = document.createElement('p'), a = document.createElement('a');
                a.href = `${this.origin}/courses/${this.courseId}/files/${id}`;
                a.textContent = this.files.get(id)?.title || `Attachment ${id}`; p.append(a); box.append(p);
            }
            for (const el of box.querySelectorAll('[href],img[src]')) {
                const image = el.tagName === 'IMG'; const attr = image ? 'src' : 'href';
                const raw = el.getAttribute(attr);
                if (image && /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(raw)) continue;
                if (!image && raw.startsWith('#')) {
                    let fragment; try { fragment = decodeURIComponent(raw.slice(1)); } catch { fragment = raw.slice(1); }
                    if (fragment && ![...box.querySelectorAll('[id]')].some(node => node.id === fragment)) doc.notices.push(`Fragment target not found: ${fragment}`);
                    continue;
                }
                let u; try { u = new URL(raw, doc.source); } catch { el.removeAttribute(attr); continue; }
                const id = fileIdentity(raw, doc.source); const file = id && this.files.get(id);
                let target = u.origin === this.origin ? this.aliases.get(u.pathname) : null;
                if (file?.state === 'saved') target = file;
                if (target && ['saved','ready'].includes(target.state)) {
                    if (u.hash && target.kind) {
                        const targetBody = target === doc ? box : sanitizedBody(target.body);
                        let fragment; try { fragment = decodeURIComponent(u.hash.slice(1)); } catch { fragment = u.hash.slice(1); }
                        if (![...targetBody.querySelectorAll('[id]')].some(node => node.id === fragment)) doc.notices.push(`Fragment target not found: ${fragment}`);
                    }
                    el.setAttribute(attr, localHref(doc.path, target.path, u.hash));
                    el.removeAttribute('target'); if (!image) el.setAttribute('rel', 'noopener noreferrer'); continue;
                }
                let section = u.pathname === `/courses/${this.courseId}/modules` ? 'modules' : u.pathname === `/courses/${this.courseId}/assignments` ? 'assignments' : null;
                if (!image && u.origin === this.origin && section) { el.setAttribute(attr, `../index.html#${section}`); continue; }
                const reason = file?.reason || (id && !this.selected.files ? 'Files & images not selected' : 'Online only / not saved');
                doc.notices.push(reason);
                if (image) {
                    const note = document.createElement('span'); note.className = 'notice'; note.textContent = `[Image: ${el.getAttribute('alt') || 'unnamed'} — ${reason}]`; el.replaceWith(note);
                } else {
                    const href = canonical(raw, doc.source);
                    if (href) el.setAttribute('href', href); else el.removeAttribute('href');
                    el.removeAttribute('target'); el.setAttribute('rel', 'noopener noreferrer');
                    el.append(document.createTextNode(` [${reason}]`));
                }
            }
            return box.innerHTML;
        }
        buildEntries() {
            this.check();
            const entries = new Map([['reader.css', CSS]]);
            for (const file of this.files.values()) if (file.state === 'saved') entries.set(file.path, file.bytes);
            for (const doc of this.documents) if (['ready','saved'].includes(doc.state)) {
                const body = this.renderBody(doc);
                entries.set(doc.path, shell(doc.title, `<p><a href="${esc(doc.source)}" rel="noreferrer">Original in Canvas (online)</a></p><small>Captured ${esc(doc.captured)}${doc.due ? ` · Due ${esc(doc.due)}` : ''}${doc.posted ? ` · Posted ${esc(doc.posted)}` : ''}</small>${body}`, 1));
                doc.state = 'saved';
            }
            const link = record => record.state === 'saved' ? `<a href="${localHref('index.html', record.path)}">${esc(record.title)}</a>` : `${esc(record.title)} — ${esc(record.reason || record.state)}`;
            let index = `<p>Snapshot of selected materials accessible to your Canvas login. This is not a complete course backup.</p><p>Captured ${esc(this.started)} – ${esc(new Date().toISOString())}</p><p><a href="export-report.html">Export report and limitations</a></p>`;
            for (const kind of ['pages','announcements','assignments']) {
                const docs = this.documents.filter(d => d.kind === kind);
                if (docs.length) index += `<section id="${kind}"><h2>${kind === 'assignments' ? 'Assignment instructions' : kind[0].toUpperCase() + kind.slice(1)}</h2><ul>${docs.map(d => `<li>${link(d)}</li>`).join('')}</ul></section>`;
            }
            index += `<section id="modules"><h2>Modules</h2>${this.modules.map(mod => `<h3>${esc(mod.title)}</h3>${mod.locked ? '<p>Locked module — not saved.</p>' : `<ul>${mod.items.map(item => { const target = this.aliases.get(item.target) || (item.type === 'File' && this.files.get(item.target?.split('/').pop())); return `<li>${target ? link(target) : `${esc(item.title)} — ${item.unavailable ? 'unavailable' : 'not saved / online only'}`}</li>`; }).join('')}</ul>`}`).join('')}</section>`;
            if (this.files.size) index += `<h2>Files & images</h2><p>Original HTML attachments may depend on online resources. Open attachments explicitly; they are not part of the static reader.</p><ul>${[...this.files.values()].map(f => `<li>${link(f)}</li>`).join('')}</ul>`;
            entries.set('index.html', shell(this.title, index));
            const report = this.report();
            entries.set('manifest.json', JSON.stringify(report, null, 2));
            entries.set('export-report.html', shell('Export report', `<p><a href="index.html">Course index</a></p><p>${report.partial ? 'Partial archive: review the gaps below.' : 'All discovered selected items were saved.'} Undiscoverable content is unknown.</p><h2>Collection coverage</h2><ul>${this.coverage.map(c => `<li>${esc(c.name)}: ${esc(c.state)} ${esc(c.reason || '')}</li>`).join('')}</ul><h2>Items and dependencies</h2><ul>${report.items.map(i => `<li>${esc(i.title)}: ${esc(i.state)} ${esc(i.reason || '')}${i.notices?.length ? ` (${esc(i.notices.join('; '))})` : ''}</li>`).join('')}</ul><p>Excluded: recordings, tools, quizzes, grades, submissions, discussion replies, and external-site copies. Original file attachments may need separate software or internet access. Re-export to capture updates.</p>`));
            entries.set('README.txt', 'Extract this entire ZIP, then open index.html in a desktop browser. Keep the folders together. This is a selected-content snapshot, not a Canvas backup or import package. See export-report.html for missing content. Original attachments can require separate software or internet access.');
            const total = [...entries.values()].reduce((n, value) => n + (typeof value === 'string' ? bytesOf(value) : value.size), 0);
            if (total > this.limits.bytes) throw new ArchiveError('Generated archive exceeds the safety limit. Reduce the selection.', 'limit');
            return entries;
        }
        report() {
            const items = [...this.documents, ...this.files.values()].map(d => ({ id: d.id, kind: d.kind || 'file', title: d.title,
                source: d.source, state: d.state, reason: d.reason || '', path: d.state === 'saved' ? d.path : null,
                updated: d.updated || null, captured: d.captured || d.fetched || null, due: d.due || null, posted: d.posted || null,
                size: d.size || null, mime: d.mime || null, notices: d.notices || [], refs: d.refs || [] }));
            return { format: 1, courseId: this.courseId, course: this.title, origin: this.origin, started: this.started,
                finished: new Date().toISOString(), selected: this.selected, coverage: this.coverage, modules: this.modules,
                partial: this.coverage.some(c => c.state !== 'enumerated') || items.some(i => i.state !== 'saved' || i.notices.length),
                limits: this.limits, timings: { ...this.timings }, items };
        }
        clear() { for (const f of this.files.values()) delete f.bytes; this.documents.length = 0; this.files.clear(); this.usedBytes = 0; }
    }
    root.CanvasOffline = { Session, ArchiveError, LIMITS, safeName, canonical, fileIdentity, localHref, sanitizedBody, references, shell, esc };
    if (typeof module !== 'undefined') module.exports = root.CanvasOffline;
})(typeof window === 'undefined' ? globalThis : window);
