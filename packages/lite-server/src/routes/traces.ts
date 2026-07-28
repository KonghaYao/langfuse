/**
 * GET /api/public/traces and GET /api/public/traces/:traceId
 *
 * Simplified ports of web/src/pages/api/public/traces/index.ts and
 * web/src/pages/api/public/traces/[traceId].ts (GET paths only, legacy
 * traces-table code path — the events-table path is not used in lite mode).
 */
import { Hono } from "hono";
import Decimal from "decimal.js";
import {
  filterAndValidateDbLegacyTraceScoreList,
  LangfuseNotFoundError,
} from "@langfuse/shared";
import { prisma } from "@langfuse/shared/src/db";
import {
  getObservationsForTrace,
  getScoresForTraces,
  getTraceById,
  traceException,
  TRACE_FIELD_GROUPS,
} from "@langfuse/shared/src/server";
import { authMiddleware, type LiteServerEnv } from "../auth";
import { GetTracesV1Query, GetTraceV1Query } from "../schemas/traces";
import {
  generateTracesForPublicApi,
  getTracesCountForPublicApi,
} from "../shaping/traces";
import { transformDbToApiObservation } from "../shaping/observations";

const app = new Hono<LiteServerEnv>();

app.get("/api/public/traces", authMiddleware, async (c) => {
  const auth = c.get("auth");

  const parsed = GetTracesV1Query.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(
      { message: "Invalid request data", error: parsed.error.issues },
      400,
    );
  }
  const query = parsed.data;

  const filterProps = {
    projectId: auth.scope.projectId,
    page: query.page ?? undefined,
    limit: query.limit ?? undefined,
    fields: query.fields ?? undefined,
    userId: query.userId ?? undefined,
    name: query.name ?? undefined,
    tags: query.tags ?? undefined,
    environment: query.environment ?? undefined,
    sessionId: query.sessionId ?? undefined,
    version: query.version ?? undefined,
    release: query.release ?? undefined,
    fromTimestamp: query.fromTimestamp ?? undefined,
    toTimestamp: query.toTimestamp ?? undefined,
  };

  const [items, count] = await Promise.all([
    generateTracesForPublicApi({
      props: filterProps,
      advancedFilters: query.filter,
      orderBy: query.orderBy ?? null,
    }),
    getTracesCountForPublicApi({
      props: filterProps,
      advancedFilters: query.filter,
    }),
  ]);

  const finalCount = count || 0;
  return c.json({
    data: items.map((item) => ({
      ...item,
      externalId: null,
    })),
    meta: {
      page: query.page,
      limit: query.limit,
      totalItems: finalCount,
      totalPages: Math.ceil(finalCount / query.limit),
    },
  });
});

app.get("/api/public/traces/:traceId", authMiddleware, async (c) => {
  const auth = c.get("auth");

  const parsed = GetTraceV1Query.safeParse({
    traceId: c.req.param("traceId"),
    ...c.req.query(),
  });
  if (!parsed.success) {
    return c.json(
      { message: "Invalid request data", error: parsed.error.issues },
      400,
    );
  }
  const { traceId } = parsed.data;

  const requestedFields = parsed.data.fields ?? TRACE_FIELD_GROUPS;
  const includeIO = requestedFields.includes("io");
  const includeObservations = requestedFields.includes("observations");
  const includeScores = requestedFields.includes("scores");
  const includeMetrics = requestedFields.includes("metrics");

  // eslint-disable-next-line @typescript-eslint/no-deprecated -- Legacy public API endpoint reads from the legacy traces table.
  const trace = await getTraceById({
    traceId,
    projectId: auth.scope.projectId,
    excludeInputOutput: !includeIO,
    excludeMetadata: !includeIO,
  });

  if (!trace) {
    throw new LangfuseNotFoundError(
      `Trace ${traceId} not found within authorized project`,
    );
  }

  const [observations, scores] = await Promise.all([
    includeObservations || includeMetrics
      ? getObservationsForTrace({
          traceId,
          projectId: auth.scope.projectId,
          timestamp: trace.timestamp,
          includeIO: includeObservations,
        })
      : Promise.resolve([]),
    includeScores
      ? getScoresForTraces({
          projectId: auth.scope.projectId,
          traceIds: [traceId],
          timestamp: trace.timestamp,
        })
      : Promise.resolve([]),
  ]);

  const uniqueModels: string[] = Array.from(
    new Set(
      observations
        .map((r) => r.internalModelId)
        .filter((r): r is string => Boolean(r)),
    ),
  );

  const models =
    uniqueModels.length > 0
      ? await prisma.model.findMany({
          where: {
            id: {
              in: uniqueModels,
            },
            OR: [{ projectId: auth.scope.projectId }, { projectId: null }],
          },
          include: {
            Price: true,
          },
        })
      : [];

  const observationsView = observations.map((o) => {
    const model = models.find((m) => m.id === o.internalModelId);
    const inputPrice =
      model?.Price.find((p) => p.usageType === "input")?.price ??
      new Decimal(0);
    const outputPrice =
      model?.Price.find((p) => p.usageType === "output")?.price ??
      new Decimal(0);
    const totalPrice =
      model?.Price.find((p) => p.usageType === "total")?.price ??
      new Decimal(0);
    return {
      ...o,
      inputPrice,
      outputPrice,
      totalPrice,
    };
  });

  const outObservations = observationsView.map(transformDbToApiObservation);
  // As these are trace scores, we expect all scores to have a traceId set.
  const validatedScores = filterAndValidateDbLegacyTraceScoreList({
    scores,
    onParseError: traceException,
  });

  const obsStartTimes = observations
    .map((o) => o.startTime)
    .sort((a, b) => a.getTime() - b.getTime());
  const obsEndTimes = observations
    .map((o) => o.endTime)
    .filter((t) => t)
    .sort((a, b) => (a as Date).getTime() - (b as Date).getTime());

  const latencyMs =
    obsStartTimes.length > 0
      ? obsEndTimes.length > 0
        ? (obsEndTimes[obsEndTimes.length - 1] as Date).getTime() -
          obsStartTimes[0]!.getTime()
        : obsStartTimes.length > 1
          ? obsStartTimes[obsStartTimes.length - 1]!.getTime() -
            obsStartTimes[0]!.getTime()
          : undefined
      : undefined;

  return c.json({
    ...trace,
    externalId: null,
    metadata: includeIO ? trace.metadata : {},
    scores: includeScores ? validatedScores : [],
    latency: includeMetrics
      ? latencyMs !== undefined
        ? latencyMs / 1000
        : 0
      : -1,
    observations: includeObservations ? outObservations : [],
    htmlPath: `/project/${auth.scope.projectId}/traces/${traceId}`,
    totalCost: includeMetrics
      ? outObservations
          .reduce(
            (acc, obs) => acc.add(obs.calculatedTotalCost ?? new Decimal(0)),
            new Decimal(0),
          )
          .toNumber()
      : -1,
  });
});

export default app;
