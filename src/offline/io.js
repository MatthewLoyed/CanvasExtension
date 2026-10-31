/* Content-script adapter: streamed privileged fetches and verified ZIP saves. */
(() => {
    async function fetchAsset(url, options = {}, runtime = chrome.runtime) {
        const signal = options.signal;
        if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
        const port = runtime.connect({ name: 'cdl-offline-asset-v1' });
        let pending, headerResolve, headerReject, terminalError, ended = false;
        const headers = new Promise((resolve, reject) => { headerResolve = resolve; headerReject = reject; });
        const cleanup = () => { clearInterval(pulse); signal?.removeEventListener('abort', abort); };
        const close = () => { ended = true; cleanup(); try { port.disconnect(); } catch { /* already closed */ } };
        const fail = error => { terminalError = error; headerReject(error); pending?.reject(error); pending = null; close(); };
        const abort = () => fail(new DOMException('Export cancelled.', 'AbortError'));
        const pulse = setInterval(() => { if (!ended) { try { port.postMessage({ type: 'ping' }); } catch { fail(new Error('File connection interrupted.')); } } }, 15000);
        signal?.addEventListener('abort', abort, { once: true });
        port.onDisconnect.addListener(() => { if (!ended) fail(new Error('File connection interrupted. Please retry.')); });
        port.onMessage.addListener(msg => {
            if (msg.type === 'error') { fail(new CanvasOffline.ArchiveError(msg.message, msg.code)); return; }
            if (msg.type === 'headers') {
                headerResolve({ ok: msg.ok, status: msg.status, url: msg.url,
                    headers: { get: name => name.toLowerCase() === 'content-type' ? msg.contentType : name.toLowerCase() === 'retry-after' ? msg.retryAfter : null },
                    body: { getReader: () => ({
                        read: () => {
                            if (terminalError) return Promise.reject(terminalError);
                            if (ended) return Promise.resolve({ done: true });
                            if (pending) return Promise.reject(new Error('A file read is already pending.'));
                            return new Promise((resolve, reject) => { pending = { resolve, reject }; port.postMessage({ type: 'pull' }); });
                        },
                        cancel: async () => { close(); }
                    }) }
                });
                if (!msg.ok) close();
            } else if (msg.type === 'chunk' && pending) {
                const next = pending; pending = null;
                if (msg.done) { next.resolve({ done: true }); close(); }
                else { try { const text = atob(msg.bytes); next.resolve({ done: false, value: Uint8Array.from(text, c => c.charCodeAt(0)) }); } catch (error) { next.reject(error); fail(error); } }
            }
        });
        port.postMessage({ type: 'start', url });
        return headers;
    }
    async function saveBlob(blob, filename, signal, runtime = chrome.runtime) {
        const url = URL.createObjectURL(blob);
        let id;
        const send = async message => { const response = await runtime.sendMessage(message); if (!response || response.error) throw new Error(response?.error || 'Extension connection interrupted.'); return response; };
        const abort = () => { try { if (id != null) runtime.sendMessage({ action: 'offline_cancel_archive', id }).catch(() => {}); } catch { /* Context can disappear during page navigation or an extension reload. */ } };
        signal?.addEventListener('abort', abort, { once: true });
        try {
            if (signal?.aborted) throw new Error('Export cancelled.');
            id = (await send({ action: 'offline_save_archive', url, filename })).id;
            const started = Date.now();
            while (true) {
                if (signal?.aborted) { abort(); throw new Error('Export cancelled.'); }
                const result = await send({ action: 'offline_archive_status', id });
                if (result.state === 'complete') return;
                if (result.state === 'interrupted') throw new Error(result.error || 'ZIP save interrupted.');
                if (Date.now() - started > 600000) throw new Error('ZIP save could not be verified. Check Chrome Downloads before retrying.');
                await new Promise(resolve => { const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); }; const timer = setTimeout(done, 1000); signal?.addEventListener('abort', done, { once: true }); });
            }
        } finally { signal?.removeEventListener('abort', abort); URL.revokeObjectURL(url); }
    }
    window.CanvasOfflineIO = { fetchAsset, saveBlob };
})();
