/**
 * Session detail — lite replica of web's session detail view, rendered as a
 * single merged observation tree: every trace in the session contributes its
 * observation subtree (rooted at the trace), with a divider between turns.
 * Mirrors the trace-detail page's left-hand tree, extended across a session.
 */
import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ListTree, Users } from "lucide-react";

import { getSession } from "@/lib/api";
import type { SessionTrace } from "@/lib/types";
import {
  formatDateTime,
  formatIntervalSeconds,
  usdFormatter,
} from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { buildTree, ObservationNode } from "@/components/observation-tree";
import { EmptyState, ErrorState } from "@/components/state";

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

/** Turn header: the trace that anchors each observation subtree. */
function TraceRootRow({ trace }: { trace: SessionTrace }) {
  return (
    <Link
      to={`/traces/${encodeURIComponent(trace.id)}`}
      className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent/50"
    >
      <ListTree className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" />
      <span className="truncate font-semibold">
        {trace.name ?? "(unnamed trace)"}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {formatDateTime(trace.timestamp)}
      </span>
      {trace.latency !== null && (
        <span className="ml-auto shrink-0 pl-2 font-mono text-[11px] text-muted-foreground">
          {formatIntervalSeconds(trace.latency)}
        </span>
      )}
    </Link>
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

  const trees = useMemo(
    () => (session?.traces ?? []).map((t) => buildTree(t.observations)),
    [session],
  );

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

      {/* Merged observation tree: one subtree per trace, dividers between */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {query.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : query.error ? (
          <ErrorState error={query.error} />
        ) : session && session.traces.length === 0 ? (
          <EmptyState message="No traces in this session." />
        ) : (
          <Card className="p-2">
            {session?.traces.map((trace, i) => (
              <div key={trace.id}>
                {i > 0 && <Separator className="my-2" />}
                <TraceRootRow trace={trace} />
                {(trees[i] ?? []).map((node) => (
                  <ObservationNode
                    key={node.observation.id}
                    node={node}
                    depth={1}
                  />
                ))}
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}
