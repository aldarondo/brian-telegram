# brian-telegram

Telegram bot that gives family members mobile access to Brian's Claude skills (grocery list, recipes, prescriptions). Thin wrapper: Telegram message → Claude Code CLI with `--resume` → Telegram reply.

**Why this exists:** The Claude mobile app has no MCP support. This bot runs on Brian's server and proxies requests through a full Claude Code session with brian-memory connected.

## How it works

1. Family member sends a message on Telegram
2. Bot maps their Telegram user ID to their name (charles, moriah, jack, quincy)
3. Bot runs `claude --print --resume [session-id] --mcp-config config/mcp.json "[message]"`
4. Claude has access to all brian-family-marketplace skills via the MCP connection
5. Session ID is saved — next message resumes the same conversation (24h TTL)
6. Reply sent back via Telegram

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
# fill in TELEGRAM_BOT_TOKEN, ANTHROPIC_API_KEY, BRIAN_MCP_CLIENT_ID, BRIAN_MCP_CLIENT_SECRET
```

### 4. Deploy

```bash
docker compose up -d
```

### 5. Register the webhook

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=https://brian.aldarondo.family/telegram"
```

## Dependencies

- Node.js 20+
- Express (only npm dependency)
- Claude Code CLI (`@anthropic-ai/claude-code`) — installed in Docker image
- Telegram Bot API — called via built-in `https` module (no SDK)

## Project Status

Scaffolded. See [ROADMAP.md](ROADMAP.md) for deployment steps.

---
**Publisher:** Xity Software, LLC
