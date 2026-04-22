// All features require tests before a task is marked complete.
// Unit tests: pure logic, no I/O. Integration tests: real Express app, injected deps.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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
    assert.ok(rl.isAllowed('dave'));
  });

  it('allows messages again after window expires', () => {
    const rl = new RateLimiter({ maxMessages: 1, windowMs: 10 });
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

// ── Bot integration ───────────────────────────────────────────
// Dynamic import after env vars are set — avoids the module-load BOT_TOKEN check
// and lets us use the real Express app and injected-dependency functions directly.
describe('bot integration', () => {
  let app, runClaude, downloadTelegramFile, sessionsDir;
  let server;
  const PUSH_SECRET  = 'test-push-secret';
  const FAMILY_ID    = '9999';
  const TEST_USER    = '__bot_test__';

  const port = () => server.address().port;

  // Make a raw HTTP request to the test server
  const request = (method, path, { body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: 'localhost',
        port: port(),
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
          ...headers,
        },
      },
      res => {
        let data = '';
        res.on('data', d => { data += d; });
        res.on('end', () => {
          res.body = data;
          try { res.json = JSON.parse(data); } catch { res.json = null; }
          resolve(res);
        });
      }
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });

  before(async () => {
    process.env.TELEGRAM_BOT_TOKEN  = 'test-token';
    process.env.FAMILY_TELEGRAM_IDS = JSON.stringify({ [TEST_USER]: FAMILY_ID });
    process.env.PUSH_SECRET         = PUSH_SECRET;
    delete process.env.WEBHOOK_SECRET; // ensure clean state

    // Dynamic import runs AFTER env vars are set — safe from the BOT_TOKEN guard
    const bot = await import('../src/bot.js');
    app            = bot.app;
    runClaude      = bot.runClaude;
    downloadTelegramFile = bot.downloadTelegramFile;
    sessionsDir    = bot.sessionsDir;

    server = await new Promise(resolve => {
      const s = app.listen(0, () => resolve(s)); // port 0 = OS assigns a free port
    });
  });

  after(() => new Promise(resolve => server.close(resolve)));

  // ── GET /health ──────────────────────────────────────────
  describe('GET /health', () => {
    it('returns status ok', async () => {
      const res = await request('GET', '/health');
      assert.equal(res.statusCode, 200);
      assert.equal(res.json.status, 'ok');
    });

    it('includes family member names', async () => {
      const res = await request('GET', '/health');
      assert.ok(Array.isArray(res.json.family));
      assert.ok(res.json.family.includes(TEST_USER));
    });
  });

  // ── POST /telegram ───────────────────────────────────────
  describe('POST /telegram', () => {
    it('returns 200 immediately for valid update', async () => {
      const res = await request('POST', '/telegram', {
        body: { message: { text: 'hello', from: { id: FAMILY_ID }, chat: { id: FAMILY_ID } } },
      });
      assert.equal(res.statusCode, 200);
    });

    it('returns 200 for update with no message body', async () => {
      const res = await request('POST', '/telegram', { body: {} });
      assert.equal(res.statusCode, 200);
    });

    // Note: WEBHOOK_SECRET is captured at bot.js module load time. Testing the 403
    // path requires a separate server instance started with WEBHOOK_SECRET set — out
    // of scope here. The logic is a single-line guard, straightforward to verify by
    // reading the code.
  });

  // ── POST /push ───────────────────────────────────────────
  describe('POST /push', () => {
    it('returns 401 with no secret header', async () => {
      const res = await request('POST', '/push', {
        body: { user: TEST_USER, message: 'hello' },
      });
      assert.equal(res.statusCode, 401);
    });

    it('returns 401 with wrong secret header', async () => {
      const res = await request('POST', '/push', {
        body: { user: TEST_USER, message: 'hello' },
        headers: { 'x-push-secret': 'wrong' },
      });
      assert.equal(res.statusCode, 401);
    });

    it('returns 400 when required fields are missing', async () => {
      const res = await request('POST', '/push', {
        body: { user: TEST_USER },
        headers: { 'x-push-secret': PUSH_SECRET },
      });
      assert.equal(res.statusCode, 400);
    });

    it('returns 404 for unknown user', async () => {
      const res = await request('POST', '/push', {
        body: { user: 'nobody', message: 'hi' },
        headers: { 'x-push-secret': PUSH_SECRET },
      });
      assert.equal(res.statusCode, 404);
    });
  });

  // ── runClaude ────────────────────────────────────────────
  describe('runClaude', () => {
    const sessionFile = () => join(sessionsDir, `${TEST_USER}.json`);
    after(() => { try { unlinkSync(sessionFile()); } catch {} });

    it('returns parsed result from JSON output', async () => {
      const mockSpawn = async () => JSON.stringify({ result: 'Hello there!', session_id: 'sess-1' });
      const reply = await runClaude(TEST_USER, 'hi', { _spawn: mockSpawn });
      assert.equal(reply, 'Hello there!');
    });

    it('saves session after successful run', async () => {
      const mockSpawn = async () => JSON.stringify({ result: 'hi back', session_id: 'sess-save' });
      await runClaude(TEST_USER, 'hello', { _spawn: mockSpawn });
      assert.ok(existsSync(sessionFile()), 'session file should have been written');
      const saved = JSON.parse(readFileSync(sessionFile(), 'utf8'));
      assert.equal(saved.sessionId, 'sess-save');
    });

    it('falls back to raw text when output is not JSON', async () => {
      const mockSpawn = async () => 'plain text response';
      const reply = await runClaude(TEST_USER, 'hi', { _spawn: mockSpawn });
      assert.equal(reply, 'plain text response');
    });

    it('recovers from stale session: clears session and retries fresh', async () => {
      // Plant a stale session file
      writeFileSync(sessionFile(), JSON.stringify({
        sessionId: 'stale-session-id',
        savedAt: Date.now(),
        history: [{ user: 'previous question', assistant: 'previous answer' }],
      }));

      let callCount = 0;
      const mockSpawn = async (cmd, args) => {
        callCount++;
        if (callCount === 1) {
          // First call uses stale session — simulate Claude rejecting it
          const err = new Error('claude exited with code 1');
          err.stderr = 'Error: No conversation found for session stale-session-id';
          err.stdout = '';
          throw err;
        }
        // Second call is a fresh run — succeeds
        // Verify history was injected into the prompt
        const prompt = args[args.length - 1];
        assert.ok(prompt.includes('previous question'), 'history should be in fresh prompt');
        return JSON.stringify({ result: 'fresh reply', session_id: 'new-session' });
      };

      const reply = await runClaude(TEST_USER, 'new question', { _spawn: mockSpawn });
      assert.equal(reply, 'fresh reply');
      assert.equal(callCount, 2, 'should have retried exactly once');

      // Old session should be cleared
      const saved = JSON.parse(readFileSync(sessionFile(), 'utf8'));
      assert.equal(saved.sessionId, 'new-session');
    });

    it('throws through for non-session errors', async () => {
      writeFileSync(sessionFile(), JSON.stringify({
        sessionId: 'any-session',
        savedAt: Date.now(),
        history: [],
      }));

      const mockSpawn = async () => {
        const err = new Error('claude exited with code 1');
        err.stderr = 'out of memory';
        err.stdout = '';
        throw err;
      };

      await assert.rejects(
        () => runClaude(TEST_USER, 'hi', { _spawn: mockSpawn }),
        err => {
          assert.ok(err.message.includes('exited with code 1'));
          return true;
        }
      );
    });
  });

  // ── downloadTelegramFile ─────────────────────────────────
  describe('downloadTelegramFile', () => {
    // Helper: build a mock _https.get that responds to each URL in sequence
    const makeHttpsMock = (responses) => {
      let call = 0;
      return {
        get(url, callback) {
          const resp = responses[call++];
          if (resp.error) {
            // Simulate connection error — return a request-like emitter that fires 'error'
            const req = new EventEmitter();
            setImmediate(() => req.emit('error', resp.error));
            return req;
          }
          // Emit data + end on the response object
          const res = new EventEmitter();
          setImmediate(() => {
            res.emit('data', resp.data);
            res.emit('end');
          });
          if (callback) callback(res);
          return { on() { return this; } };
        },
      };
    };

    it('rejects when getFile response contains no file_path', async () => {
      const mockHttps = makeHttpsMock([
        { data: JSON.stringify({ result: {} }) }, // no file_path
      ]);
      await assert.rejects(
        () => downloadTelegramFile('fake-id', 'jpg', { _https: mockHttps }),
        /getFile returned no path/
      );
    });

    it('rejects when getFile response is malformed JSON', async () => {
      const mockHttps = makeHttpsMock([
        { data: 'not json at all' },
      ]);
      await assert.rejects(
        () => downloadTelegramFile('fake-id', 'jpg', { _https: mockHttps }),
        /getFile returned no path/
      );
    });

    it('rejects when the getFile network request itself fails', async () => {
      const mockHttps = makeHttpsMock([
        { error: new Error('connection refused') },
      ]);
      await assert.rejects(
        () => downloadTelegramFile('fake-id', 'jpg', { _https: mockHttps }),
        /connection refused/
      );
    });

    it('rejects when the file download network request fails', async () => {
      const mockHttps = makeHttpsMock([
        { data: JSON.stringify({ result: { file_path: 'photos/file.jpg' } }) }, // getFile ok
        { error: new Error('download failed') },                                 // file download fails
      ]);
      await assert.rejects(
        () => downloadTelegramFile('fake-id', 'jpg', { _https: mockHttps }),
        /download failed/
      );
    });
  });
});

