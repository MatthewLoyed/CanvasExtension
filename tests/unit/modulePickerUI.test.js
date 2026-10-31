const fs = require('fs');
const path = require('path');
const load = name => window.eval(fs.readFileSync(path.join(__dirname, '../../src/content', name), 'utf8'));

describe('module picker in the existing dropdown', () => {
    let listeners, requests, runtimeListeners;
    const one = { href: 'http://localhost/files/1/download', text: 'One.pdf', type: '.pdf', courseName: 'Course' };
    const two = { href: 'http://localhost/files/2/download', text: 'Two.pdf', type: '.pdf', courseName: 'Course' };
    beforeEach(() => {
        jest.useFakeTimers(); listeners = []; requests = []; runtimeListeners = [];
        const add = document.addEventListener.bind(document);
        jest.spyOn(document, 'addEventListener').mockImplementation((...args) => { listeners.push(args); add(...args); });
        document.body.innerHTML = '<div id="application"></div><div hidden><nav id="breadcrumbs"></nav><div class="header-bar-right"></div></div><div id="content"></div>';
        window.CSS = { escape: value => value.replace(/["\\]/g, '\\$&') };
        window.chrome = { runtime: { getURL: value => value, onMessage: { addListener: fn => runtimeListeners.push(fn) } } };
        load('api.js'); load('course.js'); load('ui-builder.js');
        window.CanvasDownloader.extractCourseId = () => '100';
        window.CanvasDownloader.isModuleListPage = () => false;
        document.addEventListener('cdl-request', event => {
            requests.push(event.detail);
            document.dispatchEvent(new CustomEvent('cdl-response', { detail: { responseId: event.detail.responseId, response: { success: true } } }));
        });
        load('inject-ui.js'); jest.advanceTimersByTime(50);
        document.getElementById('cdl-browse-course').click();
        publish([{ id: 'a', name: 'Week 1', files: [one] }, { id: 'b', name: 'Week 2', files: [two] }, { id: 'c', name: 'Recordings', files: [] }]);
    });
    afterEach(() => { listeners.forEach(args => document.removeEventListener(...args)); jest.restoreAllMocks(); jest.clearAllTimers(); jest.useRealTimers(); });
    function publish(groups, scanning = false) {
        document.dispatchEvent(new CustomEvent('cdl-course-state', { detail: { groups, scanning, complete: !scanning, error: '' } }));
    }
    test('course browsing works from a page with no files, and subset downloads retain module identity', () => {
        expect(document.getElementById('cdl-toolbar').style.display).toBe('inline-flex');
        expect(document.getElementById('cdl-toolbar').parentElement.id).toBe('content');
        expect(document.querySelectorAll('.cdl-module')).toHaveLength(3);
        expect(document.querySelector('[aria-label="Select module Recordings"]').disabled).toBe(true);
        document.querySelector('[aria-label="Select module Week 2"]').click();
        document.getElementById('cdl-main-btn').click();
        const batch = requests.find(msg => msg.action === 'resolve_and_download_batch');
        expect(batch.files).toHaveLength(1);
        expect(batch.files[0]).toEqual(expect.objectContaining({ moduleId: 'a', moduleName: 'Week 1' }));
        expect(batch.runId).toBeTruthy();
    });
    test('a deselected module stays deselected during scan updates and download waits for completion', () => {
        document.querySelector('[aria-label="Select module Week 1"]').click();
        publish([{ id: 'a', name: 'Week 1', files: [one, { ...two, href: 'http://localhost/files/3' }] }, { id: 'b', name: 'Week 2', files: [two] }], true);
        expect(document.querySelector('[aria-label="Select module Week 1"]').checked).toBe(false);
        expect(document.getElementById('cdl-main-btn').disabled).toBe(true);
    });
    test('switching back to the page preserves the original narrow download selection', () => {
        document.dispatchEvent(new CustomEvent('cdl-files-ready', { detail: { files: [one] } }));
        document.getElementById('cdl-back-page').click();
        expect(document.querySelectorAll('.cdl-module')).toHaveLength(0);
        expect(document.querySelectorAll('.cdl-file-item')).toHaveLength(1);
        document.getElementById('cdl-main-btn').click();
        expect(requests.find(msg => msg.action === 'resolve_and_download_batch').files[0].moduleId).toBeUndefined();
    });
    test('another tab/run cannot finish or change progress of the active run', () => {
        document.getElementById('cdl-main-btn').click();
        runtimeListeners.forEach(fn => fn({ action: 'download_progress', runId: 'unrelated', completed: 100, errors: 0, total: 100, done: true }));
        expect(document.getElementById('cdl-button-group').classList.contains('is-loading')).toBe(true);
    });
    test('completion restores the course count and retry resolves only failed files again', () => {
        document.dispatchEvent(new CustomEvent('cdl-files-ready', { detail: { files: [one] } }));
        document.getElementById('cdl-main-btn').click();
        const batch = requests.find(msg => msg.action === 'resolve_and_download_batch');
        runtimeListeners.forEach(fn => fn({ action: 'download_file_status', runId: batch.runId, href: two.href, status: 'error' }));
        runtimeListeners.forEach(fn => fn({ action: 'download_progress', runId: batch.runId, completed: 1, errors: 1, total: 2, done: true }));
        jest.advanceTimersByTime(3000);
        expect(document.getElementById('cdl-file-count').textContent).toBe('(2 Files)');
        expect(document.getElementById('cdl-retry-failed').hidden).toBe(false);
        document.getElementById('cdl-retry-failed').click();
        const retry = requests.filter(msg => msg.action === 'resolve_and_download_batch').at(-1);
        expect(retry.runId).not.toBe(batch.runId);
        expect(retry.files.map(file => file.href)).toEqual([two.href]);
        expect(retry.files[0].moduleId).toBe('b');
    });
});
