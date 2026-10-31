const fs = require('fs');
const path = require('path');

test('unconfigured feedback submission reports failure and keeps the message', async () => {
  jest.useFakeTimers();
  document.body.innerHTML = fs.readFileSync(path.join(__dirname, '../../src/popup/popup.html'), 'utf8');
  global.chrome = {
    tabs: { query: jest.fn().mockResolvedValue([]) },
    storage: { sync: { get: jest.fn((keys, callback) => callback({})), set: jest.fn() } },
    runtime: { getManifest: () => ({ version: '1.10.1' }) }
  };
  window.alert = jest.fn();
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const source = fs.readFileSync(path.join(__dirname, '../../src/popup/popup.js'), 'utf8');
  new Function(source)();
  document.dispatchEvent(new Event('DOMContentLoaded'));
  const message = document.getElementById('feedback-message');
  message.value = 'A reproducible download issue';
  const button = document.getElementById('btn-send-feedback');
  button.click();
  await jest.advanceTimersByTimeAsync(800);
  expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Feedback was not sent'));
  expect(document.getElementById('feedback-success').style.display).not.toBe('block');
  expect(message.value).toBe('A reproducible download issue');
  expect(button.disabled).toBe(false);
  warning.mockRestore();
  jest.useRealTimers();
  delete global.chrome;
});
