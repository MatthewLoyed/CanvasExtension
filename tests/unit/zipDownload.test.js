/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const JSZip = require('../../src/vendor/jszip.min.js');

describe('ZIP download contents', () => {
    let context;
    let messages;
    let download;
    beforeEach(() => {
        messages = [];
        download = jest.fn((options, callback) => callback(1));
        context = vm.createContext({
            JSZip, console, setTimeout,
            fetch: jest.fn(async url => ({
                ok: true,
                headers: { get: () => 'application/pdf' },
                arrayBuffer: async () => Buffer.from(url)
            })),
            chrome: {
                storage: { sync: { get: (keys, callback) => callback({ useCanvasResourcesFolder: false }) } },
                downloads: { download },
                tabs: { sendMessage: async () => {} },
                runtime: { sendMessage: async msg => messages.push(msg) }
            }
        });
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/background/download-engine.js'), 'utf8'), context);
    });

    const item = (filename, url) => ({ filename, url, originalHref: url, type: '.pdf', courseName: 'Course' });

    test('keeps every file when names collide, including case and numbered names', async () => {
        const items = [item('Notes', 'one'), item('notes', 'two'), item('Notes (1)', 'three')];
        await context.buildAndDownloadZip(items, 'Course', 1);
        expect(download).toHaveBeenCalledTimes(1);
        const { url, filename } = download.mock.calls[0][0];
        expect(filename).toBe('Course.zip');
        const zip = await JSZip.loadAsync(url.split(',')[1], { base64: true });
        const contents = await Promise.all(Object.values(zip.files).map(file => file.async('string')));
        expect(contents).toEqual(['one', 'two', 'three']);
        expect(Object.keys(zip.files).map(name => name.toLowerCase())).toEqual(['notes.pdf', 'notes (1).pdf', 'notes (1) (1).pdf']);
        expect(context.fetch).toHaveBeenCalledWith('one', { credentials: 'include' });
    });

    test('rejects login HTML and reports failure instead of saving it as a PDF', async () => {
        context.fetch.mockResolvedValue({ ok: true, headers: { get: () => 'text/html; charset=utf-8' } });
        await context.buildAndDownloadZip([item('Notes', 'login')], 'Course', 1);
        expect(download).not.toHaveBeenCalled();
        expect(messages).toContainEqual(expect.objectContaining({ action: 'download_file_status', status: 'error' }));
        expect(messages).toContainEqual(expect.objectContaining({ phase: 'error', done: true, errors: 1 }));
    });

    test('legitimate Canvas HTML slides remain downloadable with the correct module folder', async () => {
        context.fetch.mockResolvedValue({ ok: true, headers: { get: () => 'text/html' }, url: 'https://cdn.example.edu/slides.html', arrayBuffer: async () => Buffer.from('<html>Lecture slides</html>') });
        await context.buildAndDownloadZip([{ ...item('Slides.html', 'slides'), type: '.html', moduleId: '1', moduleName: 'Lectures', allowHtml: true, isCanvasFile: true }], 'Course', 1, { runId: 'html' });
        const zip = await JSZip.loadAsync(download.mock.calls[0][0].url.split(',')[1], { base64: true });
        expect(await zip.file('Lectures/Slides.html').async('string')).toBe('<html>Lecture slides</html>');
        expect(messages).toContainEqual(expect.objectContaining({ runId: 'html', phase: 'done' }));
    });

    test('even a known HTML attachment cannot turn a login redirect into a saved file', async () => {
        context.fetch.mockResolvedValue({ ok: true, headers: { get: () => 'text/html' }, url: 'https://canvas.example/login/saml' });
        await context.buildAndDownloadZip([{ ...item('Slides.html', 'slides'), type: '.html', allowHtml: true, isCanvasFile: true }], 'Course', 1);
        expect(download).not.toHaveBeenCalled();
    });

    test('same-name files in different modules retain both folders in the archive', async () => {
        await context.buildAndDownloadZip([{ ...item('Notes', 'one'), moduleId: '1', moduleName: 'Week 1' }, { ...item('Notes', 'two'), moduleId: '2', moduleName: 'Week 2' }], 'Course', 1);
        const zip = await JSZip.loadAsync(download.mock.calls[0][0].url.split(',')[1], { base64: true });
        expect(await zip.file('Week 1/Notes.pdf').async('string')).toBe('one');
        expect(await zip.file('Week 2/Notes.pdf').async('string')).toBe('two');
    });
});
