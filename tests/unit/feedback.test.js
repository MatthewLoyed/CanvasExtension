const fs = require('fs');
const path = require('path');
let submit;
let warning;

beforeEach(() => {
  document.body.innerHTML = fs.readFileSync(path.join(__dirname, '../../src/popup/popup.html'), 'utf8');
  global.chrome = {
    tabs: { query: jest.fn().mockResolvedValue([]) },
    storage: { sync: { get: jest.fn((keys, callback) => callback({})), set: jest.fn() } },
    runtime: { getManifest: () => ({ version: '1.10.2' }) }
  };
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
  window.alert = jest.fn();
  warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const add = jest.spyOn(document, 'addEventListener').mockImplementation(() => {});
  new Function(fs.readFileSync(path.join(__dirname, '../../src/popup/popup.js'), 'utf8'))();
  const initialize = add.mock.calls.find(([event]) => event === 'DOMContentLoaded')[1];
  add.mockRestore();
  initialize();
  document.getElementById('feedback-message').value = 'A reproducible download issue';
  const button = document.getElementById('btn-send-feedback');
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));
  submit = async () => { button.click(); await flush(); };
});

afterEach(() => { warning.mockRestore(); delete global.chrome; delete global.fetch; });

test('sends only explicit feedback and version to the public submission endpoint', async () => {
  document.getElementById('feedback-email').value = 'tester@example.com';
  await submit();
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe('https://formspree.io/f/mbddrqao');
  expect(options).toMatchObject({ method: 'POST', credentials: 'omit', headers: { Accept: 'application/json' } });
  expect(JSON.parse(options.body)).toEqual({
    email: 'tester@example.com',
    message: '[Feature Request]\nA reproducible download issue\n\n-- Extension Version --\n1.10.2',
    _subject: 'Extension Feedback: Feature Request'
  });
  expect(document.getElementById('feedback-success').style.display).toBe('block');
});

test('allows anonymous feedback without a made-up email', async () => {
  await submit();
  expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty('email');
});

test.each(['http', 'network'])('preserves the message and allows retry after %s failure', async kind => {
  if (kind === 'http') fetch.mockResolvedValue({ ok: false });
  else fetch.mockRejectedValue(new Error('Offline'));
  await submit();
  expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('could not be confirmed as sent'));
  expect(document.getElementById('feedback-success').style.display).not.toBe('block');
  expect(document.getElementById('feedback-message').value).toBe('A reproducible download issue');
  expect(document.getElementById('btn-send-feedback').disabled).toBe(false);
});

test.each(['empty message', 'invalid email'])('does not submit %s', async kind => {
  if (kind === 'empty message') document.getElementById('feedback-message').value = '  ';
  else document.getElementById('feedback-email').value = 'not-an-email';
  await submit();
  expect(fetch).not.toHaveBeenCalled();
  expect(window.alert).toHaveBeenCalled();
});
