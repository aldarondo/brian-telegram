// brian-telegram
// Telegram bot → Claude Code CLI (--resume) → Telegram reply
// No Twilio. No Gemini. No external dependencies beyond Express.

import express from 'express';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import { splitMessage } from './utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Config ──────────────────────────────────────────────────
const PORT              = process.env.PORT || 3100;
const BOT_TOKEN         = process.env.TELEGRAM_BOT_TOKEN;
const MAX_TURNS         = parseInt(process.env.MAX_TURNS || '5', 10);
const SESSION_TTL_MS    = parseInt(process.env.SESSION_TTL_HOURS || '24', 10) * 60 * 60 * 1000;
if (!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is required');
// Auth: Claude CLI uses ~/.claude credentials (mounted from host) — no API key needed.

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

// Plugin dirs — load brian-family skills if cached
const PLUGIN_BASE = join(process.env.HOME || '/home/brian', '.claude', 'plugins', 'cache', 'brian-family');
const PLUGIN_NAMES = ['prescriptions', 'grocery-list', 'recipes'];
const PLUGIN_VERSION = '1.0.2';

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

function clearSession(user) {
  try {
    const file = join(sessionsDir, `${user}.json`);
    if (existsSync(file)) unlinkSync(file);
  } catch (e) {
    console.warn(`[session] Could not clear session for ${user}:`, e.message);
  }
}

// ── Telegram API ─────────────────────────────────────────────
function telegramRequest(method, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      res.resume();
      if (res.statusCode === 200) resolve();
      else reject(new Error(`Telegram API ${res.statusCode}`));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Send typing indicator (best-effort, never throws)
function sendTyping(chatId) {
  return telegramRequest('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
}

async function telegramSend(chatId, text) {
  const chunks = splitMessage(String(text));
  for (const chunk of chunks) {
    await telegramRequest('sendMessage', { chat_id: chatId, text: chunk });
  }
}

// ── Claude runner ────────────────────────────────────────────
function runClaude(user, message) {
  const existingSession = getSession(user);
  const resumeFlag = existingSession ? `--resume "${existingSession}"` : '';
  const mcpFlag = existsSync(MCP_CONFIG) ? `--mcp-config "${MCP_CONFIG}"` : '';

  // Load installed plugin skill dirs if they exist
  const pluginDirs = PLUGIN_NAMES
    .map(name => join(PLUGIN_BASE, name, PLUGIN_VERSION))
    .filter(p => existsSync(p))
    .map(p => `--plugin-dir "${p}"`)
    .join(' ');

  // Wrap message in user context so skills know who's asking
  const prompt = `User: ${user}. Message: ${message}`;
  const escaped = prompt.replace(/"/g, '\\"').replace(/\n/g, ' ');

  const cmd = [
    'claude',
    '--output-format json',
    '--print',
    `--max-turns ${MAX_TURNS}`,
    '--dangerously-skip-permissions',
    pluginDirs,
    mcpFlag,
    resumeFlag,
    '--',
    `"${escaped}"`
  ].filter(Boolean).join(' ');

  const raw = execSync(cmd, {
    timeout: 120_000,
    encoding: 'utf8',
    env: { ...process.env, BRIAN_USER: user }
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
    await sendTyping(chatId);
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

  if (text === '/reset') {
    clearSession(user);
    telegramSend(chatId, "Session cleared — starting fresh.").catch(() => {});
    return;
  }

  if (text === '/help') {
    const help = [
      "Brian can help with:",
      "",
      "💊 Prescriptions & supplements — \"what supplements am I on?\", \"add vitamin D 2000 IU\"",
      "🛒 Grocery list — \"add eggs to the grocery list\", \"what's on the list?\"",
      "🍞 Recipes — \"find a recipe for banana bread\", \"save this recipe\"",
      "☀️ Solar (Enphase) — \"how much solar did we produce today?\", \"switch to self-consumption mode\"",
      "🚗 EV charger (JuiceBox) — \"is the car charging?\", \"stop charging\", \"charge at 24A\"",
      "⚡ Coordinator — \"optimize the charging schedule\", \"charge now\"",
      "",
      "/reset — start a fresh conversation",
      "/help — this message",
    ].join("\n");
    telegramSend(chatId, help).catch(() => {});
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
