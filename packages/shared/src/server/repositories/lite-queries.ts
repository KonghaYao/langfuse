/**
 * Lite-mode queries – reads trace/observation/score data from SQLite.
 *
 * These functions are called by repository-layer lite-mode branches when
 * `LANGFUSE_MODE=lite`. They return data in the same shapes the UI expects
 * (matching ClickHouse return types after domain conversion).
 */

import { getTelemetryDB } from "../adapters";
import { logger } from "../logger";
import type { TraceDomain, MetadataDomain } from "../../domain";
import type {
  ObservationRecordReadType,
  ScoreRecordReadType,
} from "./definitions";

// ============================================================================
// Helpers
// ============================================================================

/** Parse a JSON string safely, returning fallback on failure. */
function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

/** Convert SQLite boolean (0/1) to JS boolean. */
function toBool(value: unknown): boolean {
  return value === 1 || value === true || value === "1";
}

/** Ensure a date string from SQLite is in ClickHouse-compatible format. */
function toDateStr(value: unknown): string {
  if (!value) return new Date().toISOString().replace("T", " ").replace("Z", "");
  const s = String(value);
  // If it already has fractional seconds, return as-is
  if (s.includes(".")) return s;
  return s + ".000000";
}

/** Parse a usage/cost details field from SQLite (JSON string) to Record<string, number>. */
function toUsageRecord(value: unknown): Record<string, number> {
  const obj = safeJsonParse<Record<string, unknown>>(value, {});
  const result: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined) {
      const num = Number(v);
      if (!isNaN(num)) {
        result[k] = num;
      }
    }
  }
  return result;
}

// ============================================================================
// Trace Queries
// ============================================================================

export interface LiteTracesTableOpts {
  projectId: string;
  limit?: number;
  page?: number;
  searchQuery?: string;
  orderBy?: { column: string; order: "ASC" | "DESC" } | null;
}

export interface LiteTraceRow {
  id: string;
  projectId: string;
  timestamp: Date;
  tags: string[];
  bookmarked: boolean;
  name: string | null;
  release: string | null;
  version: string | null;
  userId: string | null;
  environment: string | null;
  sessionId: string | null;
  public: boolean;
}

/**
 * Get traces for the UI table listing.
 */
export async function liteGetTracesTable(
  opts: LiteTracesTableOpts,
): Promise<LiteTraceRow[]> {
  const db = getTelemetryDB();
  const { projectId, limit = 50, page = 0, searchQuery, orderBy } = opts;

  let whereClause = "WHERE project_id = @projectId AND is_deleted = 0";
  const params: Record<string, unknown> = { projectId };

  if (searchQuery) {
    whereClause += " AND (id LIKE @search OR name LIKE @search)";
    params.search = `%${searchQuery}%`;
  }

  // Map orderBy column to SQLite column
  let orderClause = "ORDER BY timestamp DESC";
  if (orderBy?.column) {
    const colMap: Record<string, string> = {
      timestamp: "timestamp",
      name: "name",
      createdAt: "created_at",
      userId: "user_id",
      sessionId: "session_id",
    };
    const col = colMap[orderBy.column] ?? "timestamp";
    const dir = orderBy.order === "ASC" ? "ASC" : "DESC";
    orderClause = `ORDER BY ${col} ${dir}`;
  }

  const offset = limit * page;
  params.limit = limit;
  params.offset = offset;

  const query = `
    SELECT id, project_id, timestamp, name, user_id, release, version,
           public, bookmarked, tags, session_id, environment
    FROM traces
    ${whereClause}
    ${orderClause}
    LIMIT @limit OFFSET @offset
  `;

  try {
    const rows = await db.query<Record<string, unknown>>({ query, params });
    return rows.map((row) => ({
      id: String(row.id),
      projectId: String(row.project_id),
      timestamp: new Date(String(row.timestamp).replace(" ", "T") + "Z"),
      tags: safeJsonParse<string[]>(row.tags, []),
      bookmarked: toBool(row.bookmarked),
      name: row.name ? String(row.name) : null,
      release: row.release ? String(row.release) : null,
      version: row.version ? String(row.version) : null,
      userId: row.user_id ? String(row.user_id) : null,
      environment: row.environment ? String(row.environment) : null,
      sessionId: row.session_id ? String(row.session_id) : null,
      public: toBool(row.public),
    }));
  } catch (error) {
    logger.error("[liteGetTracesTable] Query failed", error);
    return [];
  }
}

/**
 * Get total trace count for pagination.
 */
export async function liteGetTracesTableCount(
  projectId: string,
  searchQuery?: string,
): Promise<number> {
  const db = getTelemetryDB();

  let whereClause = "WHERE project_id = @projectId AND is_deleted = 0";
  const params: Record<string, unknown> = { projectId };

  if (searchQuery) {
    whereClause += " AND (id LIKE @search OR name LIKE @search)";
    params.search = `%${searchQuery}%`;
  }

  try {
    const rows = await db.query<{ count: number }>({
      query: `SELECT COUNT(*) as count FROM traces ${whereClause}`,
      params,
    });
    return rows.length > 0 ? Number(rows[0].count) : 0;
  } catch (error) {
    logger.error("[liteGetTracesTableCount] Query failed", error);
    return 0;
  }
}

/**
 * Get a single trace by ID, returned as TraceDomain.
 */
export async function liteGetTraceById(
  projectId: string,
  traceId: string,
): Promise<TraceDomain | undefined> {
  const db = getTelemetryDB();

  try {
    const rows = await db.query<Record<string, unknown>>({
      query: `SELECT * FROM traces WHERE project_id = @projectId AND id = @traceId AND is_deleted = 0 LIMIT 1`,
      params: { projectId, traceId },
    });

    if (rows.length === 0) return undefined;

    const row = rows[0];
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      name: row.name ? String(row.name) : null,
      timestamp: new Date(String(row.timestamp).replace(" ", "T") + "Z"),
      environment: row.environment ? String(row.environment) : "default",
      tags: safeJsonParse<string[]>(row.tags, []),
      bookmarked: toBool(row.bookmarked),
      release: row.release ? String(row.release) : null,
      version: row.version ? String(row.version) : null,
      userId: row.user_id ? String(row.user_id) : null,
      sessionId: row.session_id ? String(row.session_id) : null,
      public: toBool(row.public),
      input: row.input ? String(row.input) : null,
      output: row.output ? String(row.output) : null,
      metadata: safeJsonParse<MetadataDomain>(row.metadata, {} as MetadataDomain),
      createdAt: new Date(String(row.created_at).replace(" ", "T") + "Z"),
      updatedAt: new Date(String(row.updated_at).replace(" ", "T") + "Z"),
    };
  } catch (error) {
    logger.error("[liteGetTraceById] Query failed", error);
    return undefined;
  }
}

/**
 * Get trace metrics (simplified for lite mode).
 */
export async function liteGetTracesTableMetrics(
  projectId: string,
  traceIds: string[],
): Promise<
  Array<{
    id: string;
    projectId: string;
    promptTokens: bigint;
    completionTokens: bigint;
    totalTokens: bigint;
    latency: number | null;
    level: string;
    observationCount: bigint;
    calculatedTotalCost: number | null;
    calculatedInputCost: number | null;
    calculatedOutputCost: number | null;
    usageDetails: Record<string, number>;
    costDetails: Record<string, number>;
    errorCount: bigint;
    warningCount: bigint;
    defaultCount: bigint;
    debugCount: bigint;
  }>
> {
  if (traceIds.length === 0) return [];
  const db = getTelemetryDB();

  try {
    // Get observation stats per trace
    const placeholders = traceIds.map((_, i) => `@id${i}`).join(",");
    const params: Record<string, unknown> = { projectId };
    traceIds.forEach((id, i) => {
      params[`id${i}`] = id;
    });

    const obsStats = await db.query<Record<string, unknown>>({
      query: `
        SELECT trace_id,
               COUNT(*) as obs_count,
               SUM(CASE WHEN level = 'ERROR' THEN 1 ELSE 0 END) as error_count,
               SUM(CASE WHEN level = 'WARNING' THEN 1 ELSE 0 END) as warning_count,
               SUM(CASE WHEN level = 'DEFAULT' THEN 1 ELSE 0 END) as default_count,
               SUM(CASE WHEN level = 'DEBUG' THEN 1 ELSE 0 END) as debug_count,
               SUM(total_cost) as total_cost,
               MIN(start_time) as min_start,
               MAX(COALESCE(end_time, start_time)) as max_end
        FROM observations
        WHERE project_id = @projectId AND trace_id IN (${placeholders}) AND is_deleted = 0
        GROUP BY trace_id
      `,
      params,
    });

    const statsMap = new Map<string, Record<string, unknown>>();
    for (const row of obsStats) {
      statsMap.set(String(row.trace_id), row);
    }

    return traceIds.map((traceId) => {
      const stats = statsMap.get(traceId);
      if (!stats) {
        return {
          id: traceId,
          projectId,
          promptTokens: BigInt(0),
          completionTokens: BigInt(0),
          totalTokens: BigInt(0),
          latency: null,
          level: "DEFAULT",
          observationCount: BigInt(0),
          calculatedTotalCost: null,
          calculatedInputCost: null,
          calculatedOutputCost: null,
          usageDetails: {},
          costDetails: {},
          errorCount: BigInt(0),
          warningCount: BigInt(0),
          defaultCount: BigInt(0),
          debugCount: BigInt(0),
        };
      }

      const minStart = stats.min_start
        ? new Date(String(stats.min_start).replace(" ", "T") + "Z").getTime()
        : null;
      const maxEnd = stats.max_end
        ? new Date(String(stats.max_end).replace(" ", "T") + "Z").getTime()
        : null;
      const latency =
        minStart !== null && maxEnd !== null ? (maxEnd - minStart) / 1000 : null;

      const errorCount = BigInt(Number(stats.error_count ?? 0));
      const warningCount = BigInt(Number(stats.warning_count ?? 0));

      return {
        id: traceId,
        projectId,
        promptTokens: BigInt(0),
        completionTokens: BigInt(0),
        totalTokens: BigInt(0),
        latency,
        level: errorCount > BigInt(0) ? "ERROR" : warningCount > BigInt(0) ? "WARNING" : "DEFAULT",
        observationCount: BigInt(Number(stats.obs_count ?? 0)),
        calculatedTotalCost: stats.total_cost ? Number(stats.total_cost) : null,
        calculatedInputCost: null,
        calculatedOutputCost: null,
        usageDetails: {},
        costDetails: {},
        errorCount,
        warningCount,
        defaultCount: BigInt(Number(stats.default_count ?? 0)),
        debugCount: BigInt(Number(stats.debug_count ?? 0)),
      };
    });
  } catch (error) {
    logger.error("[liteGetTracesTableMetrics] Query failed", error);
    return traceIds.map((traceId) => ({
      id: traceId,
      projectId,
      promptTokens: BigInt(0),
      completionTokens: BigInt(0),
      totalTokens: BigInt(0),
      latency: null,
      level: "DEFAULT",
      observationCount: BigInt(0),
      calculatedTotalCost: null,
      calculatedInputCost: null,
      calculatedOutputCost: null,
      usageDetails: {},
      costDetails: {},
      errorCount: BigInt(0),
      warningCount: BigInt(0),
      defaultCount: BigInt(0),
      debugCount: BigInt(0),
    }));
  }
}

// ============================================================================
// Observation Queries
// ============================================================================

/**
 * Get observations for a trace, returned as ObservationRecordReadType[].
 */
export async function liteGetObservationsForTrace(
  projectId: string,
  traceId: string,
  includeIO = false,
): Promise<ObservationRecordReadType[]> {
  const db = getTelemetryDB();

  const ioColumns = includeIO ? "input, output, metadata," : "";

  try {
    const rows = await db.query<Record<string, unknown>>({
      query: `
        SELECT id, trace_id, project_id, type, parent_observation_id,
               environment, start_time, end_time, name, level, status_message,
               version, ${ioColumns}
               model as provided_model_name,
               '' as internal_model_id,
               model_parameters,
               provided_usage_details, usage_details,
               provided_cost_details, cost_details,
               total_cost,
               '' as usage_pricing_tier_id,
               '' as usage_pricing_tier_name,
               completion_start_time,
               prompt_id, prompt_name, prompt_version,
               created_at, updated_at, event_ts
        FROM observations
        WHERE project_id = @projectId AND trace_id = @traceId AND is_deleted = 0
        ORDER BY start_time ASC
      `,
      params: { projectId, traceId },
    });

    return rows.map((row) => ({
      id: String(row.id),
      trace_id: row.trace_id ? String(row.trace_id) : null,
      project_id: String(row.project_id),
      type: String(row.type ?? "SPAN"),
      parent_observation_id: row.parent_observation_id
        ? String(row.parent_observation_id)
        : null,
      environment: String(row.environment ?? "default"),
      name: row.name ? String(row.name) : null,
      metadata: includeIO
        ? safeJsonParse<Record<string, string>>(row.metadata, {})
        : {},
      level: row.level ? String(row.level) : null,
      status_message: row.status_message ? String(row.status_message) : null,
      version: row.version ? String(row.version) : null,
      input: includeIO && row.input ? String(row.input) : null,
      output: includeIO && row.output ? String(row.output) : null,
      provided_model_name: row.provided_model_name
        ? String(row.provided_model_name)
        : null,
      internal_model_id: null,
      model_parameters: row.model_parameters
        ? String(row.model_parameters)
        : null,
      total_cost: row.total_cost ? Number(row.total_cost) : null,
      usage_pricing_tier_id: null,
      usage_pricing_tier_name: null,
      prompt_id: row.prompt_id ? String(row.prompt_id) : null,
      prompt_name: row.prompt_name ? String(row.prompt_name) : null,
      prompt_version: row.prompt_version ? Number(row.prompt_version) : null,
      tool_definitions: undefined,
      tool_calls: undefined,
      tool_call_names: undefined,
      is_deleted: 0,
      start_time: toDateStr(row.start_time),
      end_time: row.end_time ? toDateStr(row.end_time) : null,
      completion_start_time: row.completion_start_time
        ? toDateStr(row.completion_start_time)
        : null,
      created_at: toDateStr(row.created_at),
      updated_at: toDateStr(row.updated_at),
      event_ts: toDateStr(row.event_ts),
      provided_usage_details: toUsageRecord(row.provided_usage_details),
      provided_cost_details: toUsageRecord(row.provided_cost_details),
      usage_details: toUsageRecord(row.usage_details),
      cost_details: toUsageRecord(row.cost_details),
    })) as ObservationRecordReadType[];
  } catch (error) {
    logger.error("[liteGetObservationsForTrace] Query failed", error);
    return [];
  }
}

// ============================================================================
// Score Queries
// ============================================================================

/**
 * Get scores for a set of traces, returned as ScoreRecordReadType[].
 */
export async function liteGetScoresForTraces(
  projectId: string,
  traceIds: string[],
): Promise<ScoreRecordReadType[]> {
  if (traceIds.length === 0) return [];
  const db = getTelemetryDB();

  try {
    const placeholders = traceIds.map((_, i) => `@id${i}`).join(",");
    const params: Record<string, unknown> = { projectId };
    traceIds.forEach((id, i) => {
      params[`id${i}`] = id;
    });

    const rows = await db.query<Record<string, unknown>>({
      query: `
        SELECT * FROM scores
        WHERE project_id = @projectId AND trace_id IN (${placeholders}) AND is_deleted = 0
        ORDER BY timestamp DESC
      `,
      params,
    });

    return rows.map((row) => ({
      id: String(row.id),
      project_id: String(row.project_id),
      trace_id: row.trace_id ? String(row.trace_id) : null,
      session_id: null,
      observation_id: row.observation_id ? String(row.observation_id) : null,
      dataset_run_id: null,
      environment: String(row.environment ?? "default"),
      name: String(row.name),
      value: row.value !== null ? Number(row.value) : 0,
      source: String(row.source ?? "API"),
      comment: row.comment ? String(row.comment) : null,
      metadata: safeJsonParse<Record<string, string>>(row.metadata, {}),
      author_user_id: row.author_user_id ? String(row.author_user_id) : null,
      config_id: row.config_id ? String(row.config_id) : null,
      data_type: String(row.data_type ?? "NUMERIC"),
      string_value: row.string_value ? String(row.string_value) : null,
      long_string_value: row.string_value ? String(row.string_value) : "",
      queue_id: row.queue_id ? String(row.queue_id) : null,
      execution_trace_id: null,
      ingestion_api_key: "",
      ingestion_sdk_name: "",
      ingestion_sdk_version: "",
      is_deleted: 0,
      timestamp: toDateStr(row.timestamp),
      created_at: toDateStr(row.created_at),
      updated_at: toDateStr(row.updated_at),
      event_ts: toDateStr(row.event_ts),
    })) as ScoreRecordReadType[];
  } catch (error) {
    logger.error("[liteGetScoresForTraces] Query failed", error);
    return [];
  }
}

// ============================================================================
// Session Queries
// ============================================================================

/**
 * Get trace identifiers for a session.
 */
export async function liteGetTracesIdentifierForSession(
  projectId: string,
  sessionId: string,
): Promise<
  Array<{ id: string; timestamp: Date; name: string | null; userId: string | null }>
> {
  const db = getTelemetryDB();

  try {
    const rows = await db.query<Record<string, unknown>>({
      query: `
        SELECT id, timestamp, name, user_id
        FROM traces
        WHERE project_id = @projectId AND session_id = @sessionId AND is_deleted = 0
        ORDER BY timestamp ASC
      `,
      params: { projectId, sessionId },
    });

    return rows.map((row) => ({
      id: String(row.id),
      timestamp: new Date(String(row.timestamp).replace(" ", "T") + "Z"),
      name: row.name ? String(row.name) : null,
      userId: row.user_id ? String(row.user_id) : null,
    }));
  } catch (error) {
    logger.error("[liteGetTracesIdentifierForSession] Query failed", error);
    return [];
  }
}

/**
 * Check if any traces exist for a project.
 */
export async function liteHasAnyTrace(projectId: string): Promise<boolean> {
  const db = getTelemetryDB();

  try {
    const rows = await db.query<{ count: number }>({
      query: `SELECT COUNT(*) as count FROM traces WHERE project_id = @projectId AND is_deleted = 0 LIMIT 1`,
      params: { projectId },
    });
    return rows.length > 0 && Number(rows[0].count) > 0;
  } catch {
    return false;
  }
}

// ============================================================================
// Observation Queries (Public API)
// ============================================================================

/**
 * Get a single observation by ID.
 */
export async function liteGetObservationById(
  projectId: string,
  observationId: string,
): Promise<ObservationRecordReadType | undefined> {
  const db = getTelemetryDB();

  try {
    const rows = await db.query<Record<string, unknown>>({
      query: `SELECT * FROM observations WHERE project_id = @projectId AND id = @observationId AND is_deleted = 0 LIMIT 1`,
      params: { projectId, observationId },
    });

    if (rows.length === 0) return undefined;

    const row = rows[0];
    return {
      id: String(row.id),
      trace_id: row.trace_id ? String(row.trace_id) : null,
      project_id: String(row.project_id),
      type: String(row.type ?? "SPAN"),
      parent_observation_id: row.parent_observation_id
        ? String(row.parent_observation_id)
        : null,
      environment: String(row.environment ?? "default"),
      name: row.name ? String(row.name) : null,
      metadata: safeJsonParse<Record<string, string>>(row.metadata, {}),
      level: row.level ? String(row.level) : null,
      status_message: row.status_message ? String(row.status_message) : null,
      version: row.version ? String(row.version) : null,
      input: row.input ? String(row.input) : null,
      output: row.output ? String(row.output) : null,
      provided_model_name: row.provided_model_name
        ? String(row.provided_model_name)
        : null,
      internal_model_id: null,
      model_parameters: row.model_parameters
        ? String(row.model_parameters)
        : null,
      total_cost: row.total_cost ? Number(row.total_cost) : null,
      usage_pricing_tier_id: null,
      usage_pricing_tier_name: null,
      prompt_id: row.prompt_id ? String(row.prompt_id) : null,
      prompt_name: row.prompt_name ? String(row.prompt_name) : null,
      prompt_version: row.prompt_version ? Number(row.prompt_version) : null,
      tool_definitions: undefined,
      tool_calls: undefined,
      tool_call_names: undefined,
      is_deleted: 0,
      start_time: toDateStr(row.start_time),
      end_time: row.end_time ? toDateStr(row.end_time) : null,
      completion_start_time: row.completion_start_time
        ? toDateStr(row.completion_start_time)
        : null,
      created_at: toDateStr(row.created_at),
      updated_at: toDateStr(row.updated_at),
      event_ts: toDateStr(row.event_ts),
      provided_usage_details: toUsageRecord(row.provided_usage_details),
      provided_cost_details: toUsageRecord(row.provided_cost_details),
      usage_details: toUsageRecord(row.usage_details),
      cost_details: toUsageRecord(row.cost_details),
    } as ObservationRecordReadType;
  } catch (error) {
    logger.error("[liteGetObservationById] Query failed", error);
    return undefined;
  }
}

/**
 * Get observations list with pagination.
 */
export async function liteGetObservationsTable(
  projectId: string,
  limit = 50,
  page = 0,
): Promise<ObservationRecordReadType[]> {
  const db = getTelemetryDB();
  const offset = limit * page;

  try {
    const rows = await db.query<Record<string, unknown>>({
      query: `
        SELECT * FROM observations
        WHERE project_id = @projectId AND is_deleted = 0
        ORDER BY start_time DESC
        LIMIT @limit OFFSET @offset
      `,
      params: { projectId, limit, offset },
    });

    return rows.map((row) => ({
      id: String(row.id),
      trace_id: row.trace_id ? String(row.trace_id) : null,
      project_id: String(row.project_id),
      type: String(row.type ?? "SPAN"),
      parent_observation_id: row.parent_observation_id
        ? String(row.parent_observation_id)
        : null,
      environment: String(row.environment ?? "default"),
      name: row.name ? String(row.name) : null,
      metadata: safeJsonParse<Record<string, string>>(row.metadata, {}),
      level: row.level ? String(row.level) : null,
      status_message: row.status_message ? String(row.status_message) : null,
      version: row.version ? String(row.version) : null,
      input: row.input ? String(row.input) : null,
      output: row.output ? String(row.output) : null,
      provided_model_name: row.provided_model_name
        ? String(row.provided_model_name)
        : null,
      internal_model_id: null,
      model_parameters: row.model_parameters
        ? String(row.model_parameters)
        : null,
      total_cost: row.total_cost ? Number(row.total_cost) : null,
      usage_pricing_tier_id: null,
      usage_pricing_tier_name: null,
      prompt_id: row.prompt_id ? String(row.prompt_id) : null,
      prompt_name: row.prompt_name ? String(row.prompt_name) : null,
      prompt_version: row.prompt_version ? Number(row.prompt_version) : null,
      tool_definitions: undefined,
      tool_calls: undefined,
      tool_call_names: undefined,
      is_deleted: 0,
      start_time: toDateStr(row.start_time),
      end_time: row.end_time ? toDateStr(row.end_time) : null,
      completion_start_time: row.completion_start_time
        ? toDateStr(row.completion_start_time)
        : null,
      created_at: toDateStr(row.created_at),
      updated_at: toDateStr(row.updated_at),
      event_ts: toDateStr(row.event_ts),
      provided_usage_details: toUsageRecord(row.provided_usage_details),
      provided_cost_details: toUsageRecord(row.provided_cost_details),
      usage_details: toUsageRecord(row.usage_details),
      cost_details: toUsageRecord(row.cost_details),
    })) as ObservationRecordReadType[];
  } catch (error) {
    logger.error("[liteGetObservationsTable] Query failed", error);
    return [];
  }
}

/**
 * Get a single score by ID.
 */
export async function liteGetScoreById(
  projectId: string,
  scoreId: string,
): Promise<ScoreRecordReadType | undefined> {
  const db = getTelemetryDB();

  try {
    const rows = await db.query<Record<string, unknown>>({
      query: `SELECT * FROM scores WHERE project_id = @projectId AND id = @scoreId AND is_deleted = 0 LIMIT 1`,
      params: { projectId, scoreId },
    });

    if (rows.length === 0) return undefined;

    const row = rows[0];
    return {
      id: String(row.id),
      project_id: String(row.project_id),
      trace_id: row.trace_id ? String(row.trace_id) : null,
      session_id: null,
      observation_id: row.observation_id ? String(row.observation_id) : null,
      environment: String(row.environment ?? "default"),
      name: String(row.name),
      value: row.value != null ? Number(row.value) : null,
      string_value: row.string_value ? String(row.string_value) : null,
      data_type: String(row.data_type ?? "NUMERIC"),
      source: String(row.source ?? "API"),
      comment: row.comment ? String(row.comment) : null,
      metadata: safeJsonParse<Record<string, string>>(row.metadata, {}),
      author_user_id: row.author_user_id ? String(row.author_user_id) : null,
      config_id: row.config_id ? String(row.config_id) : null,
      queue_id: row.queue_id ? String(row.queue_id) : null,
      execution_trace_id: row.execution_trace_id
        ? String(row.execution_trace_id)
        : null,
      is_deleted: 0,
      timestamp: toDateStr(row.timestamp),
      created_at: toDateStr(row.created_at),
      updated_at: toDateStr(row.updated_at),
      event_ts: toDateStr(row.event_ts),
    } as ScoreRecordReadType;
  } catch (error) {
    logger.error("[liteGetScoreById] Query failed", error);
    return undefined;
  }
}

/**
 * Get scores list with pagination.
 */
export async function liteGetScoresTable(
  projectId: string,
  limit = 50,
  page = 0,
): Promise<ScoreRecordReadType[]> {
  const db = getTelemetryDB();
  const offset = limit * page;

  try {
    const rows = await db.query<Record<string, unknown>>({
      query: `
        SELECT * FROM scores
        WHERE project_id = @projectId AND is_deleted = 0
        ORDER BY timestamp DESC
        LIMIT @limit OFFSET @offset
      `,
      params: { projectId, limit, offset },
    });

    return rows.map((row) => ({
      id: String(row.id),
      project_id: String(row.project_id),
      trace_id: row.trace_id ? String(row.trace_id) : null,
      session_id: null,
      observation_id: row.observation_id ? String(row.observation_id) : null,
      environment: String(row.environment ?? "default"),
      name: String(row.name),
      value: row.value != null ? Number(row.value) : null,
      string_value: row.string_value ? String(row.string_value) : null,
      data_type: String(row.data_type ?? "NUMERIC"),
      source: String(row.source ?? "API"),
      comment: row.comment ? String(row.comment) : null,
      metadata: safeJsonParse<Record<string, string>>(row.metadata, {}),
      author_user_id: row.author_user_id ? String(row.author_user_id) : null,
      config_id: row.config_id ? String(row.config_id) : null,
      queue_id: row.queue_id ? String(row.queue_id) : null,
      execution_trace_id: row.execution_trace_id
        ? String(row.execution_trace_id)
        : null,
      is_deleted: 0,
      timestamp: toDateStr(row.timestamp),
      created_at: toDateStr(row.created_at),
      updated_at: toDateStr(row.updated_at),
      event_ts: toDateStr(row.event_ts),
    })) as ScoreRecordReadType[];
  } catch (error) {
    logger.error("[liteGetScoresTable] Query failed", error);
    return [];
  }
}

/**
 * Get sessions list with pagination.
 */
export async function liteGetSessionsTable(
  projectId: string,
  limit = 50,
  page = 0,
): Promise<Array<{ id: string; projectId: string; createdAt: Date }>> {
  const db = getTelemetryDB();
  const offset = limit * page;

  try {
    const rows = await db.query<Record<string, unknown>>({
      query: `
        SELECT DISTINCT session_id as id, project_id, MIN(created_at) as created_at
        FROM traces
        WHERE project_id = @projectId AND session_id IS NOT NULL AND is_deleted = 0
        GROUP BY session_id
        ORDER BY created_at DESC
        LIMIT @limit OFFSET @offset
      `,
      params: { projectId, limit, offset },
    });

    return rows.map((row) => ({
      id: String(row.id),
      projectId: String(row.project_id),
      createdAt: new Date(String(row.created_at).replace(" ", "T") + "Z"),
    }));
  } catch (error) {
    logger.error("[liteGetSessionsTable] Query failed", error);
    return [];
  }
}
