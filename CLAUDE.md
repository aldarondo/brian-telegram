# brian-telegram

## Project Purpose
Telegram bot front-end for the Brian family skill system. Receives Telegram messages from family members, routes them through a Claude Code CLI session (with brian-memory MCP), and replies via Telegram. Solves mobile access — Claude mobile has no MCP support.

## Architecture
```
Telegram message → webhook (Express) → identify user → runClaude() →
  claude --output-format json --print --resume [session-id] --mcp-config config/mcp.json
  → parse result + save new session_id → telegramSend() → reply
```

## Key Commands
```bash
npm start                    # run locally
docker compose up -d         # run in Docker
docker compose logs -f       # tail logs
curl localhost:3100/health   # health check

# Register webhook with Telegram (run once per deployment URL change)
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=https://YOUR_DOMAIN/telegram"
```

## Config
- `config/family.json` — Telegram user ID → name map (gitignored, mount into container)
- `config/mcp.json` — MCP server config (brian.aldarondo.family/mcp + CF Access headers)
- `.env` — secrets (gitignored, see .env.example)

## Getting Telegram User IDs
Have each family member message @userinfobot on Telegram — it replies with their numeric ID.

## Testing Requirements (mandatory)
- Unit tests for identity mapping, truncation, session TTL logic
- Integration test: POST a fake Telegram update to /telegram, verify queue behavior
- Run: `npm test`

@~/Documents/GitHub/CLAUDE.md
