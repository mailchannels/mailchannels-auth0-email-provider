const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { MockAgent, fetch } = require('undici');
const source = fs.readFileSync(require.resolve('../action.cjs'), 'utf8');
const event = () => ({
  secrets: { MAILCHANNELS_API_KEY: 'fixture-secret' },
  user: { email: 'wrong-user@example.com' },
  notification: { from: 'sender@example.com', to: 'invitee@example.com', subject: 'Verify ✓', text: 'token-fixture', html: '<p>token-fixture</p>', message_type: 'organization_invitation' },
});
async function run(input, reply, options = {}) {
  const agent = new MockAgent(); agent.disableNetConnect();
  const calls = []; const drops = []; const retries = [];
  const pool = agent.get('https://api.mailchannels.net');
  if (reply) { const interceptor = pool.intercept({ path: '/tx/v1/send', method: 'POST' }).reply((request) => {
    calls.push(request); return reply;
  });
    if (options.delay) interceptor.delay(options.delay);
  }
  const context = { exports: {}, AbortController, setTimeout, clearTimeout,
    fetch: (url, init) => {
      assert.equal(url, 'https://api.mailchannels.net/tx/v1/send');
      assert.equal(init.redirect, 'error');
      assert.ok(init.signal instanceof AbortSignal);
      return options.reject ? Promise.reject(new Error('fixture-secret token-fixture')) : fetch(url, { ...init, dispatcher: agent });
    },
    console: { log() { assert.fail('No logs allowed'); }, error() { assert.fail('No logs allowed'); } },
  };
  vm.runInNewContext(source, context);
  try {
    await context.exports.onExecuteCustomEmailProvider(input, { notification: { drop: x => drops.push(x), retry: x => retries.push(x) } });
    assert.deepEqual(retries, []);
    for (const reason of drops) assert.doesNotMatch(reason, /fixture-secret|token-fixture|invitee@/);
    return { calls, drops };
  } finally { await agent.close(); }
}
test('uses rendered notification fields including invitation recipient, preserving text/HTML', async () => {
  const { calls, drops } = await run(event(), { statusCode: 202, data: '{"results":[]}' });
  assert.equal(calls.length, 1); assert.deepEqual(drops, []);
  assert.deepEqual(JSON.parse(calls[0].body), { personalizations: [{ to: [{ email: 'invitee@example.com' }] }], from: { email: 'sender@example.com' }, subject: 'Verify ✓', content: [{ type: 'text/plain', value: 'token-fixture' }, { type: 'text/html', value: '<p>token-fixture</p>' }] });
  assert.equal(calls[0].headers['X-Api-Key'], 'fixture-secret');
});
for (const field of ['text', 'html']) test(`${field}-only notification`, async () => {
  const e = event(); delete e.notification[field === 'text' ? 'html' : 'text'];
  const r = await run(e, { statusCode: 202, data: '' });
  assert.equal(r.calls.length, 1); assert.deepEqual(r.drops, []);
  assert.equal(JSON.parse(r.calls[0].body).content.length, 1);
});
for (const status of [200, 204, 400, 401, 403, 429, 500, 503]) test(`HTTP ${status} fails once without retry or response disclosure`, async () => {
  const r = await run(event(), { statusCode: status, data: 'fixture-secret token-fixture' });
  assert.equal(r.calls.length, 1); assert.equal(r.drops.length, 1);
});
for (const status of [301, 302, 307, 308]) test(`redirect ${status} is never followed`, async () => {
  const r = await run(event(), { statusCode: status, data: '', responseOptions: { headers: { location: 'https://attacker.invalid/collect' } } });
  assert.equal(r.calls.length, 1); assert.equal(r.drops.length, 1);
});
test('transport error hides secret/message and does not request retry', async () => {
  const r = await run(event(), null, { reject: true }); assert.equal(r.drops.length, 1);
});
for (const [name, mutate] of [
  ['missing key', e => delete e.secrets.MAILCHANNELS_API_KEY],
  ['header injection', e => e.secrets.MAILCHANNELS_API_KEY = 'bad\r\nkey'],
  ['missing notification', e => delete e.notification],
  ['recipient list', e => e.notification.to = 'a@example.com,b@example.com'],
  ['display-name sender', e => e.notification.from = 'Name <a@example.com>'],
  ['missing recipient', e => delete e.notification.to],
  ['subject injection', e => e.notification.subject = 'bad\r\nsubject'],
  ['empty content', e => { e.notification.text = ''; e.notification.html = ''; }],
  ['non-string content', e => e.notification.html = {}],
]) test(`${name} rejected before HTTP`, async () => {
  const e = event(); mutate(e); const r = await run(e, null);
  assert.equal(r.calls.length, 0); assert.equal(r.drops.length, 1);
});

test('real 10-second deadline aborts a stalled response without retry', async () => {
  const start = Date.now();
  const r = await run(event(), { statusCode: 202, data: '' }, { delay: 15000 });
  assert.equal(r.calls.length, 1); assert.equal(r.drops.length, 1);
  assert.ok(Date.now() - start >= 9500);
  assert.ok(Date.now() - start < 14000);
});
