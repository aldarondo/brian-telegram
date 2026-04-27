import { existsSync } from 'fs';
import { app, familyMap, enqueue, SESSION_TTL_MS, MCP_CONFIG } from './bot.js';
import { loadSchedules, startScheduler } from './scheduler.js';

const PORT = process.env.PORT || 3100;

app.listen(PORT, () => {
  console.log(`brian-telegram listening on :${PORT}`);
  console.log(`Family: ${Object.keys(familyMap).join(', ') || '(none configured)'}`);
  console.log(`MCP config: ${existsSync(MCP_CONFIG) ? MCP_CONFIG : 'not found'}`);
  console.log(`Session TTL: ${SESSION_TTL_MS / 3_600_000}h`);
  if (!process.env.PUSH_SECRET)    console.warn('[config] PUSH_SECRET is not set — /push endpoint will reject all requests');
  if (!process.env.WEBHOOK_SECRET) console.warn('[config] WEBHOOK_SECRET is not set — Telegram webhook requests are not signature-verified');

  if (process.env.SCHEDULER_DISABLED !== '1') {
    const schedules = loadSchedules();
    if (schedules.length) {
      startScheduler({ schedules, enqueue, familyMap, defaultTimezone: process.env.TZ });
    } else {
      console.log('[scheduler] No schedules configured (config/schedules.json absent or empty)');
    }
  }
});
