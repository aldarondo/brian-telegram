FROM node:20-slim

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# Install app dependencies
COPY package.json .
RUN npm install --omit=dev

# Copy source
COPY src/ src/
COPY config/mcp.json config/mcp.json

# Sessions volume — persist across container restarts
VOLUME ["/app/data/sessions"]

# family.json is mounted at runtime (not baked in — contains Telegram IDs)
# docker run -v /path/to/family.json:/app/config/family.json ...

EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:3100/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
