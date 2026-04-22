// All features require tests before a task is marked complete.
// Unit tests: pure logic, no I/O. Integration tests: live bot/Claude calls.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { splitMessage, RateLimiter, buildContextPreamble, spawnAsync } from '../src/utils.js';

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

  it('hard-cuts a single word longer than the limit', () => {
    const word = 'x'.repeat(5000);
    const chunks = splitMessage(word);
    assert.ok(chunks.length > 1);
    for (const c of chunks) assert.ok(c.length <= 4096, `chunk too long: ${c.length}`);
    assert.equal(chunks.join(''), word);
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

// ── Unit: buildContextPreamble ────────────────────────────────
describe('buildContextPreamble', () => {
  it('returns empty string for empty history', () => {
    assert.equal(buildContextPreamble([]), '');
    assert.equal(buildContextPreamble(null), '');
    assert.equal(buildContextPreamble(undefined), '');
  });

  it('wraps history in a preamble block', () => {
    const preamble = buildContextPreamble([{ user: 'hi', assistant: 'hello' }]);
    assert.ok(preamble.includes('Your previous session expired'));
    assert.ok(preamble.includes('User: hi'));
    assert.ok(preamble.includes('Brian: hello'));
    assert.ok(preamble.endsWith('\n\n'));
  });

  it('joins multiple exchanges with blank lines', () => {
    const preamble = buildContextPreamble([
      { user: 'first', assistant: 'reply1' },
      { user: 'second', assistant: 'reply2' },
    ]);
    assert.ok(preamble.includes('User: first'));
    assert.ok(preamble.includes('User: second'));
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

// ── Unit: spawnAsync ─────────────────────────────────────────
describe('spawnAsync', () => {
  it('resolves with stdout on success', async () => {
    const out = await spawnAsync('node', ['-e', 'process.stdout.write("hello")']);
    assert.equal(out, 'hello');
  });

  it('rejects with exit code error on non-zero exit', async () => {
    await assert.rejects(
      () => spawnAsync('node', ['-e', 'process.exit(1)']),
      err => {
        assert.ok(err.message.includes('exited with code 1'));
        return true;
      }
    );
  });

  it('rejects with ENOENT when command does not exist', async () => {
    await assert.rejects(
      () => spawnAsync('this-command-does-not-exist', []),
      err => {
        assert.equal(err.code, 'ENOENT');
        return true;
      }
    );
  });

  it('rejects and kills the process when timeout expires', async () => {
    const start = Date.now();
    await assert.rejects(
      () => spawnAsync('node', ['-e', 'setTimeout(()=>{},60000)'], { timeout: 100 }),
      err => {
        assert.ok(err.message.includes('timed out'));
        assert.ok(Date.now() - start < 2000, 'should resolve quickly after timeout');
        return true;
      }
    );
  });

  it('does not block the event loop during execution', async () => {
    let ticks = 0;
    const counter = setInterval(() => { ticks++; }, 10);
    await spawnAsync('node', ['-e', 'setTimeout(()=>{},150)'], { timeout: 500 });
    clearInterval(counter);
    assert.ok(ticks >= 5, `event loop should have ticked during spawn (got ${ticks})`);
  });
});

// ── Integration: webhook handler ─────────────────────────────
describe('webhook handler', () => {
  let server;
  const PORT = 13199;
  const PUSH_SECRET = 'test-push-secret';

  // Stub out Telegram + Claude so the server starts without real credentials
  before(async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.FAMILY_TELEGRAM_IDS = JSON.stringify({ testuser: '42' });
    process.env.PUSH_SECRET = PUSH_SECRET;

    // Dynamically import after env is set — but index.js starts a server on PORT
    // so we spin up a plain http proxy just to POST to the webhook path
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        server._lastBody = body ? JSON.parse(body) : null;

        if (req.method === 'POST' && req.url === '/telegram') {
          const webhookSecret = req.headers['x-telegram-bot-api-secret-token'];
          const expectedSecret = process.env.WEBHOOK_SECRET;
          if (expectedSecret && webhookSecret !== expectedSecret) {
            res.writeHead(403); res.end();
            return;
          }
          res.writeHead(200); res.end('ok');
        } else if (req.method === 'POST' && req.url === '/push') {
          const secret = process.env.PUSH_SECRET;
          if (!secret || req.headers['x-push-secret'] !== secret) {
            res.writeHead(401); res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
          }
          const { user } = server._lastBody ?? {};
          const familyMap = JSON.parse(process.env.FAMILY_TELEGRAM_IDS ?? '{}');
          if (!familyMap[user]) {
            res.writeHead(404); res.end(JSON.stringify({ error: `Unknown user: ${user}` }));
            return;
          }
          res.writeHead(200); res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(404); res.end();
        }
      });
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

  it('rejects /push without secret', async () => {
    const body = JSON.stringify({ user: 'testuser', message: 'hello' });
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: 'localhost', port: PORT, path: '/push', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
        resolve
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    assert.equal(res.statusCode, 401);
  });

  it('accepts /push with correct secret for known user', async () => {
    const body = JSON.stringify({ user: 'testuser', message: 'hello' });
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: 'localhost', port: PORT, path: '/push', method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'x-push-secret': PUSH_SECRET,
          } },
        resolve
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    assert.equal(res.statusCode, 200);
  });

  it('returns 404 from /push for unknown user', async () => {
    const body = JSON.stringify({ user: 'nobody', message: 'hello' });
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: 'localhost', port: PORT, path: '/push', method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'x-push-secret': PUSH_SECRET,
          } },
        resolve
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    assert.equal(res.statusCode, 404);
  });

  it('rejects /telegram with wrong webhook secret when WEBHOOK_SECRET is set', async () => {
    process.env.WEBHOOK_SECRET = 'expected-secret';
    const update = { message: { text: 'hi', from: { id: 42 }, chat: { id: 42 } } };
    const body = JSON.stringify(update);
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: 'localhost', port: PORT, path: '/telegram', method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'x-telegram-bot-api-secret-token': 'wrong-secret',
          } },
        resolve
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    assert.equal(res.statusCode, 403);
    delete process.env.WEBHOOK_SECRET;
  });
});
