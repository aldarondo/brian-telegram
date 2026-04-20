FROM node:20-slim

# git is required for 'claude plugin marketplace add' (clones the marketplace repo)
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user for Claude CLI (--dangerously-skip-permissions is blocked for root)
# Pre-create .claude.json so Claude CLI doesn't abort on first run (it checks for this file)
RUN useradd -m -u 1001 brian && \
    mkdir -p /app/data/sessions /home/brian/.claude && \
    echo '{"firstStartTime":"2026-01-01T00:00:00.000Z","opusProMigrationComplete":true,"migrationVersion":11}' > /home/brian/.claude.json && \
    chown -R brian:brian /app /home/brian

WORKDIR /app

# Install app dependencies
COPY package.json .
RUN npm install --omit=dev && chown -R brian:brian /app

# Copy source
COPY src/ src/
COPY config/mcp.json config/mcp.json
RUN chown -R brian:brian /app

# Sessions volume — persist across container restarts
VOLUME ["/app/data/sessions"]

# family.json is mounted at runtime (not baked in — contains Telegram IDs)
# docker run -v /path/to/family.json:/app/config/family.json ...

EXPOSE 3100

# Entrypoint bootstraps marketplace + plugins before starting the bot
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && chown brian:brian /entrypoint.sh

USER brian

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:3100/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["/entrypoint.sh"]
