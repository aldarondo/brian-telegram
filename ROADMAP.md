# brian-telegram Roadmap
> Tag key: `[Code]` = Claude Code · `[Cowork]` = Claude Cowork · `[Human]` = Charles must act

## 🔄 In Progress
<!-- nothing active -->

## 🔲 Backlog

### Deployment (do in order)
- [x] `[Code]` 2026-04-19 — Filled `BRIAN_MCP_CLIENT_ID` + `BRIAN_MCP_CLIENT_SECRET` in `.env` (from brian-mcp/.env.test)
- [ ] `[Human]` Collect Telegram user IDs for Moriah, Jack, Quincy — have each person message @userinfobot on Telegram, add to `config/family.json`
- [x] `[Code]` 2026-04-19 — CF tunnel path rule live (/telegram → brian-telegram:3100), CF Access bypass policy for /telegram, webhook registered
- [x] `[Code]` 2026-04-19 — docker-compose updated for NAS deployment (paths: /volume1/docker/brian-telegram/...)
- [x] `[Code]` 2026-04-19 — Installed brian-family marketplace + prescriptions/grocery-list/recipes plugins into ~/.claude; fixed plugin.json mcpServers schema
- [ ] `[Human]` NAS deploy — on the Synology, run:
  ```
  # 1. Create dirs and copy credentials
  mkdir -p /volume1/docker/brian-telegram/{sessions,config,claude-creds}
  rsync -a ~/.claude/ /volume1/docker/brian-telegram/claude-creds/
  cp /path/to/.env /volume1/docker/brian-telegram/.env
  cp /path/to/config/family.json /volume1/docker/brian-telegram/config/family.json

  # 2. Pull and start (from repo clone or copy of docker-compose.yml)
  docker compose pull && docker compose up -d
  ```
- [ ] `[Human]` Smoke test: send "what supplements am I on?" from Charles's Telegram → verify prescriptions skill responds

### Polish (after smoke test passes)
- [x] `[Code]` 2026-04-19 — Typing indicator: `sendChatAction "typing"` fires before each Claude run
- [x] `[Code]` 2026-04-19 — `/reset` command clears session file and replies "starting fresh"
- [x] `[Code]` 2026-04-19 — Long replies split on newline boundaries into ≤4096-char chunks (src/utils.js)
- [x] `[Code]` 2026-04-19 — Integration test: webhook 200 ack + enqueue verified (9/9 passing)

### Future
- [ ] `[Code]` Rate limiting per user (prevent accidental loops)
- [ ] `[Code]` `/help` command listing available skills

## ✅ Completed
- [x] `[Code]` 2026-04-19 — GHCR build workflow: `.github/workflows/build-brian-telegram.yml` — builds on push + weekly Sunday 04:00 UTC
- [x] `[Code]` 2026-04-19 — docker-compose updated to pull `ghcr.io/aldarondo/brian-telegram:latest` instead of local build
- [x] `[Code]` 2026-04-18 — Scaffold: src/index.js, Dockerfile, docker-compose.yml, CLAUDE.md, tests
- [x] `[Code]` 2026-04-18 — Switched from API key to mounted ~/.claude credentials (subscription auth)
- [x] `[Code]` 2026-04-18 — Credentials mount path set to `C:/Users/Aldarondo Family/.claude`
- [x] `[Human]` 2026-04-18 — Bot token saved to .env (from C:\Brian\secrets\telegram.key)
- [x] `[Human]` 2026-04-18 — Charles's Telegram ID (7689023388) wired into config/family.json

## 🚫 Blocked
<!-- log blockers here -->
