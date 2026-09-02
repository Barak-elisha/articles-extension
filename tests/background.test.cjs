const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../background.js'), 'utf8');
function setup({ fetch, tabs, result, timer } = {}) {
  let listener, target, cleared = false;
  const context = vm.createContext({ console, AbortController,
    setTimeout: timer || setTimeout, clearTimeout: timer ? () => { cleared = true; } : clearTimeout,
    fetch: fetch || (() => { throw Error('Unexpected network request'); }),
    chrome: {
      runtime: { getURL: () => 'chrome-extension://test/', onMessage: { addListener: fn => listener = fn } },
      sidePanel: { setPanelBehavior: async () => {} },
      tabs: { query: async query => tabs ? tabs(query) : [{ id: 1, url: 'https://example.com/article' }] },
      scripting: { executeScript: async options => { target = options.target; return result || [{ result: { title: 'Article', content: 'Text', url: 'https://example.com/article' } }]; } }
    }
  });
  vm.runInContext(source, context);
  return { call: message => new Promise(resolve => listener(message, {}, resolve)), target: () => target, cleared: () => cleared };
}
const success = parts => ({ ok: true, json: async () => ({ candidates: [{ content: { parts } }] }) });
test('Extraction targets active HTTP page and returns data', async () => {
  const app = setup(); const response = await app.call({ type: 'EXTRACT_ARTICLE' });
  assert.equal(response.ok, true); assert.equal(app.target().tabId, 1); assert.equal(response.data.title, 'Article');
});
test('Full window chooses most recently accessed web tab only', async () => {
  const app = setup({ tabs: q => q.active ? [{ id: 7, url: 'chrome-extension://test/sidepanel.html' }] : [
    { id: 2, url: 'https://example.com/a', lastAccessed: 10 }, { id: 3, url: 'http://example.com/b', lastAccessed: 20 },
    { id: 4, url: 'httpfake:bad', lastAccessed: 99 }
  ] });
  assert.equal((await app.call({ type: 'EXTRACT_ARTICLE' })).ok, true); assert.equal(app.target().tabId, 3);
});
test('Restricted pages do not execute extraction', async () => {
  const app = setup({ tabs: () => [{ id: 1, url: 'chrome://settings' }] });
  assert.equal((await app.call({ type: 'EXTRACT_ARTICLE' })).ok, false); assert.equal(app.target(), undefined);
});
test('AI sends key in header only, limits article, defaults to supported model, skips thought parts', async () => {
  let request;
  const app = setup({ fetch: async (url, opts) => { request = { url, opts }; return success([{ text: 'private reasoning', thought: true }, { text: ' Summary ' }]); } });
  const result = await app.call({ type: 'GENERATE_SUMMARY', apiKey: 'TEST_KEY', title: 'Title', content: 'x'.repeat(20000) });
  assert.equal(result.summary, 'Summary'); assert.match(request.url, /gemini-2\.5-flash:generateContent$/);
  assert.ok(!request.url.includes('TEST_KEY')); assert.equal(request.opts.headers['x-goog-api-key'], 'TEST_KEY');
  const payload = JSON.parse(request.opts.body);
  assert.equal(payload.generationConfig.thinkingConfig.thinkingBudget, 0);
  const prompt = payload.contents[0].parts[0].text;
  assert.equal((prompt.match(/x/g) || []).length, 12000); assert.ok(request.opts.signal);
});
test('Chat bounds history and maps assistant roles', async () => {
  let body;
  const app = setup({ fetch: async (_, opts) => { body = JSON.parse(opts.body); return success([{ text: 'Answer' }]); } });
  const messages = Array.from({ length: 25 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: String(i) }));
  assert.equal((await app.call({ type: 'CHAT_ARTICLE', apiKey: 'TEST', content: 'Article', messages })).text, 'Answer');
  assert.equal(body.contents.length, 21); assert.equal(body.contents[1].parts[0].text, '5'); assert.equal(body.contents[1].role, 'model'); assert.ok(body.systemInstruction);
});
test('Missing key and empty model response produce actionable errors', async () => {
  assert.match((await setup().call({ type: 'GENERATE_SUMMARY' })).error, /API key/);
  const app = setup({ fetch: async () => success([]) });
  assert.match((await app.call({ type: 'GENERATE_SUMMARY', apiKey: 'TEST', content: '' })).error, /did not return/);
});
test('Google error is returned through runtime message contract', async () => {
  const app = setup({ fetch: async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'Quota exceeded' } }) }) });
  const response = await app.call({ type: 'GENERATE_SUMMARY', apiKey: 'TEST', content: 'Text' });
  assert.equal(response.ok, false); assert.match(response.error, /Quota exceeded/);
});
test('Timeout aborts stalled AI request and releases timer', async () => {
  let expire;
  const app = setup({ timer: fn => { expire = fn; return 1; }, fetch: (_, opts) => new Promise((_, reject) => {
    opts.signal.addEventListener('abort', () => reject(Error('Aborted'))); queueMicrotask(expire);
  }) });
  const response = await app.call({ type: 'GENERATE_SUMMARY', apiKey: 'TEST', content: 'Text' });
  assert.equal(response.ok, false); assert.match(response.error, /timed out/); assert.equal(app.cleared(), true);
});
