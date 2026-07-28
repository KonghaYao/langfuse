/**
 * Hono application assembly for the lite server.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { BaseError, LangfuseNotFoundError } from "@langfuse/shared";
import { logger } from "@langfuse/shared/src/server";
import type { LiteServerEnv } from "./auth";
import healthRoutes from "./routes/health";
import ingestionRoutes from "./routes/ingestion";
import otelRoutes from "./routes/otel";
import tracesRoutes from "./routes/traces";
import observationsRoutes from "./routes/observations";
import scoresRoutes from "./routes/scores";

export function createApp(): Hono<LiteServerEnv> {
  const app = new Hono<LiteServerEnv>();

  // Mirror web's permissive CORS (origin: true, credentials: false) so SDKs
  // and browser-based clients can call the public API cross-origin.
  app.use(
    "/api/public/*",
    cors({
      origin: (origin) => origin || "*",
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "x-langfuse-sdk-name",
        "x-langfuse-sdk-version",
        "x-langfuse-sdk-integration",
        "x-langfuse-ingestion-version",
        "x-langfuse-public-key",
        "x-langfuse-secret-key",
        "x-langfuse-session-id",
      ],
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      credentials: false,
    }),
  );

  // Global error handler: map BaseError subclasses (incl. 404) to their
  // HTTP codes; everything else becomes a 500.
  app.onError((err, c) => {
    if (err instanceof LangfuseNotFoundError) {
      return c.json({ message: err.message }, 404);
    }
    if (err instanceof BaseError) {
      if (!err.isUserError()) {
        logger.error(err);
      }
      return c.json(
        { error: err.name, message: err.message },
        err.httpCode as 500,
      );
    }
    logger.error("Unhandled lite-server error", err);
    return c.json({ message: "Internal Server Error" }, 500);
  });

  app.route("/", healthRoutes);
  app.route("/", ingestionRoutes);
  app.route("/", otelRoutes);
  app.route("/", tracesRoutes);
  app.route("/", observationsRoutes);
  app.route("/", scoresRoutes);

  return app;
}
