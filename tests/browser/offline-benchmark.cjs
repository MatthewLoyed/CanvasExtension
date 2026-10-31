/* Controlled latency benchmark; no Canvas requests or user data. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { Blob } = require('buffer');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run(concurrency) {
    const dom = new JSDOM('', { runScripts: 'outside-only' });
    Object.assign(dom.window, { TextEncoder, TextDecoder, Blob });
    dom.window.eval(fs.readFileSync(path.join(__dirname, '../../src/offline/core.js'), 'utf8'));
    const origin = 'https://fixture.instructure.com';
    const session = new dom.window.CanvasOffline.Session({ origin, courseId: 42, request: async route => {
        await delay(10);
        if (route.includes('/users/self/profile')) return { data: { id: 7 } };
        const id = route.split('/').pop();
        return { data: { id, display_name: `${id}.pdf`, 'content-type': 'application/pdf', size: 65536, url: `${origin}/files/${id}/download` } };
    } });
    session.viewer = '7';
    for (let id = 1; id <= 12; id++) session.addFile(id, 'Benchmark');
    const pool = session.parallel.bind(session);
    session.parallel = (items, work) => pool(items, work, concurrency);
    const start = performance.now();
    await session.fetchFiles(async url => {
        await delay(20); let sent = false;
        return { ok: true, status: 200, url, headers: { get: () => 'application/pdf' }, body: { getReader: () => ({
            read: async () => sent ? { done: true } : (sent = true, { value: new Uint8Array(65536), done: false }), cancel: async () => {}
        }) } };
    });
    const ms = Math.round(performance.now() - start);
    const saved = [...session.files.values()].filter(f => f.state === 'saved').length;
    if (saved !== 12 || session.usedBytes !== 12 * 65536 || session.pendingBytes !== 0) throw new Error('Benchmark archive differs');
    dom.window.close(); return { concurrency, ms, saved };
}
(async () => {
    const sequential = await run(1), parallel = await run(3), sixWorkers = await run(6), nineWorkers = await run(9);
    console.log(JSON.stringify({ sequential, parallel, sixWorkers, nineWorkers, speedup: +(sequential.ms / nineWorkers.ms).toFixed(2), note: 'Synthetic latency; not a live Canvas benchmark.' }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
