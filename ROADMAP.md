# brian-telegram Roadmap
> Tag key: `[Code]` = Claude Code · `[Cowork]` = Claude Cowork · `[Human]` = Charles must act

## 🚧 Human Action Required

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
- [ ] `[Human]` — Smoke test food-log plugin: send a food screenshot via Telegram, verify memory entry stored under `food.entry,user:charles` — install already done (plugin at v1.0.0 in /home/brian/.claude/plugins/cache/brian-family/food-log/1.0.0)

### Platform adapters & backend routing
- [ ] `[Code]` — **claude-code-router sidecar**: add [musistudio/claude-code-router](https://github.com/musistudio/claude-code-router) (or [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)) as a Docker compose sidecar so the `claude` CLI can route to alternate providers (OpenRouter / Gemini / Ollama / DeepSeek) without code changes. Keep mounted subscription OAuth credentials as the default; point `ANTHROPIC_BASE_URL` at the sidecar. Test: swap backend for one user via env var, verify Telegram round-trip still works and MCP tools still load.
- [ ] `[Code]` — **Refactor for multi-platform**: extract `runClaude()` + session store + queue + family-name resolver into a platform-agnostic core module. Existing `/telegram` webhook becomes `src/adapters/telegram.js` calling the core. Prereq for WhatsApp/Slack adapters below.
- [ ] `[Code]` — **WhatsApp adapter**: `src/adapters/whatsapp.js` using [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api) webhook on `/whatsapp`. Map WA phone numbers → `config/family.json` names. Reuse queue/session/rate-limit/voice. Cost: 1,000 free service conversations/mo, then per-conversation pricing. Requires Meta Business verification.
- [ ] `[Code]` — **Slack adapter**: `src/adapters/slack.js` using [Slack Events API](https://api.slack.com/apis/events-api) on `/slack`. Register a Slack app with `im:history` + `chat:write` + `files:read` scopes. Map Slack user IDs → family.json names. Free for personal workspace.
- [ ] `[Code]` — **Google Chat adapter**: `src/adapters/google-chat.js` using [Google Chat API](https://developers.google.com/workspace/chat) HTTP-endpoint app on `/google-chat`. Verify Google-signed JWT on inbound events, map Google user IDs → family.json names, reply via the synchronous response body (no extra API call needed for 1:1 DMs). Free on Workspace; requires a GCP project + Chat API enabled.

### Family features
- [x] `[Code]` 2026-04-27 — **Recurring tasks / scheduler**: `src/scheduler.js` reads `config/schedules.json` (gitignored) and registers `node-cron` tasks that inject synthetic messages into the existing queue, reusing session/rate-limit/reply paths. Per-schedule timezone with `TZ` env fallback, malformed/unknown-user entries dropped at boot, `SCHEDULER_DISABLED=1` to bypass. 24 new unit tests (61 total passing). Wired into `src/index.js`, `config/schedules.example.json` + README section + .gitignore added.
- [ ] `[Code]` — **Group chat awareness**: detect Telegram group/supergroup chats (`chat.type !== 'private'`), respond only when the bot is @-mentioned or the message is a reply to a bot message, and attribute each message by speaker in `history` + memory writes (`speaker: <familyName>`). Lets the bot join the family group chat without spamming.
- [ ] `[Code]` — **Private vs family-visible memory**: add a `visibility: private|family` flag on memory entries written through the brian-memory MCP. Inject the requester's family name into every `runClaude()` call (via system prompt or per-tool header) so the memory server can filter reads. Default: private. Opt-in sharing via explicit phrasing ("share with the family", "make this public to everyone"). Requires coordinated change in brian-memory MCP — track that as a sub-task.
- [ ] `[Code]` — **Health check + proactive alerts to Charles**: extend `/health` to probe each MCP server (HEAD/GET on the SSE URL or a lightweight ping tool) and include queue depth + last-message-per-user timestamps. Add a monitor loop (every 60s) that notifies Charles via the existing `/push` pipeline when: (a) any MCP server has been unreachable for >5 min, (b) webhook queue depth exceeds N, or (c) the bot hasn't successfully completed a Claude run in >15 min during waking hours. Suppress duplicate alerts with a 30-min cooldown per incident key.

## ✅ Completed
- [x] `[Code]` 2026-04-27 — Recurring tasks scheduler shipped: `src/scheduler.js` + node-cron + `config/schedules.example.json` + README "Recurring schedules" section. Per-schedule timezone with `TZ` env fallback. 24 new unit tests covering validation, file loading, cron registration, timezone passthrough, and tick-time job-shape. All 61 tests pass.
- [x] `[Code]` 2026-04-27 — Removed stale merge conflict markers from ROADMAP.md (committed at 13f1330)
- [x] `[Code]` 2026-04-25 — Automated marketplace refresh: Dockerfile git HTTPS rewrite, entrypoint.sh full plugin list (all 14 brian-family plugins), bot.js PLUGIN_VERSIONS/PLUGIN_ACCESS/SKILL_HELP wired for all new plugins, GHA workflow in brian-family-marketplace triggers git pull + reinstall on push to main
- [x] `[Human]` 2026-04-25 — Jellyfin plugin already installed on NAS (jellyfin@brian-family v1.0.1, installed 2026-04-20)
- [x] `[Code]` 2026-04-23 — food-log plugin installed on NAS: cloned marketplace via HTTPS to /volume1/docker/brian-telegram/claude-creds/plugins/marketplaces/brian-family, installed food-log@brian-family v1.0.0 via docker exec
- [x] `[Code]` 2026-04-22 — food-log plugin wired: PLUGIN_VERSIONS + PLUGIN_ACCESS + /help food-log entry with aliases (food, calories, macros, nutrition)
- [x] `[Code]` 2026-04-22 — QA audit + full fix pass: shell injection patched (execSync→spawnSync args array), PUSH_SECRET now required on /push (was silently open), image/voice temp-file cleanup crashes fixed, bare catch blocks log errors, log rotation file-op errors handled, /push rate-limited, optional Telegram webhook signature verification (WEBHOOK_SECRET), duplicate workflow deleted, buildContextPreamble moved to utils.js, tests 13→20 passing, .env.example and README updated
- [x] 2026-04-19 — Completed: Rate limiting per user — sliding-window RateLimiter in src/utils.js (5 msgs/60s, configurable via RATE_MAX_MESSAGES/RATE_WINDOW_SECONDS env vars); wired into webhook handler; 4 new tests pass
- [x] `[Code]` 2026-04-19 — Added enphase, juicebox, coordinator MCP servers to config/mcp.json (SSE at 172.18.0.1, reachable via Docker bridge gateway)
- [x] `[Code]` 2026-04-19 — Bot fully working: non-root user, `--dangerously-skip-permissions`, `--plugin-dir` for brian-family skills, `--` separator fix, `type:http` MCP schema, supplements seeded in correct `prescriptions.item` format
- [x] `[Code]` 2026-04-19 — Long-lived OAuth token (1-year, via `claude setup-token`) written to NAS credentials file with `expiresAt: 9999999999999` — session-start hook NAS-refresh section removed (no longer needed)
- [x] `[Code]` 2026-04-19 — GHCR build workflow: `.github/workflows/build.yml` — builds on push + weekly Sunday 06:00 UTC + NAS deploy via cloudflared SSH (consolidated from two workflow files 2026-04-22)
- [x] `[Code]` 2026-04-19 — docker-compose updated to pull `ghcr.io/aldarondo/brian-telegram:latest` instead of local build
- [x] `[Code]` 2026-04-18 — Scaffold: src/index.js, Dockerfile, docker-compose.yml, CLAUDE.md, tests
- [x] `[Code]` 2026-04-18 — Switched from API key to mounted ~/.claude credentials (subscription auth)
- [x] `[Code]` 2026-04-18 — Credentials mount path set to `C:/Users/Aldarondo Family/.claude`
- [x] `[Human]` 2026-04-18 — Bot token saved to .env (from C:\Brian\secrets\telegram.key)
- [x] `[Human]` 2026-04-18 — Charles's Telegram ID (7689023388) wired into config/family.json

## 🚫 Blocked
<!-- log blockers here -->
