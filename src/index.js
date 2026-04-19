// brian-telegram
// Telegram bot → Claude Code CLI (--resume) → Telegram reply
// No Twilio. No Gemini. No external dependencies beyond Express.

import express from 'express';
import { execSync } from 'child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';
import { splitMessage, RateLimiter } from './utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Config ──────────────────────────────────────────────────
const PORT              = process.env.PORT || 3100;
const BOT_TOKEN         = process.env.TELEGRAM_BOT_TOKEN;
const MAX_TURNS         = parseInt(process.env.MAX_TURNS || '5', 10);
const SESSION_TTL_MS    = parseInt(process.env.SESSION_TTL_HOURS || '24', 10) * 60 * 60 * 1000;
const RATE_MAX_MESSAGES = parseInt(process.env.RATE_MAX_MESSAGES || '5', 10);
const RATE_WINDOW_MS    = parseInt(process.env.RATE_WINDOW_SECONDS || '60', 10) * 1_000;
const WHISPER_URL       = process.env.WHISPER_URL || 'http://synology-whisper:8778';
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

// ── Rate limiter ─────────────────────────────────────────────
const rateLimiter = new RateLimiter({ maxMessages: RATE_MAX_MESSAGES, windowMs: RATE_WINDOW_MS });

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
    try {
      await telegramRequest('sendMessage', { chat_id: chatId, text: chunk, parse_mode: 'Markdown' });
    } catch {
      await telegramRequest('sendMessage', { chat_id: chatId, text: chunk });
    }
  }
}

// Download a file from Telegram by file_id, return local tmp path
function downloadTelegramFile(fileId, ext) {
  return new Promise((resolve, reject) => {
    https.get(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        let filePath;
        try { filePath = JSON.parse(data).result?.file_path; } catch { }
        if (!filePath) return reject(new Error('getFile returned no path'));

        const tmpPath = join(tmpdir(), `brian-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
        const dest = createWriteStream(tmpPath);
        https.get(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`, stream => {
          stream.pipe(dest);
          dest.on('finish', () => dest.close(() => resolve(tmpPath)));
          dest.on('error', reject);
        }).on('error', reject);
      });
    }).on('error', reject);
  });
}

// Transcribe an audio file by POSTing it to the synology-whisper service.
// Returns the transcript string, or throws on failure.
function transcribeVoice(audioPath) {
  return new Promise((resolve, reject) => {
    const boundary = `----WhisperBoundary${Date.now()}`;
    const filename = audioPath.split(/[\\/]/).pop();
    const fileData = readFileSync(audioPath);

    const prefix = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/ogg\r\n\r\n`
    );
    const suffix = Buffer.from(
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson\r\n--${boundary}--\r\n`
    );
    const body = Buffer.concat([prefix, fileData, suffix]);

    const url = new URL(`${WHISPER_URL}/inference`);
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const text = (parsed.text ?? '').trim();
          if (!text) return reject(new Error('Whisper returned empty transcript'));
          resolve(text);
        } catch {
          reject(new Error(`Whisper response parse error: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Claude runner ────────────────────────────────────────────
function runClaude(user, message, { imagePaths = [] } = {}) {
  const existingSession = getSession(user);
  const resumeFlag = existingSession ? `--resume "${existingSession}"` : '';
  const mcpFlag = existsSync(MCP_CONFIG) ? `--mcp-config "${MCP_CONFIG}"` : '';

  // Load installed plugin skill dirs if they exist
  const pluginDirs = PLUGIN_NAMES
    .map(name => join(PLUGIN_BASE, name, PLUGIN_VERSION))
    .filter(p => existsSync(p))
    .map(p => `--plugin-dir "${p}"`)
    .join(' ');

  const imageFlags = imagePaths.map(p => `--image "${p}"`).join(' ');

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
    imageFlags,
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
  const { user, chatId, message, imagePaths = [] } = queue.shift();

  const ts = new Date().toISOString();
  console.log(`[${ts}] ${user} (${chatId}): ${message.slice(0, 80)}${imagePaths.length ? ` [+${imagePaths.length} image(s)]` : ''}`);

  try {
    await sendTyping(chatId);
    const reply = runClaude(user, message, { imagePaths });
    await telegramSend(chatId, reply);
    console.log(`[${new Date().toISOString()}] → ${user}: ${String(reply).slice(0, 80)}`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error for ${user}:`, err.message);
    await telegramSend(chatId, "Brian here — I hit a snag on that one. Try again in a moment.").catch(() => {});
  } finally {
    for (const p of imagePaths) unlinkSync(p);
  }

  busy = false;
  drain();
}

// ── Express app ───────────────────────────────────────────────
const app = express();
app.use(express.json());

// Telegram webhook
app.post('/telegram', async (req, res) => {
  res.sendStatus(200); // Acknowledge immediately

  const msg = req.body?.message;
  if (!msg) return;

  const fromId = String(msg.from.id);
  const chatId = msg.chat.id;

  // Resolve message text + any attachments
  let text = msg.text?.trim() ?? '';
  let imagePaths = [];

  if (msg.photo) {
    // photo is an array of sizes — take the largest (last element)
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    try {
      const p = await downloadTelegramFile(fileId, 'jpg');
      imagePaths.push(p);
      if (!text) text = 'What do you see in this image?';
    } catch (e) {
      console.error('[photo] Download failed:', e.message);
    }
  } else if (msg.document) {
    const mime = msg.document.mime_type ?? '';
    const isImage = mime.startsWith('image/');
    const ext = mime.split('/')[1] ?? 'bin';
    if (isImage) {
      try {
        const p = await downloadTelegramFile(msg.document.file_id, ext);
        imagePaths.push(p);
        if (!text) text = 'What do you see in this image?';
      } catch (e) {
        console.error('[document/image] Download failed:', e.message);
      }
    } else if (mime === 'application/pdf') {
      telegramSend(chatId, "PDF received — PDF text extraction isn't supported yet. Send me a photo of the page instead.").catch(() => {});
      return;
    } else {
      telegramSend(chatId, `File type "${mime}" isn't supported yet. Try sending a photo or image file.`).catch(() => {});
      return;
    }
  } else if (msg.voice || msg.audio) {
    const voiceMsg = msg.voice ?? msg.audio;
    try {
      const audioPath = await downloadTelegramFile(voiceMsg.file_id, 'ogg');
      try {
        text = await transcribeVoice(audioPath);
        console.log(`[voice] Transcribed: ${text.slice(0, 80)}`);
      } finally {
        unlinkSync(audioPath);
      }
    } catch (e) {
      console.error('[voice] Transcription failed:', e.message);
      telegramSend(chatId, "I couldn't transcribe that voice message — try typing instead.").catch(() => {});
      return;
    }
  }

  if (!text && imagePaths.length === 0) return;

  const user = idToName[fromId];
  if (!user) {
    console.log(`[AUTH] Unknown Telegram ID ${fromId} — blocked`);
    return;
  }

  if (!rateLimiter.isAllowed(user)) {
    console.log(`[RATE] ${user} rate limited (>${RATE_MAX_MESSAGES} msgs/${RATE_WINDOW_MS / 1_000}s)`);
    telegramSend(chatId, "Easy there — too many messages at once. Wait a moment and try again.").catch(() => {});
    return;
  }

  if (text === '/reset') {
    clearSession(user);
    telegramSend(chatId, "Session cleared — starting fresh.").catch(() => {});
    return;
  }

  if (text === '/help' || text.startsWith('/help ')) {
    const SKILL_HELP = {
      prescriptions: {
        emoji: '💊',
        label: 'Prescriptions & supplements',
        triggers: ['prescriptions', 'meds', 'supplements', 'vitamins', 'medication'],
        examples: [
          '"what supplements am I on?"',
          '"add vitamin D 2000 IU to my list"',
          '"remove magnesium from my prescriptions"',
          '"when do I refill my metformin?"',
          '"show me my full medication list"',
        ],
      },
      grocery: {
        emoji: '🛒',
        label: 'Grocery list',
        triggers: ['grocery', 'groceries', 'shopping list', 'add to list', 'shopping'],
        examples: [
          '"add eggs to the grocery list"',
          '"what\'s on the grocery list?"',
          '"remove milk from the list"',
          '"clear the grocery list"',
          '"add bread, butter, and cheese"',
        ],
      },
      recipes: {
        emoji: '🍞',
        label: 'Recipes',
        triggers: ['recipe', 'recipes', 'how do I make', 'how to make', 'cook', 'bake'],
        examples: [
          '"find a recipe for banana bread"',
          '"save this recipe: [paste ingredients & steps]"',
          '"what recipes do we have with chicken?"',
          '"show me the sourdough recipe"',
          '"delete the old pancake recipe"',
        ],
      },
      solar: {
        emoji: '☀️',
        label: 'Solar (Enphase)',
        triggers: ['solar', 'enphase', 'panels', 'energy', 'production', 'grid'],
        examples: [
          '"how much solar did we produce today?"',
          '"what\'s our current solar output?"',
          '"how much have we exported to the grid this week?"',
          '"switch to self-consumption mode"',
          '"what\'s our battery level?"',
        ],
      },
      ev: {
        emoji: '🚗',
        label: 'EV charger (JuiceBox)',
        triggers: ['ev', 'charger', 'juicebox', 'charging', 'car', 'electric'],
        examples: [
          '"is the car charging?"',
          '"stop charging"',
          '"start charging at 24 amps"',
          '"set the charge limit to 80%"',
          '"how long until the car is full?"',
        ],
      },
      coordinator: {
        emoji: '⚡',
        label: 'Smart coordinator',
        triggers: ['coordinator', 'optimize', 'schedule', 'smart charge', 'automate'],
        examples: [
          '"optimize the charging schedule"',
          '"charge now using solar"',
          '"what\'s the recommended charge time tonight?"',
          '"run the energy optimization"',
        ],
      },
      email: {
        emoji: '📧',
        label: 'Email',
        triggers: ['email', 'mail', 'send email', 'read email', 'inbox'],
        examples: [
          '"read my latest emails"',
          '"send an email to mom saying dinner is at 6"',
          '"do I have any unread emails?"',
          '"search my email for the Amazon order"',
        ],
      },
      health: {
        emoji: '🏃',
        label: 'Health & fitness (Withings + Whoop)',
        triggers: ['health', 'withings', 'whoop', 'weight', 'sleep', 'heart rate', 'recovery', 'fitness'],
        examples: [
          '"what was my weight today?"',
          '"how did I sleep last night?"',
          '"what\'s my recovery score?"',
          '"show my heart rate trend this week"',
          '"log my blood pressure: 120/80"',
        ],
      },
      shopping: {
        emoji: '🏪',
        label: 'Store shopping (Kroger / Walmart / Safeway)',
        triggers: ['kroger', 'walmart', 'safeway', 'store', 'order groceries', 'pickup'],
        examples: [
          '"find almond milk at Kroger"',
          '"what\'s the price of chicken breast at Safeway?"',
          '"add oat milk to my Walmart cart"',
          '"search Kroger for gluten-free pasta"',
        ],
      },
      budget: {
        emoji: '💰',
        label: 'Budget & finances (Monarch)',
        triggers: ['budget', 'monarch', 'finances', 'spending', 'transactions', 'money'],
        examples: [
          '"how much did we spend on groceries this month?"',
          '"what\'s our current budget status?"',
          '"show me recent transactions"',
          '"how are we tracking against the food budget?"',
        ],
      },
    };

    const aliases = {
      meds: 'prescriptions', supplements: 'prescriptions', vitamins: 'prescriptions', medications: 'prescriptions',
      groceries: 'grocery', 'shopping list': 'grocery',
      recipe: 'recipes', cooking: 'recipes', baking: 'recipes',
      enphase: 'solar', energy: 'solar', panels: 'solar',
      charger: 'ev', juicebox: 'ev', charging: 'ev', car: 'ev',
      optimize: 'coordinator', schedule: 'coordinator',
      mail: 'email',
      withings: 'health', whoop: 'health', weight: 'health', sleep: 'health', fitness: 'health',
      kroger: 'shopping', walmart: 'shopping', safeway: 'shopping', store: 'shopping',
      monarch: 'budget', finances: 'budget', spending: 'budget',
    };

    const arg = text.slice('/help'.length).trim().toLowerCase();
    const key = aliases[arg] || arg;
    const skill = SKILL_HELP[key];

    if (skill) {
      const detail = [
        `${skill.emoji} *${skill.label}*`,
        '',
        '*Trigger words:* ' + skill.triggers.join(', '),
        '',
        '*Example phrases:*',
        ...skill.examples.map(e => `• ${e}`),
      ].join('\n');
      telegramSend(chatId, detail).catch(() => {});
    } else {
      const overview = [
        '*Brian can help with:*',
        '',
        ...Object.values(SKILL_HELP).map(s => `${s.emoji} *${s.label}*`),
        '',
        'Type `/help <skill>` for details and examples.',
        'Skills: ' + Object.keys(SKILL_HELP).join(', '),
        '',
        '/reset — start a fresh conversation',
        '/help — this message',
      ].join('\n');
      telegramSend(chatId, overview).catch(() => {});
    }
    return;
  }

  enqueue({ user, chatId, message: text, imagePaths });
});

// ── Proactive push endpoint ───────────────────────────────────
// Internal services POST here to message a family member by name.
// Body: { "user": "moriah", "message": "EV charge complete." }
// Protect with PUSH_SECRET env var if exposed beyond localhost.
app.post('/push', express.json(), (req, res) => {
  const secret = process.env.PUSH_SECRET;
  if (secret && req.headers['x-push-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { user, message } = req.body ?? {};
  if (!user || !message) return res.status(400).json({ error: 'user and message are required' });

  const telegramId = familyMap[user];
  if (!telegramId) return res.status(404).json({ error: `Unknown user: ${user}` });

  telegramSend(Number(telegramId), String(message))
    .then(() => res.json({ ok: true }))
    .catch(e => res.status(500).json({ error: e.message }));
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
