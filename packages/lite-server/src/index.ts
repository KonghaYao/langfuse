/**
 * Lite server entrypoint.
 *
 * IMPORTANT: `./env` must be the first import — it forces LANGFUSE_MODE=lite
 * and SQLite defaults before `@langfuse/shared` reads and caches the mode.
 */
import "./env";

import { serve } from "@hono/node-server";
import { logger } from "@langfuse/shared/src/server";
import { createApp } from "./app";
import { liteEnv } from "./env";

const app = createApp();

serve({ fetch: app.fetch, port: liteEnv.port }, (info) => {
  logger.info(
    // eslint-disable-next-line turbo/no-undeclared-env-vars -- log-only runtime read
    `[lite-server] Langfuse lite server listening on http://localhost:${info.port} (mode=${process.env.LANGFUSE_MODE})`,
  );
});
