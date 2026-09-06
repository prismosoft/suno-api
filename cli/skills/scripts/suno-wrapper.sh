#!/usr/bin/env bash
# Wrapper script for suno-cli that ensures env vars are set
# Usage: ./suno-wrapper.sh generate --prompt "A song about cats"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load env from ~/.suno-cli.env if it exists
[ -f "$HOME/.suno-cli.env" ] && source "$HOME/.suno-cli.env"

# Check required env vars
if [ -z "$SUNO_API_TOKEN" ]; then
  echo "Error: SUNO_API_TOKEN is not set."
  echo "Run 'suno-cli interactive' to configure, or set it manually:"
  echo '  export SUNO_API_TOKEN="your-token"'
  exit 1
fi

if [ -z "$SUNO_API_URL" ]; then
  export SUNO_API_URL="https://suno.prismosoft.com"
fi

exec suno-cli "$@"