// All features require tests before a task is marked complete.
// Unit tests: pure logic, no I/O. Integration tests: live bot/Claude calls.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

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

// ── Unit: message truncation ──────────────────────────────────
describe('message truncation', () => {
  function truncate(text, limit = 4096) {
    return text.length > limit ? text.slice(0, limit - 6) + '…' : text;
  }

  it('passes short messages through unchanged', () => {
    assert.equal(truncate('hello'), 'hello');
  });

  it('truncates messages over 4096 chars', () => {
    const long = 'x'.repeat(5000);
    const result = truncate(long);
    assert.ok(result.length <= 4096);
    assert.ok(result.endsWith('…'));
  });
});

// ── Integration stub ──────────────────────────────────────────
// Run with live credentials: TELEGRAM_BOT_TOKEN=... ANTHROPIC_API_KEY=... node --test tests/
describe('integration (skipped — requires live env)', () => {
  it.skip('sends a message and receives a reply', () => {
    // TODO: send a test message to the bot's webhook and verify the reply
  });
});
