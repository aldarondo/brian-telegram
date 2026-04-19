# brian-telegram

Telegram bot that gives family members mobile access to Brian's Claude skills (grocery list, recipes, prescriptions, solar, EV, health, budget, and more). Thin wrapper: Telegram message → Claude Code CLI with `--resume` → Telegram reply.

**Why this exists:** The Claude mobile app has no MCP support. This bot runs on the Synology NAS and proxies requests through a full Claude Code session with all brian MCP servers connected.

## How it works

1. Family member sends a message, photo, or image file on Telegram
2. Bot maps their Telegram user ID to their name (charles, moriah, jack, quincy)
3. Bot runs `claude --print --resume [session-id] --mcp-config config/mcp.json --plugin-dir [...] --image [path] -- "[message]"`
4. Claude has access to all brian-family-marketplace skills (prescriptions, grocery-list, recipes) plus MCP servers (solar, EV, coordinator, email, health, shopping, budget)
5. Session ID is saved — next message resumes the same conversation (24h TTL)
6. Reply sent back via Telegram with Markdown formatting (falls back to plain text if parsing fails)

## Setup

### 1. Create the bot

Message @BotFather on Telegram:
```
/newbot
```
Save the token to `.env` as `TELEGRAM_BOT_TOKEN`.

### 2. Get family Telegram IDs

Each person messages @userinfobot on Telegram. Copy `config/family.example.json` to `config/family.json` and fill in the IDs.

### 3. Configure secrets

```bash
cp .env.example .env
# fill in: TELEGRAM_BOT_TOKEN, BRIAN_MCP_CLIENT_ID, BRIAN_MCP_CLIENT_SECRET
# No API key needed — uses Claude subscription auth via mounted ~/.claude credentials
```

### 4. Generate a long-lived OAuth token (headless containers)

The container has no Claude Desktop to refresh tokens automatically. Generate a 1-year token:

```bash
claude setup-token
```

Write it to the NAS credentials file:
```python
import json
f = '/volume1/docker/brian-telegram/claude-creds/.credentials.json'
d = json.load(open(f))
d['claudeAiOauth']['accessToken'] = 'sk-ant-oat01-...'
d['claudeAiOauth']['expiresAt'] = 9999999999999
json.dump(d, open(f, 'w'), indent=2)
```

### 5. Deploy

```bash
docker compose up -d
```

### 6. Register the webhook

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=https://brian.aldarondo.family/telegram"
```

## Commands

| Command | Description |
|---------|-------------|
| `/reset` | Clear session — starts a fresh Claude conversation |
| `/help` | List all available skills with emoji overview |
| `/help <skill>` | Detailed trigger words and example phrases for a skill (e.g. `/help recipes`, `/help solar`, `/help budget`) |

## Sending media

| Type | Behavior |
|------|----------|
| Photo | Downloaded and passed to Claude as an image (`--image`). Add a caption to ask a specific question; without one, Claude describes what it sees. |
| Image file (PNG, GIF, WebP, etc.) | Same as photo |
| PDF | Not yet supported — sends a "not supported" reply |
| Voice message | Transcribed via synology-whisper, then routed to Claude as text |

## Proactive push notifications

Other NAS services can message any family member without a user-initiated conversation.

**Endpoint:** `POST /push`

**Headers:**
```
Content-Type: application/json
X-Push-Secret: <value of PUSH_SECRET env var>   # required only if PUSH_SECRET is set
```

**Body:**
```json
{ "user": "moriah", "message": "EV charge complete — 87% 🔋" }
```

**Response:**
```json
{ "ok": true }
```

`user` must match a name in `config/family.json`. Returns 404 if the user is unknown, 401 if the secret is wrong, 400 if fields are missing.

**Example from a NAS service:**
```bash
curl -s -X POST http://brian-telegram:3100/push \
  -H "Content-Type: application/json" \
  -H "X-Push-Secret: $PUSH_SECRET" \
  -d '{"user":"charles","message":"Solar battery at 95% — good time to run the dishwasher."}'
```

> On the Docker bridge network the service is reachable at `brian-telegram:3100`. From the NAS host use `localhost:3100` (or the mapped host port).

## Dependencies

- Node.js 20+
- Express (only npm dependency)
- Claude Code CLI (`@anthropic-ai/claude-code`) — installed in Docker image
- Telegram Bot API — called via built-in `https` module (no SDK)

## Project Status

Live on NAS. See [ROADMAP.md](ROADMAP.md) for remaining items.

---
**Publisher:** Xity Software, LLC
