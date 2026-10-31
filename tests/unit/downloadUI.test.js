const fs = require('fs');
const path = require('path');

describe('injected download controls', () => {
    let listeners;
    let runtimeListeners;
    let requests;
    const file = { href: 'https://school.example.edu/files/42/download', text: 'Notes.pdf', type: '.pdf' };
    const load = name => window.eval(fs.readFileSync(path.join(__dirname, '../../src/content', name), 'utf8'));
    const publish = files => document.dispatchEvent(new CustomEvent('cdl-files-ready', { detail: { files } }));

    beforeEach(() => {
        jest.useFakeTimers();
        listeners = [];
        const add = document.addEventListener.bind(document);
        jest.spyOn(document, 'addEventListener').mockImplementation((...args) => { listeners.push(args); add(...args); });
        document.body.innerHTML = '<div id="application"></div><nav id="breadcrumbs"></nav><form id="content"></form>';
        const style = document.createElement('style');
        style.id = 'test-extension-styles';
        style.textContent = fs.readFileSync(path.join(__dirname, '../../src/content/inject-ui.css'), 'utf8');
        document.head.appendChild(style);
        window.CSS = { escape: text => text.replace(/["\\]/g, '\\$&') };
        runtimeListeners = [];
        requests = [];
        window.chrome = { runtime: { getURL: value => value, onMessage: { addListener: fn => runtimeListeners.push(fn) } } };
        load('api.js');
        load('ui-builder.js');
        load('inject-ui.js');
        jest.advanceTimersByTime(50);
        document.addEventListener('cdl-request', e => {
            requests.push(e.detail);
            document.dispatchEvent(new CustomEvent('cdl-response', { detail: { responseId: e.detail.responseId, response: { success: true } } }));
        });
        publish([file]);
    });

    afterEach(() => {
        document.getElementById('test-extension-styles').remove();
        listeners.forEach(args => document.removeEventListener(...args));
        jest.restoreAllMocks();
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    test('one file request survives repeated clicks and list re-renders, then permits retry', () => {
        document.querySelector('.cdl-file-download-btn').click();
        publish([file]);
        document.querySelector('.cdl-file-download-btn').click();
        expect(requests.filter(r => r.action === 'resolve_and_download')).toHaveLength(1);
        runtimeListeners.forEach(fn => fn({ action: 'download_file_status', href: file.href, status: 'error' }));
        document.querySelector('.cdl-file-download-btn').click();
        expect(requests.filter(r => r.action === 'resolve_and_download')).toHaveLength(2);
    });

    test('native Canvas download links do not get extra extension controls', () => {
        const content = document.getElementById('content');
        content.insertAdjacentHTML('beforeend', '<p><a data-cdl-link="true" data-cdl-href="https://school.example.edu/files/42/download" data-cdl-text="Notes.pdf" data-cdl-type=".pdf">Notes.pdf</a><a class="file_download_btn" data-cdl-link="true" data-cdl-href="https://school.example.edu/files/42/download">Download</a><a download data-cdl-link="true" data-cdl-href="https://school.example.edu/files/42/download"><svg></svg></a></p>');
        publish([file]);
        expect(content.querySelectorAll('.cdl-inline-btn-container')).toHaveLength(1);
        const link = content.querySelector('p a');
        link.insertAdjacentHTML('afterend', '<span class="canvas-preview">Preview</span>');
        jest.advanceTimersByTime(6000);
        publish([file]);
        expect(content.querySelectorAll('.cdl-inline-btn-container')).toHaveLength(1);
        expect(content.querySelector('.file_download_btn')).not.toBeNull();
        content.querySelector('.cdl-inline-btn-container').remove();
        publish([file]);
        expect(content.querySelectorAll('.cdl-inline-btn-container')).toHaveLength(1);
    });

    test('incoming scan results preserve deselection and select newly discovered files', () => {
        document.querySelector('.cdl-file-checkbox').click();
        publish([file, { ...file, href: 'https://school.example.edu/files/43/download' }]);
        const checkboxes = document.querySelectorAll('.cdl-file-checkbox');
        expect(checkboxes[0].checked).toBe(false);
        expect(checkboxes[1].checked).toBe(true);
    });

    test('download controls cannot submit a Canvas form and the ZIP toggle is available', () => {
        const submit = jest.fn(e => e.preventDefault());
        document.getElementById('content').addEventListener('submit', submit);
        document.querySelector('.cdl-file-download-btn').click();
        expect(submit).not.toHaveBeenCalled();
        expect([...document.querySelectorAll('#cdl-toolbar button')].every(btn => btn.type === 'button')).toBe(true);
        expect(window.getComputedStyle(document.getElementById('cdl-zip-toggle').parentElement).display).not.toBe('none');
    });
});
