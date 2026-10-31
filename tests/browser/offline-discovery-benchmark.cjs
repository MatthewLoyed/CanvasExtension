/* Synthetic discovery latency; does not contact Canvas. */
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
async function run(concurrency) {
    const dom = new JSDOM('', { runScripts: 'outside-only' });
    Object.assign(dom.window, { TextEncoder, TextDecoder });
    for (const file of ['vendor/purify.min.js', 'offline/core.js']) dom.window.eval(fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8'));
    const base = '/api/v1/courses/42'; let requests = 0;
    const session = new dom.window.CanvasOffline.Session({ origin: 'https://fixture.instructure.com', courseId: 42, request: async route => {
        requests++; await new Promise(resolve => setTimeout(resolve, 10));
        const p = new URL(route, 'https://fixture.instructure.com').pathname;
        if (p.endsWith('/users/self/profile')) return { data: { id: 7 } };
        if (p === base) return { data: { name: 'Synthetic course' } };
        if (p.endsWith('/modules')) return { data: Array.from({ length: 9 }, (_, i) => ({ id: i + 1, name: `Module ${i + 1}` })) };
        const mod = p.match(/\/modules\/(\d+)\/items$/);
        if (mod) return { data: [{ id: 100 + Number(mod[1]), type: 'Page', page_url: `page-${Number(mod[1]) % 3}`, title: 'Lesson' }] };
        const page = p.match(/\/pages\/page-(\d)$/);
        if (page) return { data: { page_id: Number(page[1]) + 1, url: `page-${page[1]}`, title: 'Lesson', body: '<p>Lesson</p>' } };
        if (p.endsWith('/pages') || p.endsWith('/front_page')) return { error: 'Disabled', status: 404 };
        return { data: [] };
    } });
    const pool = session.parallel.bind(session);
    session.parallel = (items, work) => pool(items, work, concurrency);
    const start = performance.now();
    await session.scan({ pages: true, announcements: true, assignments: true, files: true });
    const result = { concurrency, ms: Math.round(performance.now() - start), requests, pages: session.documents.length, modules: session.modules.length };
    if (result.pages !== 3 || result.modules !== 9) throw new Error('Discovery coverage differs');
    dom.window.close(); return result;
}
(async () => {
    const sequential = await run(1), parallel = await run(3);
    console.log(JSON.stringify({ sequential, parallel, speedup: +(sequential.ms / parallel.ms).toFixed(2), note: 'Synthetic discovery only; not live Canvas timing.' }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
