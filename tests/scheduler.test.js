import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateSchedule, loadSchedules, startScheduler } from '../src/scheduler.js';
import cron from 'node-cron';

// ── Unit: validateSchedule ────────────────────────────────────
describe('validateSchedule', () => {
  it('accepts a well-formed schedule', () => {
    const r = validateSchedule({ cron: '0 18 * * 0', user: 'charles', message: 'hi' });
    assert.equal(r.ok, true);
  });

  it('accepts a schedule with timezone', () => {
    const r = validateSchedule({
      cron: '*/5 * * * *', user: 'charles', message: 'hi', timezone: 'America/Phoenix',
    });
    assert.equal(r.ok, true);
  });

  it('rejects null / non-object inputs', () => {
    assert.equal(validateSchedule(null).ok, false);
    assert.equal(validateSchedule(undefined).ok, false);
    assert.equal(validateSchedule('string').ok, false);
    assert.equal(validateSchedule(42).ok, false);
  });

  it('rejects missing cron expression', () => {
    const r = validateSchedule({ user: 'charles', message: 'hi' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /cron missing/);
  });

  it('rejects empty cron string', () => {
    const r = validateSchedule({ cron: '   ', user: 'charles', message: 'hi' });
    assert.equal(r.ok, false);
  });

  it('rejects invalid cron expression', () => {
    const r = validateSchedule({ cron: 'every minute', user: 'charles', message: 'hi' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /invalid cron/);
  });

  it('rejects out-of-range cron fields', () => {
    // 99th minute is impossible
    const r = validateSchedule({ cron: '99 * * * *', user: 'charles', message: 'hi' });
    assert.equal(r.ok, false);
  });

  it('rejects missing user', () => {
    const r = validateSchedule({ cron: '* * * * *', message: 'hi' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /user missing/);
  });

  it('rejects missing message', () => {
    const r = validateSchedule({ cron: '* * * * *', user: 'charles' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /message missing/);
  });

  it('rejects non-string timezone', () => {
    const r = validateSchedule({ cron: '* * * * *', user: 'charles', message: 'hi', timezone: 42 });
    assert.equal(r.ok, false);
    assert.match(r.reason, /timezone/);
  });
});

// ── Unit: loadSchedules ───────────────────────────────────────
describe('loadSchedules', () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'sched-test-'));

  it('returns empty array when file is missing', () => {
    assert.deepEqual(loadSchedules(join(tmpRoot, 'nope.json')), []);
  });

  it('returns empty array on malformed JSON', () => {
    const p = join(tmpRoot, 'bad.json');
    writeFileSync(p, '{ this is not json');
    assert.deepEqual(loadSchedules(p), []);
  });

  it('returns empty array when file is not a JSON array', () => {
    const p = join(tmpRoot, 'object.json');
    writeFileSync(p, '{"cron":"* * * * *"}');
    assert.deepEqual(loadSchedules(p), []);
  });

  it('returns only valid entries; drops invalid ones', () => {
    const p = join(tmpRoot, 'mixed.json');
    writeFileSync(p, JSON.stringify([
      { cron: '0 18 * * 0', user: 'charles', message: 'good' },
      { cron: 'bogus',      user: 'charles', message: 'bad' },
      { cron: '* * * * *',                 message: 'no user' },
      { cron: '0 7 * * *',  user: 'jack',    message: 'also good', timezone: 'UTC' },
    ]));
    const schedules = loadSchedules(p);
    assert.equal(schedules.length, 2);
    assert.equal(schedules[0].message, 'good');
    assert.equal(schedules[1].message, 'also good');
  });

  // cleanup
  it('cleanup', () => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });
});

// ── Unit: startScheduler ──────────────────────────────────────
describe('startScheduler', () => {
  // Build a fake cron module that captures registrations and exposes a manual fire().
  const makeFakeCron = () => {
    const registered = [];
    return {
      _registered: registered,
      schedule(expr, fn, opts) {
        const entry = { expr, fn, opts, stopped: false };
        registered.push(entry);
        return {
          stop() { entry.stopped = true; },
        };
      },
      validate: cron.validate, // delegate to real validator
    };
  };

  it('throws when enqueue is missing', () => {
    assert.throws(
      () => startScheduler({ schedules: [], familyMap: {} }),
      /enqueue function is required/,
    );
  });

  it('throws when familyMap is missing', () => {
    assert.throws(
      () => startScheduler({ schedules: [], enqueue: () => {} }),
      /familyMap object is required/,
    );
  });

  it('throws when schedules is not an array', () => {
    assert.throws(
      () => startScheduler({ enqueue: () => {}, familyMap: {} }),
      /schedules array is required/,
    );
  });

  it('registers a cron task per schedule and skips unknown users', () => {
    const fakeCron = makeFakeCron();
    const enqueued = [];
    const result = startScheduler({
      schedules: [
        { cron: '0 18 * * 0', user: 'charles', message: 'weekly' },
        { cron: '0 7 * * *',  user: 'unknown', message: 'orphan' },
      ],
      enqueue: (j) => enqueued.push(j),
      familyMap: { charles: '111' },
      _cron: fakeCron,
    });
    assert.equal(result.tasks.length, 1);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].reason, 'unknown user');
    assert.equal(fakeCron._registered.length, 1);
    assert.equal(fakeCron._registered[0].expr, '0 18 * * 0');
  });

  it('passes per-schedule timezone through to cron', () => {
    const fakeCron = makeFakeCron();
    startScheduler({
      schedules: [{ cron: '0 18 * * 0', user: 'charles', message: 'hi', timezone: 'America/Phoenix' }],
      enqueue: () => {},
      familyMap: { charles: '111' },
      _cron: fakeCron,
    });
    assert.equal(fakeCron._registered[0].opts.timezone, 'America/Phoenix');
  });

  it('falls back to defaultTimezone when schedule has none', () => {
    const fakeCron = makeFakeCron();
    startScheduler({
      schedules: [{ cron: '0 18 * * 0', user: 'charles', message: 'hi' }],
      enqueue: () => {},
      familyMap: { charles: '111' },
      defaultTimezone: 'UTC',
      _cron: fakeCron,
    });
    assert.equal(fakeCron._registered[0].opts.timezone, 'UTC');
  });

  it('omits timezone option when no tz is provided', () => {
    const fakeCron = makeFakeCron();
    startScheduler({
      schedules: [{ cron: '0 18 * * 0', user: 'charles', message: 'hi' }],
      enqueue: () => {},
      familyMap: { charles: '111' },
      // no defaultTimezone
      _cron: fakeCron,
    });
    assert.equal(fakeCron._registered[0].opts.timezone, undefined);
  });

  it('firing a registered task enqueues the right job shape', () => {
    const fakeCron = makeFakeCron();
    const enqueued = [];
    startScheduler({
      schedules: [{ cron: '0 18 * * 0', user: 'charles', message: 'weekly summary' }],
      enqueue: (j) => enqueued.push(j),
      familyMap: { charles: '7689023388' },
      _cron: fakeCron,
    });

    // Manually fire the registered tick
    fakeCron._registered[0].fn();

    assert.equal(enqueued.length, 1);
    assert.deepEqual(enqueued[0], {
      user: 'charles',
      chatId: 7689023388,
      message: 'weekly summary',
    });
  });

  it('a tick that throws does not propagate up to the cron driver', () => {
    const fakeCron = makeFakeCron();
    const throwingEnqueue = () => { throw new Error('queue full'); };
    startScheduler({
      schedules: [{ cron: '* * * * *', user: 'charles', message: 'hi' }],
      enqueue: throwingEnqueue,
      familyMap: { charles: '111' },
      _cron: fakeCron,
    });
    assert.doesNotThrow(() => fakeCron._registered[0].fn());
  });
});
