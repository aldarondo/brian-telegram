# brian-telegram Roadmap
> Tag key: `[Code]` = Claude Code · `[Cowork]` = Claude Cowork · `[Human]` = Charles must act

## 🔄 In Progress
<!-- nothing active -->

## 🔲 Backlog

### Deployment (do in order)
- [ ] `[Human]` Fill `BRIAN_MCP_CLIENT_ID` + `BRIAN_MCP_CLIENT_SECRET` in `.env` (Cloudflare Access service token — same values as brian-family-marketplace plugins)
- [ ] `[Human]` Collect Telegram user IDs for Moriah, Jack, Quincy — have each person message @userinfobot on Telegram, add to `config/family.json`
- [ ] `[Code]` Run `docker compose up -d` — builds image (installs claude CLI inside), starts container
- [ ] `[Human]` Register webhook with Telegram (run once):
  ```
  curl "https://api.telegram.org/botTELEGRAM_BOT_TOKEN_REDACTED/setWebhook?url=https://brian.aldarondo.family/telegram"
  ```
- [ ] `[Human]` Smoke test: send "what supplements am I on?" from Charles's Telegram → verify prescriptions skill responds with the full stack

### Polish (after smoke test passes)
- [ ] `[Code]` Add typing indicator — send `sendChatAction "typing"` while Claude is processing so it doesn't feel frozen
- [ ] `[Code]` Add `/reset` command to clear session and start fresh conversation
- [ ] `[Code]` Split replies over 4096 chars into multiple messages instead of truncating
- [ ] `[Code]` Write integration test for webhook handler

### Future
- [ ] `[Code]` Rate limiting per user (prevent accidental loops)
- [ ] `[Code]` `/help` command listing available skills

## ✅ Completed
- [x] `[Code]` 2026-04-18 — Scaffold: src/index.js, Dockerfile, docker-compose.yml, CLAUDE.md, tests
- [x] `[Code]` 2026-04-18 — Switched from API key to mounted ~/.claude credentials (subscription auth)
- [x] `[Code]` 2026-04-18 — Credentials mount path set to `C:/Users/Aldarondo Family/.claude`
- [x] `[Human]` 2026-04-18 — Bot token saved to .env (from C:\Brian\secrets\telegram.key)
- [x] `[Human]` 2026-04-18 — Charles's Telegram ID (7689023388) wired into config/family.json

## 🚫 Blocked
<!-- log blockers here -->
