#!/bin/bash
# =============================================================================
# Langfuse Lite Mode Development Server
# =============================================================================
# Zero-dependency local development: no Docker, PostgreSQL, ClickHouse, Redis, or S3.
# Uses SQLite for both Prisma (auth/projects) and telemetry (traces/observations/scores).
#
# Usage: pnpm run dev:lite
# =============================================================================

set -e

export LANGFUSE_MODE=lite
export LANGFUSE_MIGRATION_V4_WRITE_MODE=legacy

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Resolve monorepo root (directory containing this script's parent)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

echo -e "${GREEN}🚀 Starting Langfuse in Lite Mode${NC}"
echo "   Mode: lite (SQLite-only, zero external dependencies)"
echo ""

# 1. Generate SQLite schema if it doesn't exist
if [ ! -f packages/shared/prisma/schema.sqlite.prisma ]; then
  echo -e "${YELLOW}📦 Generating SQLite schema...${NC}"
  node packages/shared/prisma/scripts/generate-sqlite-schema.mjs
fi

# 2. Create .langfuse directory for SQLite databases
mkdir -p .langfuse

# 3. Set default DATABASE_URL for SQLite if not set
if [ -z "$DATABASE_URL" ]; then
  export DATABASE_URL="file:../.langfuse/langfuse.db"
  echo "   DATABASE_URL: $DATABASE_URL"
fi

# 4. Push Prisma schema to SQLite (creates tables if needed)
echo -e "${YELLOW}📦 Setting up Prisma database...${NC}"
npx prisma db push --schema=packages/shared/prisma/schema.sqlite.prisma --skip-generate 2>/dev/null || {
  echo "   Note: Prisma db push skipped (schema may already be up to date)"
}

# 5. Generate Prisma Client from SQLite schema
echo -e "${YELLOW}📦 Generating Prisma Client (SQLite)...${NC}"
npx prisma generate --schema=packages/shared/prisma/schema.sqlite.prisma 2>/dev/null

# 6. Patch Prisma Client with enum values from PostgreSQL schema
echo -e "${YELLOW}📦 Patching Prisma Client enums...${NC}"
node packages/shared/prisma/scripts/patch-prisma-enums.mjs

# 7. Build shared package (emit JS despite type errors from SQLite schema)
echo -e "${YELLOW}📦 Building shared package...${NC}"
(cd packages/shared && pnpm exec tsc --skipLibCheck --noEmit false --outDir dist --declaration false --declarationMap false 2>/dev/null) || true

echo ""
echo -e "${GREEN}✅ Setup complete. Starting dev server...${NC}"
echo "   URL: http://localhost:3000"
echo ""
echo "   Tips:"
echo "   - Register a new account at http://localhost:3000/auth/sign-up"
echo "   - Create a project to get API keys"
echo "   - Use the SDK to send traces to http://localhost:3000/api/public/ingestion"
echo ""

# 8. Start the web dev server
pnpm --filter web run dev
