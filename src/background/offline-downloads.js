/* Privileged file I/O only. The Canvas modal owns archive state and ZIP generation. */
(() => {
    const FILE_LIMIT = 50 * 1024 * 1024;
    const sourceOrigin = sender => {
        try {
            const u = new URL(sender.tab?.url);
            return sender.tab?.id != null && u.protocol === 'https:' && (/^\/(?:dashboard\/?)?$/.test(u.pathname) || /^\/courses\/\d+(?:\/|$)/.test(u.pathname)) ? u.origin : null;
        } catch { return null; }
    };
    const allowed = (url, origin) => url.protocol === 'https:' && !url.username && !url.password &&
        (url.origin === origin || /(^|\.)(?:canvas-user-content\.com|inscloudgate\.net)$/i.test(url.hostname) ||
            (url.hostname === 'instructure-uploads.s3.amazonaws.com' && /^\/account_\d+\/attachments\/\d+\//.test(url.pathname)));
    const encode = bytes => {
        let text = ''; for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
        return btoa(text);
    };
    chrome.runtime.onConnect.addListener(port => {
        if (port.name !== 'cdl-offline-asset-v1') return;
        const origin = sourceOrigin(port.sender);
        const controller = new AbortController();
        let reader, started = false, pulling = false, total = 0, closed = false, remainder;
        const timer = setTimeout(() => controller.abort(), 60000);
        const send = data => { if (!closed) { try { port.postMessage(data); } catch { stop(); } } };
        const stop = () => { if (closed) return; closed = true; clearTimeout(timer); controller.abort(); reader?.cancel().catch(() => {}); };
        port.onDisconnect.addListener(stop);
        port.onMessage.addListener(async msg => {
            if (closed || msg.type === 'ping') return;
            try {
                if (msg.type === 'start' && !started) {
                    started = true;
                    const url = new URL(msg.url);
                    if (!origin || !allowed(url, origin)) throw new Error('Unsupported Canvas file source.');
                    const response = await fetch(url.href, { credentials: 'include', signal: controller.signal });
                    const final = new URL(response.url);
                    if (response.status === 401 || /\/(login|sso|saml|cas)(?:[/?]|$)/i.test(final.href)) {
                        const e = new Error('Sign in to Canvas, then retry the export.'); e.code = 'auth'; throw e;
                    }
                    if (!allowed(final, origin)) throw new Error('File redirected outside supported Canvas hosts.');
                    reader = response.body?.getReader();
                    send({ type: 'headers', ok: response.ok, status: response.status, url: final.href,
                        contentType: response.headers.get('content-type'), retryAfter: response.headers.get('retry-after') });
                } else if (msg.type === 'pull' && reader && !pulling) {
                    pulling = true;
                    const part = remainder ? { value: remainder, done: false } : await reader.read();
                    remainder = null;
                    if (part.done) { send({ type: 'chunk', done: true }); clearTimeout(timer); }
                    else {
                        // Backpressure and bounded messages avoid Chrome's JSON message-size ceiling.
                        const bytes = part.value.subarray(0, 256 * 1024);
                        if (part.value.length > bytes.length) remainder = part.value.subarray(bytes.length);
                        total += bytes.length;
                        if (total > FILE_LIMIT) throw new Error('Attachment exceeds the 50 MiB file limit.');
                        send({ type: 'chunk', done: false, bytes: encode(bytes) });
                    }
                    pulling = false;
                } else if (msg.type === 'cancel') { stop(); port.disconnect(); }
            } catch (error) { send({ type: 'error', message: error.message, code: error.code || (error.name === 'AbortError' || error instanceof TypeError ? 'transient' : 'file') }); stop(); }
        });
    });

    const owners = new Map();
    const key = id => `cdl-offline-save-${id}`;
    async function owned(id, tabId) {
        if (owners.get(id) === tabId) return true;
        const stored = await chrome.storage.session?.get(key(id));
        return stored?.[key(id)] === tabId;
    }
    chrome.runtime.onMessage.addListener((msg, sender, reply) => {
        if (!['offline_save_archive', 'offline_archive_status', 'offline_cancel_archive'].includes(msg.action)) return;
        const origin = sourceOrigin(sender);
        if (!origin) { reply({ error: 'Open export from the Canvas dashboard or course.' }); return; }
        (async () => {
            if (msg.action === 'offline_save_archive') {
                const url = new URL(msg.url);
                if (url.protocol !== 'blob:' || url.origin !== origin || !/^[^/\\\x00-\x1f]{1,180}\.zip$/i.test(msg.filename || '')) throw new Error('Invalid archive save request.');
                const id = await chrome.downloads.download({ url: url.href, filename: msg.filename, conflictAction: 'uniquify', saveAs: false });
                owners.set(id, sender.tab.id);
                await chrome.storage.session?.set({ [key(id)]: sender.tab.id });
                return { id };
            }
            if (!Number.isInteger(msg.id) || !await owned(msg.id, sender.tab.id)) throw new Error('Archive download does not belong to this tab.');
            if (msg.action === 'offline_cancel_archive') { await chrome.downloads.cancel(msg.id); return { state: 'interrupted' }; }
            const [download] = await chrome.downloads.search({ id: msg.id });
            if (!download) throw new Error('Archive download was removed.');
            if (['complete', 'interrupted'].includes(download.state)) { owners.delete(msg.id); await chrome.storage.session?.remove?.(key(msg.id)); }
            return { state: download.state, error: download.error || null };
        })().then(reply).catch(error => reply({ error: error.message }));
        return true;
    });
})();
