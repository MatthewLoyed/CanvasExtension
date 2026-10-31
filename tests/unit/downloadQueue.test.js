/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('download queue completion and routing', () => {
    let ctx, queue, listeners, messages, states, saved, nextId;
    const file = (id, moduleName = 'Week 1') => ({ url: `https://cdn.example/${id}.pdf`, filename: 'Notes.pdf', originalHref: `https://canvas.example/files/${id}`, courseName: 'Course', moduleId: id, moduleName, type: '.pdf' });
    beforeEach(async () => {
        jest.useFakeTimers(); listeners = new Set(); messages = []; states = new Map(); saved = {}; nextId = 1;
        ctx = vm.createContext({ console, setTimeout, chrome: {
            storage: {
                sync: { get: (keys, callback) => callback({}) },
                session: { get: async () => JSON.parse(JSON.stringify(saved)), set: async value => { saved = JSON.parse(JSON.stringify(value)); } }
            },
            downloads: {
                onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) },
                download: jest.fn((options, callback) => { const id = nextId++; states.set(id, { id, state: 'in_progress' }); callback(id); }),
                search: ({ id }, callback) => callback(states.has(id) ? [states.get(id)] : [])
            },
            tabs: { sendMessage: async (tabId, msg) => { messages.push({ tabId, ...msg }); } },
            runtime: { sendMessage: async () => {} }
        } });
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/background/download-engine.js'), 'utf8'), ctx);
        queue = vm.runInContext('new DownloadQueue(4, 100)', ctx);
        await queue.ready;
    });
    afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
    const settle = async () => { await jest.advanceTimersByTimeAsync(0); };
    function emit(id, state, error) {
        states.set(id, { id, state, error });
        listeners.forEach(fn => fn({ id, state: { current: state }, error: { current: error } }));
    }

    test('completion means the browser finished, and interrupted files are failures', async () => {
        queue.addBatch([file(1), file(2)], { runId: 'run', tabId: 7, initialErrors: 1 });
        await settle();
        expect(messages.filter(msg => msg.action === 'download_progress').at(-1)).toEqual(expect.objectContaining({ total: 3, completed: 0, errors: 1, done: false }));
        emit(1, 'complete'); emit(2, 'interrupted', 'NETWORK_FAILED'); await settle();
        expect(messages.filter(msg => msg.action === 'download_progress').at(-1)).toEqual(expect.objectContaining({ runId: 'run', tabId: 7, completed: 1, errors: 2, done: true }));
    });

    test('each run retains its requesting tab even when another tab starts downloads', async () => {
        queue.addBatch([file(1)], { runId: 'a', tabId: 7 });
        queue.addBatch([file(2)], { runId: 'b', tabId: 8 });
        await settle(); emit(1, 'complete'); emit(2, 'complete'); await settle();
        expect(messages.filter(msg => msg.runId === 'a').every(msg => msg.tabId === 7)).toBe(true);
        expect(messages.filter(msg => msg.runId === 'b').every(msg => msg.tabId === 8)).toBe(true);
    });

    test('dispatch keeps the existing four slots and batch IDs are idempotent', async () => {
        const callbacks = [];
        ctx.chrome.downloads.download.mockImplementation((options, callback) => callbacks.push(callback));
        const files = Array.from({ length: 6 }, (_, i) => file(i));
        queue.addBatch(files, { runId: 'run' }); queue.addBatch(files, { runId: 'run' }); await settle();
        expect(callbacks).toHaveLength(4);
        callbacks[0](100); await jest.advanceTimersByTimeAsync(100);
        expect(callbacks).toHaveLength(5);
        expect(queue.active).toBe(4);
    });

    test('restores assigned downloads after a worker restart without starting them again', async () => {
        queue.addBatch([file(1)], { runId: 'resume', tabId: 9 }); await settle(); await queue._saving;
        expect(saved.cdlQueueStateV1.jobs).toHaveLength(1);
        listeners.clear();
        queue = vm.runInContext('new DownloadQueue(4, 100)', ctx); await queue.ready;
        emit(1, 'complete'); await settle();
        expect(ctx.chrome.downloads.download).toHaveBeenCalledTimes(1);
        expect(messages.filter(msg => msg.action === 'download_progress').at(-1)).toEqual(expect.objectContaining({ runId: 'resume', done: true }));
    });

    test('module folders distinguish names that sanitize to the same path', () => {
        const files = ctx.prepareModuleFolders([file(1, 'Week:1'), file(2, 'Week/1')]);
        expect(ctx.getDownloadPath(files[0], false)).toBe('Course/Week_1 (1)/Notes.pdf');
        expect(ctx.getDownloadPath(files[1], true, true)).toBe('Week_1 (2)/Notes.pdf');
        expect(ctx.getDownloadPath({ ...file(1), moduleId: undefined }, false)).toBe('Notes.pdf');
    });
});
