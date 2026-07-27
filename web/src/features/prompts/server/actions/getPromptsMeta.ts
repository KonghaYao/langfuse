import {
  type GetPromptsMetaType,
  type FilterState,
  promptsTableCols,
  type PromptType,
} from "@langfuse/shared";
import { prisma } from "@langfuse/shared/src/db";
import {
  tableColumnsToSqlFilterAndPrefix,
  isLiteMode,
} from "@langfuse/shared/src/server";

export type GetPromptsMetaParams = GetPromptsMetaType & { projectId: string };

export const getPromptsMeta = async (
  params: GetPromptsMetaParams,
): Promise<PromptsMetaResponse> => {
  const { projectId, page, limit } = params;

  if (isLiteMode()) {
    return getPromptsMetaLite(params);
  }

  const promptsMeta = (await prisma.$queryRaw`
    WITH versions AS (
      SELECT
        p.name AS name,
        MAX(p.tags) AS tags,  -- use max to get tags, they are the same for all versions of a prompt
        MAX(p.updated_at) as "lastUpdatedAt",
        array_agg(DISTINCT p.version) AS versions,
        COALESCE(array_agg(DISTINCT label) FILTER (WHERE label IS NOT NULL), '{}'::text[]) AS labels --- COALESCE is necessary to return an empty array if there are no labels and remove NULLs
      FROM
          prompts p -- needs to be p for filter conditions
      LEFT JOIN LATERAL unnest(p.labels) AS label ON true
      WHERE
          p."project_id" = ${projectId}
          ${getPromptsFilterCondition(params)}
      GROUP BY
          p.name
      ORDER BY
          p.name --- necessary for consistent pagination
      LIMIT
          ${limit}
      OFFSET
          ${limit * (page - 1)}
    )

    SELECT
      v.*,
      latest.type AS type,
      latest.config AS "lastConfig"
    FROM
      versions v
    LEFT JOIN LATERAL (
      SELECT p.config, p.type
      FROM prompts p
      WHERE p."project_id" = ${projectId}
        AND p.name = v.name
        ${getPromptsFilterCondition(params)}
      ORDER BY p.version DESC
      LIMIT 1
    ) latest ON true
    ORDER BY v.name
  `) as PromptsMeta[];

  const [{ count: totalItemsCount }] = (await prisma.$queryRaw`
    SELECT COUNT(DISTINCT p.name) AS count
    FROM prompts p
    WHERE "project_id" = ${projectId} 
    ${getPromptsFilterCondition(params)}
  `) as { count: BigInt }[];

  const totalItems = Number(totalItemsCount);
  const totalPages = Math.ceil(totalItems / limit);

  return {
    data: promptsMeta,
    meta: { page, limit, totalPages, totalItems },

    // necessary for backwards compatibility as we initially released the /v2/prompts endpoint with this structure which did not match the api spec
    // https://github.com/langfuse/langfuse/issues/2068
    pagination: { page, limit, totalPages, totalItems },
  };
};

type PromptsMeta = {
  name: string;
  versions: number[];
  labels: string[];
  tags: string[];
  lastUpdatedAt: Date;
  type: PromptType;
  lastConfig: unknown; // json object
};

export type PromptsMetaResponse = {
  data: PromptsMeta[];
  meta: {
    page: number;
    limit: number;
    totalPages: number;
    totalItems: number;
  };
  // necessary for backwards compatibility as we initially released the /v2/prompts endpoint with this structure which did not match the api spec
  // https://github.com/langfuse/langfuse/issues/2068
  pagination: {
    page: number;
    limit: number;
    totalPages: number;
    totalItems: number;
  };
};

const getPromptsFilterCondition = (params: GetPromptsMetaType) => {
  const { name, version, label, tag, fromUpdatedAt, toUpdatedAt } = params;
  const filters: FilterState = [];

  if (name) {
    filters.push({
      column: "name",
      type: "string",
      operator: "=",
      value: name,
    });
  }

  if (version) {
    filters.push({
      column: "version",
      type: "number",
      operator: "=",
      value: version,
    });
  }

  if (label) {
    filters.push({
      column: "labels",
      type: "arrayOptions",
      operator: "any of",
      value: [label],
    });
  }

  if (tag) {
    filters.push({
      column: "tags",
      type: "arrayOptions",
      operator: "any of",
      value: [tag],
    });
  }

  if (fromUpdatedAt) {
    filters.push({
      column: "updatedAt",
      type: "datetime",
      operator: ">=",
      value: new Date(fromUpdatedAt),
    });
  }

  if (toUpdatedAt) {
    filters.push({
      column: "updatedAt",
      type: "datetime",
      operator: "<",
      value: new Date(toUpdatedAt),
    });
  }

  return tableColumnsToSqlFilterAndPrefix(filters, promptsTableCols, "prompts");
};

/**
 * Lite mode (SQLite) implementation using Prisma query builder.
 * Avoids PG-specific array_agg, LATERAL unnest, FILTER clauses.
 */
const getPromptsMetaLite = async (
  params: GetPromptsMetaParams,
): Promise<PromptsMetaResponse> => {
  const { projectId, page, limit, name, version, label, tag, fromUpdatedAt, toUpdatedAt } = params;

  // Build Prisma where clause
  const where: Record<string, unknown> = { projectId };
  if (name) where.name = name;
  if (version) where.version = version;
  if (fromUpdatedAt || toUpdatedAt) {
    where.updatedAt = {};
    if (fromUpdatedAt) (where.updatedAt as Record<string, unknown>).gte = new Date(fromUpdatedAt);
    if (toUpdatedAt) (where.updatedAt as Record<string, unknown>).lt = new Date(toUpdatedAt);
  }

  // Get all prompts matching filters
  const allPrompts = await prisma.prompt.findMany({
    where: where as never,
    orderBy: [{ name: "asc" }, { version: "desc" }],
  });

  // Filter by label/tag in JS (stored as JSON arrays in SQLite)
  let filtered = allPrompts;
  if (label) {
    filtered = filtered.filter((p) => {
      const labels = JSON.parse((p.labels as string) || "[]") as string[];
      return labels.includes(label);
    });
  }
  if (tag) {
    filtered = filtered.filter((p) => {
      const tags = JSON.parse((p.tags as string) || "[]") as string[];
      return tags.includes(tag);
    });
  }

  // Group by name
  const grouped = new Map<
    string,
    { versions: number[]; labels: Set<string>; tags: string[]; lastUpdatedAt: Date; type: string; config: unknown }
  >();

  for (const p of filtered) {
    const existing = grouped.get(p.name);
    const pLabels = JSON.parse((p.labels as string) || "[]") as string[];
    const pTags = JSON.parse((p.tags as string) || "[]") as string[];

    if (!existing) {
      grouped.set(p.name, {
        versions: [p.version],
        labels: new Set(pLabels),
        tags: pTags,
        lastUpdatedAt: p.updatedAt,
        type: p.type, // first entry is latest due to ORDER BY version DESC
        config: p.config,
      });
    } else {
      existing.versions.push(p.version);
      pLabels.forEach((l) => existing.labels.add(l));
      if (p.updatedAt > existing.lastUpdatedAt) {
        existing.lastUpdatedAt = p.updatedAt;
      }
    }
  }

  const totalItems = grouped.size;
  const totalPages = Math.ceil(totalItems / limit);

  // Paginate
  const names = Array.from(grouped.keys()).sort();
  const pagedNames = names.slice((page - 1) * limit, page * limit);

  const data: PromptsMeta[] = pagedNames.map((n) => {
    const g = grouped.get(n)!;
    return {
      name: n,
      versions: g.versions.sort((a, b) => a - b),
      labels: Array.from(g.labels),
      tags: g.tags,
      lastUpdatedAt: g.lastUpdatedAt,
      type: g.type as PromptType,
      lastConfig: g.config ? JSON.parse(g.config as string) : {},
    };
  });

  return {
    data,
    meta: { page, limit, totalPages, totalItems },
    pagination: { page, limit, totalPages, totalItems },
  };
};
