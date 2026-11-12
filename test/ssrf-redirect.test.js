// The URL oracle re-checks every redirect hop: a trusted (own-origin) or public URL cannot bounce the fetch to a private address.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let srv; let port; let oracles;
before(async () => {
  srv = http.createServer((req, res) => {
    if (req.url === '/ok') { res.end('<h1>Northwind</h1>'); return; }
    if (req.url === '/to-private') { res.writeHead(302, { location: 'http://10.255.255.1/secret' }); res.end(); return; }
    if (req.url === '/to-localhost') { res.writeHead(302, { location: 'http://localhost:9/' }); res.end(); return; }
    if (req.url === '/loop') { res.writeHead(302, { location: '/loop' }); res.end(); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); port = srv.address().port;
  process.env.PUBLIC_BASE_URL = `http://127.0.0.1:${port}`; process.env.PACTLINE_ALLOW_PRIVATE_URLS = '0';
  oracles = await import('../src/oracles/index.js');
});
after(() => srv.close());

test('own origin is reachable; redirects into private space are refused', async () => {
  assert.equal((await oracles.urlOracle({ url: `http://127.0.0.1:${port}/ok`, contains: 'Northwind' })).verdict, 'pass');
  for (const p of ['/to-private', '/to-localhost']) {
    const v = await oracles.urlOracle({ url: `http://127.0.0.1:${port}${p}` });
    assert.equal(v.verdict, 'fail', p); assert.match(v.reasons[0], /private network/, p);
  }
  const loop = await oracles.urlOracle({ url: `http://127.0.0.1:${port}/loop` });
  assert.equal(loop.verdict, 'fail'); assert.match(loop.reasons[0], /HTTP 302/);
});

test('non-http schemes are refused', async () => {
  const v = await oracles.urlOracle({ url: 'file:///etc/passwd' }); assert.equal(v.verdict, 'fail');
});
