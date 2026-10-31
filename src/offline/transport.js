/* Reads stay in the Canvas content script, using its existing login.
   No tokens, arbitrary endpoints, coursework mutations, or page-world execution. */
(function (root) {
    async function canvasRead(origin, courseId, path, signal) {
        const bad = message => ({ error: message, status: 0 });
        const dashboard = /^\/(?:dashboard\/?)?$/.test(location.pathname) && !!document.querySelector('#dashboard, #DashboardCard_Container');
        if (location.origin !== origin || (!dashboard && !new RegExp(`^/courses/${courseId}(?:/|$)`).test(location.pathname)) ||
            !document.querySelector('#application') || !document.querySelector('#breadcrumbs, .ic-app-nav-toggle-and-main-content, #global_nav_dashboard_link')) {
            return bad('Keep the Canvas dashboard or selected course open.');
        }
        let url;
        try { url = new URL(path, origin); } catch { return bad('Invalid Canvas URL.'); }
        const c = String(courseId);
        if (!/^\d+$/.test(c) || url.origin !== origin || url.username || url.password ||
            !new RegExp(`^/api/v1/(users/self/profile|files/\\d+|courses/${c}(?:/(?:front_page|pages(?:/[^/]+)?|modules(?:/\\d+/items)?|assignments(?:/\\d+)?|discussion_topics(?:/\\d+)?|files))?)/?$`).test(url.pathname)) {
            return bad('Unsupported Canvas API route.');
        }
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) controller.abort();
        const timer = setTimeout(() => controller.abort(), 30000);
        try {
            const response = await fetch(url.href, { credentials: 'include', signal: controller.signal, redirect: 'follow' });
            if (new URL(response.url).origin !== origin || /\/(login|sso|saml|cas)(?:[/?]|$)/i.test(response.url) ||
                (response.ok && !/json/i.test(response.headers.get('content-type') || ''))) {
                return { error: 'Sign in to Canvas in the original course tab, then retry.', status: 401 };
            }
            if (!response.ok) return { error: `Canvas returned HTTP ${response.status}.`, status: response.status,
                retryAfter: response.headers.get('retry-after') };
            // Stream a bounded JSON response. Do not transfer an unbounded course into extension memory.
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let text = '', bytes = 0;
            while (true) {
                const part = await reader.read();
                if (part.done) break;
                bytes += part.value.byteLength;
                if (bytes > 8 * 1024 * 1024) { await reader.cancel(); return { error: 'Canvas response exceeded the 8 MiB safety limit.', status: 413 }; }
                text += decoder.decode(part.value, { stream: true });
            }
            text += decoder.decode();
            return { data: JSON.parse(text), link: response.headers.get('link'), remaining: response.headers.get('x-rate-limit-remaining') };
        } catch {
            return bad('Canvas request interrupted or timed out. Keep the course tab open and retry.');
        } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    }

    const createLocalTransport = (origin, courseId) => (path, signal) => canvasRead(origin, courseId, path, signal);
    root.CanvasOfflineTransport = { canvasRead, createLocalTransport };
    if (typeof module !== 'undefined') module.exports = root.CanvasOfflineTransport;
})(typeof window === 'undefined' ? globalThis : window);
