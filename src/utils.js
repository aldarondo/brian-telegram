import { spawn } from 'child_process';

const TG_MAX = 4096;

// Spawn a process and collect stdout, rejecting on non-zero exit or timeout.
// Does NOT block the event loop — the queue stays responsive while Claude runs.
export function spawnAsync(cmd, args, { timeout = 120_000, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { env });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`${cmd} timed out after ${timeout}ms`));
    }, timeout);

    proc.on('error', err => { clearTimeout(timer); reject(err); });
    proc.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        const err = new Error(`${cmd} exited with code ${code}`);
        err.stderr = stderr;
        err.stdout = stdout;
        return reject(err);
      }
      resolve(stdout);
    });
  });
}

// Build a context preamble from expired-session history so Claude can continue naturally.
export function buildContextPreamble(history) {
  if (!history || history.length === 0) return '';
  const lines = history.map(h => `User: ${h.user}\nBrian: ${h.assistant}`).join('\n\n');
  return `[Your previous session expired. Here is recent conversation context so you can continue naturally — do not mention the session or this note to the user:\n\n${lines}\n]\n\n`;
}

// Sliding-window rate limiter — track timestamps of recent messages per user
export class RateLimiter {
  constructor({ maxMessages = 5, windowMs = 60_000 } = {}) {
    this.maxMessages = maxMessages;
    this.windowMs = windowMs;
    this._windows = new Map(); // user → timestamp[]
  }

  // Returns true if the message is allowed; false if rate limit exceeded
  isAllowed(user) {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const timestamps = (this._windows.get(user) ?? []).filter(ts => ts > cutoff);
    if (timestamps.length >= this.maxMessages) {
      this._windows.set(user, timestamps);
      return false;
    }
    timestamps.push(now);
    this._windows.set(user, timestamps);
    return true;
  }
}

// ── Group chat helpers ───────────────────────────────────────
// Returns true if the message arrived in a Telegram group or supergroup chat.
export function isGroupChat(msg) {
  const t = msg?.chat?.type;
  return t === 'group' || t === 'supergroup';
}

// Returns true if the bot is @-mentioned in the message via mention/text_mention entities.
// botUsername is matched case-insensitively, with or without a leading '@'.
export function isBotMentioned(msg, botUsername) {
  if (!botUsername || !msg) return false;
  const wanted = botUsername.toLowerCase().replace(/^@/, '');
  const text = msg.text ?? msg.caption ?? '';
  const entities = msg.entities ?? msg.caption_entities ?? [];
  for (const ent of entities) {
    if (ent.type === 'mention') {
      const slice = text.slice(ent.offset, ent.offset + ent.length).toLowerCase();
      if (slice === `@${wanted}`) return true;
    } else if (ent.type === 'text_mention' && ent.user?.username) {
      if (ent.user.username.toLowerCase() === wanted) return true;
    }
  }
  return false;
}

// Returns true if the message is a reply to a message that came from a bot.
export function isReplyToBot(msg) {
  return msg?.reply_to_message?.from?.is_bot === true;
}

// Remove all `@botUsername` substrings (case-insensitive) and collapse whitespace.
export function stripBotMention(text, botUsername) {
  if (!text || !botUsername) return text;
  const u = botUsername.replace(/^@/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`@${u}\\b`, 'gi'), '').replace(/\s+/g, ' ').trim();
}

// Split text into ≤4096-char chunks on newline boundaries where possible
export function splitMessage(text, limit = TG_MAX) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) cut = limit; // no good newline — hard cut
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n/, '');
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}
