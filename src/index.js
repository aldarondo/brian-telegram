// brian-telegram
// Telegram bot → Claude Code CLI (--resume) → Telegram reply
// No Twilio. No Gemini. No external dependencies beyond Express.

import express from 'express';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Config ──────────────────────────────────────────────────
const PORT              = process.env.PORT || 3100;
const BOT_TOKEN         = process.env.TELEGRAM_BOT_TOKEN;
const ANTHROPIC_KEY     = process.env.ANTHROPIC_API_KEY;
const MAX_TURNS         = parseInt(process.env.MAX_TURNS || '5', 10);
const SESSION_TTL_MS    = parseInt(process.env.SESSION_TTL_HOURS || '24', 10) * 60 * 60 * 1000;

if (!BOT_TOKEN)     throw new Error('TELEGRAM_BOT_TOKEN is required');
if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY is required');

// Family: { "charles": "123456789", "moriah": "987654321", ... }
// Loaded from FAMILY_TELEGRAM_IDS env var (JSON string) or config/family.json
let familyMap = {};
try {
  if (process.env.FAMILY_TELEGRAM_IDS) {
    familyMap = JSON.parse(process.env.FAMILY_TELEGRAM_IDS);
  } else {
    const cfgPath = join(ROOT, 'config', 'family.json');
    if (existsSync(cfgPath)) familyMap = JSON.parse(readFileSync(cfgPath, 'utf8'));
  }
} catch (e) {
  console.warn('[config] Could not load family Telegram ID map:', e.message);
}

// Reverse map: telegramId → name
const idToName = Object.fromEntries(
  Object.entries(familyMap).map(([name, id]) => [String(id), name])
);

// MCP config path (mounted into container)
const MCP_CONFIG = join(ROOT, 'config', 'mcp.json');

// ── Session store ───────────────────────────────────────────
const sessionsDir = join(ROOT, 'data', 'sessions');
mkdirSync(sessionsDir, { recursive: true });

function getSession(user) {
  try {
    const file = join(sessionsDir, `${user}.json`);
    if (!existsSync(file)) return null;
    const { sessionId, savedAt } = JSON.parse(readFileSync(file, 'utf8'));
    if (Date.now() - savedAt > SESSION_TTL_MS) return null;
    return sessionId;
  } catch { return null; }
}

function saveSession(user, sessionId) {
  try {
    writeFileSync(join(sessionsDir, `${user}.json`),
      JSON.stringify({ sessionId, savedAt: Date.now() }));
  } catch (e) {
    console.warn(`[session] Could not save session for ${user}:`, e.message);
  }
}

// ── Telegram send ────────────────────────────────────────────
function telegramSend(chatId, text) {
  return new Promise((resolve, reject) => {
    // Telegram max message length is 4096 chars; truncate if needed
    const safeText = text.length > 4096 ? text.slice(0, 4090) + '…' : text;
    const payload = JSON.stringify({ chat_id: chatId, text: safeText });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, res => {
      res.resume();
      if (res.statusCode === 200) resolve();
      else reject(new Error(`Telegram API ${res.statusCode}`));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Claude runner ────────────────────────────────────────────
function runClaude(user, message) {
  const existingSession = getSession(user);
  const resumeFlag = existingSession ? `--resume "${existingSession}"` : '';
  const mcpFlag = existsSync(MCP_CONFIG) ? `--mcp-config "${MCP_CONFIG}"` : '';

  // Wrap message in user context so skills know who's asking
  const prompt = `User: ${user}. Message: ${message}`;
  const escaped = prompt.replace(/"/g, '\\"').replace(/\n/g, ' ');

  const cmd = [
    'claude',
    '--output-format json',
    '--print',
    `--max-turns ${MAX_TURNS}`,
    mcpFlag,
    resumeFlag,
    `"${escaped}"`
  ].filter(Boolean).join(' ');

  const raw = execSync(cmd, {
    timeout: 120_000,
    encoding: 'utf8',
    env: { ...process.env, ANTHROPIC_API_KEY: ANTHROPIC_KEY, BRIAN_USER: user }
  });

  try {
    const parsed = JSON.parse(raw);
    if (parsed.session_id) saveSession(user, parsed.session_id);
    return parsed.result ?? raw.trim();
  } catch {
    return raw.trim();
  }
}

// ── Request queue ─────────────────────────────────────────────
// One Claude session at a time — concurrent spawns cause issues
const queue = [];
let busy = false;

function enqueue(job) {
  queue.push(job);
  drain();
}

async function drain() {
  if (busy || queue.length === 0) return;
  busy = true;
  const { user, chatId, message } = queue.shift();

  const ts = new Date().toISOString();
  console.log(`[${ts}] ${user} (${chatId}): ${message.slice(0, 80)}`);

  try {
    const reply = runClaude(user, message);
    await telegramSend(chatId, reply);
    console.log(`[${new Date().toISOString()}] → ${user}: ${String(reply).slice(0, 80)}`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error for ${user}:`, err.message);
    await telegramSend(chatId, "Brian here — I hit a snag on that one. Try again in a moment.").catch(() => {});
  }

  busy = false;
  drain();
}

// ── Express app ───────────────────────────────────────────────
const app = express();
app.use(express.json());

// Telegram webhook
app.post('/telegram', (req, res) => {
  res.sendStatus(200); // Acknowledge immediately

  const msg = req.body?.message;
  if (!msg?.text) return;

  const fromId = String(msg.from.id);
  const chatId = msg.chat.id;
  const text   = msg.text.trim();

  const user = idToName[fromId];
  if (!user) {
    console.log(`[AUTH] Unknown Telegram ID ${fromId} — blocked`);
    return;
  }

  enqueue({ user, chatId, message: text });
});

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    queue: queue.length,
    busy,
    family: Object.keys(familyMap)
  });
});

app.listen(PORT, () => {
  console.log(`brian-telegram listening on :${PORT}`);
  console.log(`Family: ${Object.keys(familyMap).join(', ') || '(none configured)'}`);
  console.log(`MCP config: ${existsSync(MCP_CONFIG) ? MCP_CONFIG : 'not found'}`);
  console.log(`Session TTL: ${SESSION_TTL_MS / 3_600_000}h`);
});
