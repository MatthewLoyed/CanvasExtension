const fs = require('fs');
const path = require('path');
const load = name => window.eval(fs.readFileSync(path.join(__dirname, '../../src/content', name), 'utf8'));
const response = (body, link = null, status = 200) => ({ ok: status < 400, status, headers: { get: key => key === 'Link' ? link : null }, json: async () => body });

beforeEach(() => {
    document.body.innerHTML = '';
    load('api.js');
    load('course.js');
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('pagination follows complete opaque next links and rejects partial failure', async () => {
    window.fetch = jest.fn().mockResolvedValueOnce(response([{ id: 1 }], '<http://localhost/api/modules?opaque=second>; rel="next"'))
        .mockResolvedValueOnce(response([{ id: 2 }]));
    expect(await window.CanvasDownloader.fetchCanvasApi('http://localhost/api/modules', 0)).toEqual([{ id: 1 }, { id: 2 }]);
    expect(fetch.mock.calls[1][0]).toBe('http://localhost/api/modules?opaque=second');
    window.fetch.mockResolvedValueOnce(response([], '<http://localhost/api/modules?page=2>; rel="next"')).mockResolvedValueOnce(response({}, null, 500));
    await expect(window.CanvasDownloader.fetchCanvasApi('http://localhost/api/modules', 0)).rejects.toThrow('500');
});

test('rate limiting is bounded and cross-origin pagination is rejected', async () => {
    jest.useFakeTimers();
    window.fetch = jest.fn(async () => response({}, null, 429));
    const promise = window.CanvasDownloader.fetchCanvasApi('http://localhost/api/modules', 0);
    const assertion = expect(promise).rejects.toThrow('429');
    await jest.runAllTimersAsync();
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(4);
    window.fetch.mockResolvedValue(response([], '<https://evil.example/api>; rel="next"'));
    const next = window.CanvasDownloader.fetchCanvasApi('http://localhost/api/modules', 0);
    const rejected = expect(next).rejects.toThrow('origin');
    await jest.runAllTimersAsync();
    await rejected;
});

test('enumerates omitted module items and preserves page attachments and human-named files', async () => {
    const api = window.CanvasDownloader;
    api.fetchCourseModules = jest.fn(async () => [{ id: 10, name: 'Week 1', items_count: 2 }, { id: 11, name: 'Locked', state: 'locked' }]);
    const calls = [];
    api.fetchCanvasApi = jest.fn(async url => {
        calls.push(url);
        if (url.includes('/modules/10/items')) return [{ type: 'File', content_id: 1, title: 'Welcome' }, { type: 'Page', page_url: 'lecture' }];
        if (url.endsWith('/files/1')) return [{ filename: 'Welcome.png', display_name: 'Welcome', 'content-type': 'image/png' }];
        return [{ filename: 'source.qmd', 'content-type': 'text/plain' }];
    });
    api.fetchPageBody = jest.fn(async () => ({ body: '<a href="/files/2?wrap=1">Source</a><a href="/files/2?wrap=1">Source again</a>' }));
    const groups = await api.scanCourse('100');
    expect(groups).toHaveLength(1);
    expect(groups[0].files).toHaveLength(2);
    expect(groups[0].files[0]).toEqual(expect.objectContaining({ text: 'Welcome', type: '.png', moduleId: '10' }));
    expect(groups[0].files[1].type).toBe('.qmd');
    expect(calls.some(url => url.includes('/modules/10/items'))).toBe(true);
});

test('module selection keeps memberships, deduplicates downloads and reassigns shared file folder', () => {
    const api = window.CanvasDownloader;
    const shared = { href: 'http://localhost/files/42/download', text: 'Shared.pdf' };
    const model = new api.CourseSelection();
    const groups = [{ id: 'a', name: 'First', files: [shared] }, { id: 'b', name: 'Second', files: [{ ...shared, href: 'http://localhost/courses/1/files/42?wrap=1' }] }];
    model.update(groups);
    expect(model.files()).toHaveLength(1);
    expect(model.files()[0].moduleName).toBe('First');
    model.toggleModule('a', false);
    expect(model.files()[0].moduleName).toBe('Second');
    model.selectAll(false);
    model.update([...groups, { id: 'c', name: 'Third', files: [] }]);
    expect(model.files()).toEqual([]);
});

test('streamed discoveries preserve module and individual deselections', () => {
    const api = window.CanvasDownloader;
    const one = { href: 'http://localhost/files/1' }, two = { href: 'http://localhost/files/2' };
    const model = new api.CourseSelection();
    model.update([{ id: 'a', files: [one], scanning: true }, { id: 'b', files: [], scanning: true }]);
    model.toggleFile('a', one.href, false);
    model.toggleModule('b', false);
    model.update([{ id: 'a', files: [one, two] }, { id: 'b', files: [one] }]);
    expect(model.files().map(file => file.href)).toEqual([two.href]);
});
