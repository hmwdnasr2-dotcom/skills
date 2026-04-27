#!/bin/bash
# Usage: bash aria/scripts/set-key.sh
# Safely updates a single key in aria/.env without nano

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found"
  exit 1
fi

echo ""
echo "Which key do you want to set?"
echo "  1) ANTHROPIC_API_KEY"
echo "  2) TELEGRAM_BOT_TOKEN"
echo "  3) TELEGRAM_CHAT_ID"
echo "  4) Other (you type the name)"
echo ""
read -rp "Choice [1-4]: " CHOICE

case "$CHOICE" in
  1) KEY_NAME="ANTHROPIC_API_KEY" ;;
  2) KEY_NAME="TELEGRAM_BOT_TOKEN" ;;
  3) KEY_NAME="TELEGRAM_CHAT_ID" ;;
  4) read -rp "Key name: " KEY_NAME ;;
  *) echo "Invalid choice"; exit 1 ;;
esac

echo ""
echo "Paste the value for $KEY_NAME (input is hidden):"
read -rs KEY_VALUE
echo ""

if [ -z "$KEY_VALUE" ]; then
  echo "ERROR: Value cannot be empty"
  exit 1
fi

# Remove existing line and append new one
sed -i "/^${KEY_NAME}=/d" "$ENV_FILE"
echo "${KEY_NAME}=${KEY_VALUE}" >> "$ENV_FILE"

echo "✓ $KEY_NAME updated in $ENV_FILE"
echo ""
echo "Verify (shows length only):"
grep "^${KEY_NAME}=" "$ENV_FILE" | wc -c
echo "chars (ANTHROPIC key should be ~109)"
echo ""
read -rp "Restart aria-server now? [y/N]: " RESTART
if [[ "$RESTART" =~ ^[Yy]$ ]]; then
  pm2 restart aria-server --update-env
  echo "Restarted."
fi
