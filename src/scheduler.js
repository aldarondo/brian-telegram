// Recurring scheduler: reads config/schedules.json and fires cron-driven
// synthetic messages into the same queue as webhook traffic, so scheduled runs
// reuse session, rate limit, and reply paths.
//
// Schedule shape:
//   { "cron": "0 18 * * 0", "user": "charles", "message": "weekly summary",
//     "timezone": "America/Phoenix" }   // timezone optional; falls back to TZ env

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DEFAULT_SCHEDULES_PATH = join(ROOT, 'config', 'schedules.json');

export function validateSchedule(s, { _cron = cron } = {}) {
  if (!s || typeof s !== 'object') return { ok: false, reason: 'not an object' };
  if (typeof s.cron !== 'string' || !s.cron.trim()) return { ok: false, reason: 'cron missing' };
  if (!_cron.validate(s.cron)) return { ok: false, reason: `invalid cron: ${s.cron}` };
  if (typeof s.user !== 'string' || !s.user.trim()) return { ok: false, reason: 'user missing' };
  if (typeof s.message !== 'string' || !s.message.trim()) return { ok: false, reason: 'message missing' };
  if (s.timezone !== undefined && typeof s.timezone !== 'string') return { ok: false, reason: 'timezone must be string' };
  return { ok: true };
}

export function loadSchedules(path = DEFAULT_SCHEDULES_PATH, { _cron = cron } = {}) {
  if (!existsSync(path)) return [];
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.warn(`[scheduler] Could not parse ${path}: ${e.message}`);
    return [];
  }
  if (!Array.isArray(raw)) {
    console.warn(`[scheduler] ${path} must be a JSON array`);
    return [];
  }
  const valid = [];
  for (const s of raw) {
    const result = validateSchedule(s, { _cron });
    if (result.ok) valid.push(s);
    else console.warn(`[scheduler] Skipping invalid schedule (${result.reason}):`, s);
  }
  return valid;
}

// startScheduler registers cron tasks. Returns { tasks, skipped } so callers
// (and tests) can inspect what got wired up. _cron is injectable for tests.
export function startScheduler({
  schedules,
  enqueue,
  familyMap,
  defaultTimezone = process.env.TZ,
  _cron = cron,
} = {}) {
  if (typeof enqueue !== 'function') throw new Error('enqueue function is required');
  if (!familyMap || typeof familyMap !== 'object') throw new Error('familyMap object is required');
  if (!Array.isArray(schedules)) throw new Error('schedules array is required');

  const tasks = [];
  const skipped = [];

  for (const s of schedules) {
    const telegramId = familyMap[s.user];
    if (!telegramId) {
      console.warn(`[scheduler] Skipping schedule for unknown user "${s.user}"`);
      skipped.push({ schedule: s, reason: 'unknown user' });
      continue;
    }
    const tz = s.timezone || defaultTimezone;
    const options = tz ? { timezone: tz } : {};
    const task = _cron.schedule(s.cron, () => {
      try {
        console.log(`[scheduler] Firing ${s.user} @ ${s.cron}: ${s.message.slice(0, 80)}`);
        enqueue({ user: s.user, chatId: Number(telegramId), message: s.message });
      } catch (e) {
        console.error(`[scheduler] Failed to enqueue scheduled message for ${s.user}:`, e.message);
      }
    }, options);
    tasks.push({ schedule: s, task, timezone: tz || null });
  }

  console.log(`[scheduler] Registered ${tasks.length} schedule(s)${skipped.length ? `, skipped ${skipped.length}` : ''}`);
  return { tasks, skipped };
}
