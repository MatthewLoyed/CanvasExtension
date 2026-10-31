const fs = require('fs');
const path = require('path');

function loadScript(name) {
    window.eval(fs.readFileSync(path.join(__dirname, '../../src', name), 'utf8'));
}

describe('download requests from the Canvas UI', () => {
    let messages;
    let listeners;
    beforeEach(() => {
        jest.useFakeTimers();
        listeners = [];
        const addListener = document.addEventListener.bind(document);
        jest.spyOn(document, 'addEventListener').mockImplementation((...args) => {
            listeners.push(args);
            addListener(...args);
        });
        delete window.__cdlContentScriptLoaded;
        document.body.innerHTML = '<div id="application"></div><nav id="breadcrumbs"></nav><div id="content"></div>';
        messages = [];
        window.chrome = {
            runtime: {
                sendMessage: jest.fn(msg => { messages.push(msg); return Promise.resolve({ success: true }); }),
                onConnect: { addListener: jest.fn() },
                onMessage: { addListener: jest.fn() }
            }
        };
        loadScript('content/api.js');
        window.CanvasDownloader.resolveFileUrl = jest.fn(async () => 'https://cdn.example.edu/lecture.pdf');
    });

    afterEach(() => {
        listeners.forEach(args => document.removeEventListener(...args));
        jest.restoreAllMocks();
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    async function request(detail) {
        const responseId = Math.random().toString();
        const response = new Promise(resolve => {
            const listener = e => {
                if (e.detail.responseId !== responseId) return;
                document.removeEventListener('cdl-response', listener);
                resolve(e.detail.response);
            };
            document.addEventListener('cdl-response', listener);
        });
        document.dispatchEvent(new CustomEvent('cdl-request', { detail: { ...detail, responseId } }));
        return response;
    }

    const file = { href: 'https://school.example.edu/courses/1/files/42/download', text: 'Lecture', type: '.pdf' };

    test('surface scan lists alternate links to the same Canvas file once', async () => {
        document.getElementById('content').innerHTML = `
            <a href="https://school.example.edu/courses/1/files/42/download?download_frd=1">Lecture.pdf</a>
            <a href="https://school.example.edu/files/42/download?download=1#page=2">Lecture.pdf</a>`;
        loadScript('content/content.js');
        expect((await request({ action: 'get_files' })).files).toHaveLength(1);
    });

    test.each(['resolve_and_download_batch', 'resolve_and_download_batch_zip'])(
        '%s queues one download when two wrappers resolve to the same binary', async action => {
            loadScript('content/content.js');
            await request({ action, files: [file, { ...file, href: 'https://school.example.edu/modules/items/99' }] });
            expect(messages).toHaveLength(1);
            expect(messages[0].files).toHaveLength(1);
        }
    );

    test('repeated single-file requests share an in-flight resolution', async () => {
        let finish;
        window.CanvasDownloader.resolveFileUrl.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        loadScript('content/content.js');
        const first = request({ action: 'resolve_and_download', file });
        const second = request({ action: 'resolve_and_download', file });
        finish('https://cdn.example.edu/lecture.pdf');
        await Promise.all([first, second]);
        expect(messages).toHaveLength(1);
    });

    test('a later deliberate download of the same file is allowed', async () => {
        loadScript('content/content.js');
        await request({ action: 'resolve_and_download', file });
        await request({ action: 'resolve_and_download', file });
        expect(messages).toHaveLength(2);
    });
});
