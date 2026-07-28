/**
 * Session detail — lite replica of web's session detail view
 * (web/src/components/session/index.tsx + TraceRow.tsx), simplified.
 *
 * Header shows the session's aggregate metrics; below it each trace renders
 * as a card with its IO on the left and metadata/scores on the right (the
 * original TraceRow layout). The virtualized conversation view and
 * observation-level drill-down are out of scope for lite v1 — each card links
 * to the full trace detail page.
 */
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, Users } from "lucide-react";

import { getSession } from "@/lib/api";
import type { SessionScore, SessionTrace } from "@/lib/types";
import {
  formatDateTime,
  formatIntervalSeconds,
  formatTokens,
  usdFormatter,
} from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { JsonViewer } from "@/components/json-viewer";
import { EmptyState, ErrorState } from "@/components/state";

function ScoreBadge({ score }: { score: SessionScore }) {
  const display =
    score.dataType === "NUMERIC" || score.value !== null
      ? score.value !== null
        ? String(Math.round(score.value * 1000) / 1000)
        : ""
      : (score.stringValue ?? "");
  return (
    <Badge variant="outline" className="gap-1 font-normal">
      <span className="text-muted-foreground">{score.name}</span>
      {display && <span className="font-medium">{display}</span>}
    </Badge>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function TraceCard({ trace }: { trace: SessionTrace }) {
  return (
    <Card className="border-border shadow-none">
      <div className="grid md:grid-cols-[1fr_1px_320px]">
        {/* IO */}
        <div className="space-y-3 overflow-hidden p-4">
          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">
              Input
            </p>
            <JsonViewer data={trace.input} collapsed={1} />
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">
              Output
            </p>
            <JsonViewer data={trace.output} collapsed={1} />
          </div>
        </div>
        <div className="hidden bg-border md:block" />
        {/* Meta */}
        <div className="flex flex-col border-t p-4 md:border-0">
          <Link
            to={`/traces/${encodeURIComponent(trace.id)}`}
            className="hover:bg-accent flex items-start gap-2 rounded-lg border border-border p-2 transition-colors"
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-xs font-bold break-words">
                {trace.name ?? "(unnamed)"} ({trace.id})
              </span>
              <span className="text-xs text-muted-foreground">
                {formatDateTime(trace.timestamp)}
              </span>
            </div>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {trace.latency !== null && (
              <span>Latency: {formatIntervalSeconds(trace.latency)}</span>
            )}
            {trace.totalCost !== null && trace.totalCost > 0 && (
              <span>Cost: {usdFormatter(trace.totalCost)}</span>
            )}
            {trace.totalTokens > 0 && (
              <span>
                Tokens: {trace.promptTokens} → {trace.completionTokens} (∑{" "}
                {formatTokens(trace.totalTokens)})
              </span>
            )}
          </div>

          <div className="mt-3 flex-1">
            <p className="mb-1 text-xs font-bold">Scores</p>
            {trace.scores.length > 0 ? (
              <div className="flex flex-wrap content-start items-start gap-1">
                {trace.scores.map((score) => (
                  <ScoreBadge key={score.id} score={score} />
                ))}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </div>

          <Button asChild size="sm" variant="outline" className="mt-3 w-fit">
            <Link to={`/traces/${encodeURIComponent(trace.id)}`}>
              View trace
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function SessionDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>();

  const query = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => getSession(sessionId!),
    enabled: !!sessionId,
  });

  const session = query.data;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <Link
          to="/sessions"
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Sessions
        </Link>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">
              {sessionId}
            </h1>
            {session && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                Started {formatDateTime(session.createdAt)}
              </p>
            )}
          </div>
        </div>

        {session && (
          <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
            <Stat
              label="Duration"
              value={formatIntervalSeconds(session.sessionDuration)}
            />
            <Stat label="Traces" value={session.countTraces} />
            <Stat
              label="Total Cost"
              value={
                session.totalCost > 0 ? usdFormatter(session.totalCost) : "—"
              }
            />
            <Stat
              label="Users"
              value={
                session.users.length > 0 ? (
                  <span className="flex items-center gap-1">
                    <Users className="h-3.5 w-3.5 text-muted-foreground" />
                    {session.users.join(", ")}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <Stat
              label="Environment"
              value={
                session.environment ? (
                  <Badge
                    variant="secondary"
                    className="rounded-sm px-1 font-normal"
                  >
                    {session.environment}
                  </Badge>
                ) : (
                  "—"
                )
              }
            />
          </div>
        )}
      </div>

      {/* Trace cards */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {query.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-48 w-full" />
            ))}
          </div>
        ) : query.error ? (
          <ErrorState error={query.error} />
        ) : session && session.traces.length === 0 ? (
          <EmptyState message="No traces in this session." />
        ) : (
          <div className="space-y-3">
            {session?.traces.map((trace) => (
              <TraceCard key={trace.id} trace={trace} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
