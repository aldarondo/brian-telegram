# brian-telegram Roadmap
> Tag key: `[Code]` = Claude Code · `[Cowork]` = Claude Cowork · `[Human]` = Charles must act

## 🚧 Human Action Required
- `[Human]` Install jellyfin plugin on NAS: SSH in and run:
  ```
  claude plugin marketplace update brian-family
  claude plugin install jellyfin@brian-family
  ```
  Then redeploy the bot: `docker compose pull && docker compose up -d`

## 🔄 In Progress
<!-- nothing active — bot is live and working -->

## 🔲 Backlog

### Deployment (do in order)
- [x] `[Code]` 2026-04-19 — Filled `BRIAN_MCP_CLIENT_ID` + `BRIAN_MCP_CLIENT_SECRET` in `.env` (from brian-mcp/.env.test)
- [ ] `[Human]` Collect Telegram user IDs for Moriah, Jack, Quincy — have each person message @userinfobot on Telegram, add to `config/family.json`
- [x] `[Code]` 2026-04-19 — CF tunnel path rule live (/telegram → brian-telegram:3100), CF Access bypass policy for /telegram, webhook registered
- [x] `[Code]` 2026-04-19 — docker-compose updated for NAS deployment (paths: /volume1/docker/brian-telegram/...)
- [x] `[Code]` 2026-04-19 — Installed brian-family marketplace + prescriptions/grocery-list/recipes plugins into ~/.claude; fixed plugin.json mcpServers schema
- [x] `[Code]` 2026-04-19 — Deployed to NAS: image pulled from GHCR, .env/family.json/claude-creds written, container running on brian-mcp_default network
- [x] `[Code]` 2026-04-19 — Smoke test passed: supplements query works end-to-end (NAS bot → Claude CLI → MCP memory → Telegram reply)

### Polish (after smoke test passes)
- [x] `[Code]` 2026-04-19 — Typing indicator: `sendChatAction "typing"` fires before each Claude run
- [x] `[Code]` 2026-04-19 — `/reset` command clears session file and replies "starting fresh"
- [x] `[Code]` 2026-04-19 — Long replies split on newline boundaries into ≤4096-char chunks (src/utils.js)
- [x] `[Code]` 2026-04-19 — Integration test: webhook 200 ack + enqueue verified (9/9 passing)

### Future
- [x] `[Code]` 2026-04-19 — Rate limiting per user (prevent accidental loops)
- [x] `[Code]` 2026-04-19 — `/help` command listing available skills and example prompts
- [x] `[Code]` 2026-04-19 — Image support: detect photo messages, download from Telegram, pass to Claude via `--image`
- [x] `[Code]` 2026-04-19 — Voice messages: download OGG, transcribe via synology-whisper, route transcript to Claude
- [x] `[Code]` 2026-04-19 — Documents/PDFs: image docs pass via `--image`; PDF/unsupported types get clear "not supported" reply
- [x] `[Code]` 2026-04-19 — Proactive push notifications: POST /push endpoint so NAS services can message family members by name
- [x] `[Code]` 2026-04-20 — Jellyfin plugin wired: per-user plugin loading (charles only), jellyfin MCP added to config/mcp.json, SKILL_HELP updated with movies/TV skill
- [ ] `[Human]` — Reply keyboards: inline buttons for common follow-up actions (confirm, cancel, add more) — reassigned from [Code]: requires UX design decisions about when/which buttons to show; needs Charles to define the trigger protocol before implementation
- [ ] `[Human]` — Calendar: add events to Team Aldarondo shared Google Calendar via Google Calendar MCP — reassigned from [Code]: requires Google Calendar MCP credentials to be configured on the NAS

## ✅ Completed
- [x] 2026-04-19 — Completed: Rate limiting per user — sliding-window RateLimiter in src/utils.js (5 msgs/60s, configurable via RATE_MAX_MESSAGES/RATE_WINDOW_SECONDS env vars); wired into webhook handler; 4 new tests pass
- [x] `[Code]` 2026-04-19 — Added enphase, juicebox, coordinator MCP servers to config/mcp.json (SSE at 172.18.0.1, reachable via Docker bridge gateway)
- [x] `[Code]` 2026-04-19 — Bot fully working: non-root user, `--dangerously-skip-permissions`, `--plugin-dir` for brian-family skills, `--` separator fix, `type:http` MCP schema, supplements seeded in correct `prescriptions.item` format
- [x] `[Code]` 2026-04-19 — Long-lived OAuth token (1-year, via `claude setup-token`) written to NAS credentials file with `expiresAt: 9999999999999` — session-start hook NAS-refresh section removed (no longer needed)
- [x] `[Code]` 2026-04-19 — GHCR build workflow: `.github/workflows/build-brian-telegram.yml` — builds on push + weekly Sunday 04:00 UTC
- [x] `[Code]` 2026-04-19 — docker-compose updated to pull `ghcr.io/aldarondo/brian-telegram:latest` instead of local build
- [x] `[Code]` 2026-04-18 — Scaffold: src/index.js, Dockerfile, docker-compose.yml, CLAUDE.md, tests
- [x] `[Code]` 2026-04-18 — Switched from API key to mounted ~/.claude credentials (subscription auth)
- [x] `[Code]` 2026-04-18 — Credentials mount path set to `C:/Users/Aldarondo Family/.claude`
- [x] `[Human]` 2026-04-18 — Bot token saved to .env (from C:\Brian\secrets\telegram.key)
- [x] `[Human]` 2026-04-18 — Charles's Telegram ID (7689023388) wired into config/family.json

## 🚫 Blocked
<!-- log blockers here -->
