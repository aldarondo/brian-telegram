# brian-telegram Roadmap
> Tag key: `[Code]` = Claude Code · `[Cowork]` = Claude Cowork · `[Human]` = Charles must act

## 🔄 In Progress
- [ ] `[Code]` Initial scaffold

## 🔲 Backlog

### Deployment
- [x] `[Human]` 2026-04-18 — Telegram bot token saved to .env (from C:\Brian\secrets\telegram.key)
- [x] `[Human]` 2026-04-18 — Charles's Telegram ID wired into config/family.json
- [ ] `[Human]` Collect Telegram user IDs for Moriah, Jack, Quincy (message @userinfobot), add to config/family.json
- [ ] `[Code]` Build Docker image, verify `claude` CLI runs inside container
- [ ] `[Human]` Register webhook: `curl https://api.telegram.org/bot{TOKEN}/setWebhook?url=https://brian.aldarondo.family/telegram`
- [ ] `[Code]` Add to brian-mcp docker-compose.yml (same brian-net network) or deploy standalone
- [ ] `[Human]` Smoke test: send "what supplements am I on?" from Charles's Telegram, verify prescriptions skill responds

### Polish
- [ ] `[Code]` Add `/reset` command to clear session and start fresh
- [ ] `[Code]` Add typing indicator (sendChatAction "typing") while Claude is processing
- [ ] `[Code]` Handle multi-part replies (split responses over 4096 chars into multiple messages instead of truncating)
- [ ] `[Code]` Write integration test for webhook handler

### Future
- [ ] `[Code]` Rate limiting per user (prevent accidental spam loops)
- [ ] `[Code]` `/help` command listing what Brian can do

## ✅ Completed
- [x] `[Code]` 2026-04-18 — Initial scaffold: src/index.js, Dockerfile, docker-compose.yml, CLAUDE.md, ROADMAP.md
- [x] `[Human]` 2026-04-18 — Bot token and Charles Telegram ID configured locally (gitignored)

## 🚫 Blocked
<!-- log blockers here -->
