#!/usr/bin/env bash
# Run this on the production server to fix DNS, apply migrations, and restart ARIA.
# Usage: cd /root/skills && bash aria/scripts/server-setup.sh

set -e

ARIA_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ARIA_DIR"

echo "=== ARIA Server Setup ==="
echo "Working dir: $ARIA_DIR"
echo ""

# ── Step 1: Fix DNS ────────────────────────────────────────────────────────────
echo "→ Checking DNS..."
if ! grep -q "nameserver 8.8.8.8" /etc/resolv.conf; then
  echo "  Adding nameservers to /etc/resolv.conf..."
  # Prepend so they take priority over any broken defaults
  { echo "nameserver 8.8.8.8"; echo "nameserver 1.1.1.1"; cat /etc/resolv.conf; } > /tmp/resolv.conf.new
  mv /tmp/resolv.conf.new /etc/resolv.conf
  echo "  Done."
else
  echo "  DNS already configured."
fi

# ── Step 2: Test Supabase connectivity ────────────────────────────────────────
echo ""
echo "→ Testing Supabase DNS..."
SUPABASE_HOST=$(grep SUPABASE_URL .env 2>/dev/null | cut -d= -f2 | sed 's|https://||' | tr -d '[:space:]')
if [ -z "$SUPABASE_HOST" ]; then
  echo "  WARNING: SUPABASE_URL not found in .env — skipping DNS test"
else
  if nslookup "$SUPABASE_HOST" 8.8.8.8 >/dev/null 2>&1; then
    echo "  ✓ $SUPABASE_HOST resolves OK"
  else
    echo "  ✗ Cannot resolve $SUPABASE_HOST — check your network"
    exit 1
  fi
fi

# ── Step 3: Apply migration ────────────────────────────────────────────────────
echo ""
echo "→ Running migration (attempting pooler connection)..."
if npx tsx packages/server/src/run-migration.ts; then
  echo "  ✓ Migration applied via pooler."
else
  echo ""
  echo "  Pooler not reachable (port 5432 may be blocked)."
  echo "  ──────────────────────────────────────────────────────────────────────"
  echo "  ACTION REQUIRED: Paste the following SQL into the Supabase SQL Editor"
  echo "  at https://supabase.com/dashboard → your project → SQL Editor"
  echo "  ──────────────────────────────────────────────────────────────────────"
  echo ""
  cat supabase/migrations/006_correct_schema.sql
  echo ""
  echo "  After running the SQL, press Enter to continue..."
  read -r
fi

# ── Step 4: Restart ARIA server ───────────────────────────────────────────────
echo ""
echo "→ Restarting aria-server..."
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart aria-server
  sleep 2
  echo "  ✓ Restarted. Status:"
  pm2 show aria-server | grep -E "status|uptime|restarts" || true
else
  echo "  PM2 not found — restart aria-server manually."
fi

# ── Step 5: Smoke test ────────────────────────────────────────────────────────
echo ""
echo "→ Smoke test..."
sleep 3
REPLY=$(curl -s -X POST http://localhost:4000/api/aria/chat \
  -H 'Content-Type: application/json' \
  -d '{"userId":"setup-test","message":"create a project called Setup Test with goal: verify ARIA is working"}' \
  2>/dev/null | grep -o '"reply":"[^"]*"' || echo "no reply field")

echo "  Response: $REPLY"

if echo "$REPLY" | grep -qi "setup test\|created\|project"; then
  echo ""
  echo "✓ ARIA is responding correctly. Setup complete!"
else
  echo ""
  echo "  ⚠ Unexpected response. Check PM2 logs:"
  echo "    pm2 logs aria-server --lines 30"
fi
