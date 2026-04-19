const TG_MAX = 4096;

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
