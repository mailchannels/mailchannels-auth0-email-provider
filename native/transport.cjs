'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const fs = require('node:fs');
const { onExecuteCustomEmailProvider } = require('../action.cjs');

// Run only in the network-none Docker container mapping api.mailchannels.net to
// loopback. Production source, global fetch and TLS checks remain unchanged.
async function scenario(kind, respond, expectedRequests, expectDrop) {
  let requests = 0; let targetRequests = 0;
  const drops = []; const retries = [];
  const certDir = process.env.CERT_DIR;
  const server = https.createServer({
    key: fs.readFileSync(`${certDir}/${kind}.key`),
    cert: fs.readFileSync(`${certDir}/${kind}.pem`),
  }, async (req, res) => {
    if (req.url !== '/tx/v1/send') { targetRequests++; res.end(); return; }
    requests++;
    assert.equal(req.method, 'POST');
    assert.equal(req.headers['x-api-key'], 'offline-fixture-key');
    let body = ''; for await (const chunk of req) body += chunk;
    assert.equal(JSON.parse(body).personalizations[0].to[0].email, 'recipient@example.com');
    respond(req, res);
  });
  await new Promise(resolve => server.listen(443, '127.0.0.1', resolve));
  try {
    await onExecuteCustomEmailProvider({
      secrets: { MAILCHANNELS_API_KEY: 'offline-fixture-key' },
      notification: { from: 'sender@example.com', to: 'recipient@example.com', subject: 'Fixture', text: 'private-fixture-body' },
    }, { notification: { drop: x => drops.push(x), retry: x => retries.push(x) } });
    assert.equal(requests, expectedRequests);
    assert.equal(targetRequests, 0);
    assert.equal(drops.length, expectDrop ? 1 : 0);
    assert.deepEqual(retries, []);
    for (const reason of drops) assert.doesNotMatch(reason, /offline-fixture|private-fixture|recipient@example/);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
test('trusted HTTPS: production Action sends exactly once and accepts202', () => scenario('valid', (_q,r) => { r.writeHead(202); r.end('{"results":[]}'); }, 1, false));
test('wrong hostname certificate rejected before HTTP', () => scenario('wrong', (_q,r) => r.end(), 0, true));
test('untrusted certificate rejected before HTTP', () => scenario('untrusted', (_q,r) => r.end(), 0, true));
for (const status of [301,302,307,308]) test(`real HTTPS ${status} cannot redirect credentials`, () => scenario('valid', (_q,r) => { r.writeHead(status,{Location:'https://api.mailchannels.net/collect'}); r.end(); },1,true));
for (const status of [403,429,500,503]) test(`real HTTPS ${status} has one request, no automatic replay`, () => scenario('valid',(_q,r) => {r.writeHead(status);r.end('private-fixture-body');},1,true));
test('connection destroyed after receipt: unknown outcome without replay', () => scenario('valid',(q,_r) => q.socket.destroy(),1,true));
test('real stalled HTTPS response aborts at10seconds', async () => {
 const start=Date.now();
 await scenario('valid',()=>{},1,true);
 assert.ok(Date.now()-start>=9500);
 assert.ok(Date.now()-start<14000);
});
