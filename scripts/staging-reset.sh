#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# 🧪 STG-001 — Staging Reset Script
# ═══════════════════════════════════════════════════════════════
#
# يمسح قاعدة البيانات بالكامل ويعيد بناءها مع بيانات اختبارية.
#
# الاستخدام:
#   npm run staging:reset
#   bash scripts/staging-reset.sh
#
# ⚠️ يرفض العمل إذا لم يكن APP_ENV=staging أو local.
# ═══════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# ── 1. تحميل env ──
if [ -f .env.staging ]; then
  set -a
  source .env.staging
  set +a
  echo "📂 Loaded .env.staging"
elif [ -f .env ]; then
  set -a
  source .env
  set +a
  echo "📂 Loaded .env"
else
  echo "❌ No .env file found!"
  exit 1
fi

# ── 2. Safety check ──
if [ "$APP_ENV" != "staging" ] && [ "$APP_ENV" != "local" ]; then
  echo ""
  echo "🚫 STAGING RESET REFUSED"
  echo "   APP_ENV=\"$APP_ENV\" — يجب أن يكون staging أو local"
  echo ""
  exit 1
fi

echo ""
echo "════════════════════════════════════════════"
echo "🧪 STG-001 — Staging Reset"
echo "   APP_ENV:        $APP_ENV"
echo "   DATABASE_URL:   ${DATABASE_URL%%\?*}"
echo "   MEDIA_PATH:     $MEDIA_STORAGE_PATH"
echo "   BACKUP_PATH:    $BACKUP_STORAGE_PATH"
echo "════════════════════════════════════════════"
echo ""

# ── 3. Confirmation ──
read -p "⚠️  سيتم مسح كل البيانات. هل تريد المتابعة؟ (y/N): " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
  echo "❌ Cancelled."
  exit 0
fi

echo ""
echo "1/4 — Resetting database..."
npx prisma migrate reset --force --skip-seed

echo ""
echo "2/4 — Running migrations..."
npx prisma migrate deploy

echo ""
echo "3/4 — Seeding staging data..."
npx dotenv -e .env.staging -- npx ts-node src/tools/staging-seed.ts

echo ""
echo "4/4 — Preparing media storage..."
mkdir -p "$MEDIA_STORAGE_PATH/tmp"
echo "   ↳ $MEDIA_STORAGE_PATH ready"

echo ""
echo "════════════════════════════════════════════"
echo "✅ Staging reset complete!"
echo "════════════════════════════════════════════"
echo ""
echo "يمكنك الآن تشغيل:"
echo "  npm run start:staging"
echo ""
