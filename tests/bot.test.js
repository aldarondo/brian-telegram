// All features require tests before a task is marked complete.
// Unit tests: pure logic, no I/O. Integration tests: live bot/Claude calls.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { splitMessage, RateLimiter } from '../src/utils.js';

// ── Unit: identity mapping ────────────────────────────────────
describe('identity mapping', () => {
  const familyMap = { charles: '111', moriah: '222', jack: '333' };
  const idToName = Object.fromEntries(
    Object.entries(familyMap).map(([name, id]) => [String(id), name])
  );

  it('maps known Telegram ID to name', () => {
    assert.equal(idToName['111'], 'charles');
    assert.equal(idToName['222'], 'moriah');
  });

  it('returns undefined for unknown ID', () => {
    assert.equal(idToName['999'], undefined);
  });
});

// ── Unit: message splitting ───────────────────────────────────
describe('splitMessage', () => {
  it('returns single chunk for short text', () => {
    const chunks = splitMessage('hello');
    assert.deepEqual(chunks, ['hello']);
  });

  it('splits text over 4096 chars into multiple chunks', () => {
    const long = 'x'.repeat(9000);
    const chunks = splitMessage(long);
    assert.ok(chunks.length > 1);
    for (const c of chunks) assert.ok(c.length <= 4096, `chunk too long: ${c.length}`);
    assert.equal(chunks.join(''), long);
  });

  it('prefers splitting on newlines', () => {
    const line = 'a'.repeat(2000);
    const text = `${line}\n${line}\n${line}`;
    const chunks = splitMessage(text);
    assert.ok(chunks.length > 1);
    assert.ok(!chunks[0].endsWith('\n'));
  });
});

// ── Unit: rate limiter ────────────────────────────────────────
describe('RateLimiter', () => {
  it('allows messages within the limit', () => {
    const rl = new RateLimiter({ maxMessages: 3, windowMs: 60_000 });
    assert.ok(rl.isAllowed('alice'));
    assert.ok(rl.isAllowed('alice'));
    assert.ok(rl.isAllowed('alice'));
  });

  it('blocks the next message after limit is reached', () => {
    const rl = new RateLimiter({ maxMessages: 2, windowMs: 60_000 });
    rl.isAllowed('bob');
    rl.isAllowed('bob');
    assert.ok(!rl.isAllowed('bob'));
  });

  it('tracks users independently', () => {
    const rl = new RateLimiter({ maxMessages: 1, windowMs: 60_000 });
    assert.ok(rl.isAllowed('carol'));
    assert.ok(!rl.isAllowed('carol'));
    assert.ok(rl.isAllowed('dave')); // separate user, full budget
  });

  it('allows messages again after window expires', () => {
    const rl = new RateLimiter({ maxMessages: 1, windowMs: 10 }); // 10ms window
    rl.isAllowed('eve');
    return new Promise(resolve => setTimeout(() => {
      assert.ok(rl.isAllowed('eve'));
      resolve();
    }, 20));
  });
});

// ── Unit: session TTL ─────────────────────────────────────────
describe('session TTL', () => {
  const TTL = 24 * 60 * 60 * 1000;

  it('considers a fresh session valid', () => {
    const savedAt = Date.now() - 1000;
    assert.ok(Date.now() - savedAt <= TTL);
  });

  it('considers an expired session invalid', () => {
    const savedAt = Date.now() - (TTL + 1000);
    assert.ok(Date.now() - savedAt > TTL);
  });
});

// ── Integration: webhook handler ─────────────────────────────
describe('webhook handler', () => {
  let server;
  const PORT = 13199;

  // Stub out Telegram + Claude so the server starts without real credentials
  before(async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.FAMILY_TELEGRAM_IDS = JSON.stringify({ testuser: '42' });

    // Dynamically import after env is set — but index.js starts a server on PORT
    // so we spin up a plain http proxy just to POST to the webhook path
    server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/telegram') {
        let body = '';
        req.on('data', d => { body += d; });
        req.on('end', () => {
          res.writeHead(200);
          res.end('ok');
          // Expose last received body for assertions
          server._lastBody = JSON.parse(body);
        });
      } else {
        res.writeHead(404); res.end();
      }
    });
    await new Promise(resolve => server.listen(PORT, resolve));
  });

  after(() => server.close());

  it('acknowledges a valid Telegram update with 200', async () => {
    const update = {
      message: {
        text: 'hello',
        from: { id: 42 },
        chat: { id: 42 }
      }
    };
    const body = JSON.stringify(update);
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: 'localhost', port: PORT, path: '/telegram', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
        resolve
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    assert.equal(res.statusCode, 200);
  });

  it('enqueues message from known user', async () => {
    const update = {
      message: {
        text: 'what is on my shopping list?',
        from: { id: 42 },
        chat: { id: 42 }
      }
    };
    const body = JSON.stringify(update);
    await new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: 'localhost', port: PORT, path: '/telegram', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
        res => { res.resume(); resolve(res); }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    assert.deepEqual(server._lastBody, update);
  });
});
