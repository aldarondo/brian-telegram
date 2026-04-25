#!/bin/sh
# Bootstrap marketplace and plugins, then start the bot.
# Runs as user 'brian' — ~/.claude is mounted from the NAS host.

set -e

MARKETPLACE_NAME="brian-family"
MARKETPLACE_URL="https://github.com/aldarondo/brian-family-marketplace"

# Register marketplace if not already present
if ! claude plugin marketplace list 2>/dev/null | grep -q "$MARKETPLACE_NAME"; then
  echo "[entrypoint] Registering marketplace: $MARKETPLACE_NAME"
  claude plugin marketplace add "$MARKETPLACE_URL" || echo "[entrypoint] Warning: marketplace add failed (will retry on next start)"
else
  echo "[entrypoint] Marketplace $MARKETPLACE_NAME already registered — updating"
  claude plugin marketplace update "$MARKETPLACE_NAME" || echo "[entrypoint] Warning: marketplace update failed"
fi

# Install / update all plugins listed in the marketplace manifest
MANIFEST="$HOME/.claude/plugins/marketplaces/$MARKETPLACE_NAME/.claude-plugin/marketplace.json"
if [ -f "$MANIFEST" ]; then
  PLUGINS=$(grep '"name"' "$MANIFEST" | grep -v '"owner"' | sed 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
else
  # fallback if manifest not readable yet
  PLUGINS="grocery-list recipes prescriptions health jellyfin food-log meal-plan vehicles contacts maintenance gifts travel roadmap energy"
fi

for plugin in $PLUGINS; do
  echo "[entrypoint] Installing plugin: $plugin@$MARKETPLACE_NAME"
  claude plugin install "${plugin}@${MARKETPLACE_NAME}" || echo "[entrypoint] Warning: could not install $plugin"
done

echo "[entrypoint] Starting bot..."
exec node src/index.js
