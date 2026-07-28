/**
 * Environment bootstrap for the Lite server.
 *
 * This module MUST be imported before anything that pulls in
 * `@langfuse/shared`, because the shared adapter factory reads
 * `LANGFUSE_MODE` once and caches it. We force lite mode and provide
 * SQLite defaults so the server runs with zero external services.
 */
/* eslint-disable turbo/no-undeclared-env-vars -- runtime env bootstrap, not a build input */
import * as fs from "node:fs";
import * as path from "node:path";

function findMonorepoRoot(): string {
  let dir = __dirname;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

const repoRoot = findMonorepoRoot();

// Force lite mode unless the caller explicitly chose otherwise.
if (!process.env.LANGFUSE_MODE) {
  process.env.LANGFUSE_MODE = "lite";
}

// Prisma resolves relative `file:` URLs against the process CWD. The shared
// `.env` is written relative to web/ (`file:../.langfuse/langfuse.db`), but
// this server runs from packages/lite-server — so re-anchor any relative
// DATABASE_URL against the web/ directory to keep pointing at the same DB.
if (process.env.DATABASE_URL?.startsWith("file:")) {
  const rawPath = process.env.DATABASE_URL.slice("file:".length);
  if (!path.isAbsolute(rawPath)) {
    process.env.DATABASE_URL = "file:" + path.resolve(repoRoot, "web", rawPath);
  }
} else if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    "file:" + path.join(repoRoot, ".langfuse", "langfuse.db");
}

// Telemetry storage defaults to the local SQLite file. The shared
// SQLiteTelemetryAdapter already resolves relative paths from the monorepo
// root, so a plain relative default is safe here.
if (!process.env.LANGFUSE_SQLITE_DB_PATH) {
  process.env.LANGFUSE_SQLITE_DB_PATH = ".langfuse/telemetry.db";
}

export const liteEnv = {
  port: process.env.LITE_SERVER_PORT
    ? parseInt(process.env.LITE_SERVER_PORT, 10)
    : 23332,
  salt: process.env.SALT,
};
