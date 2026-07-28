import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronRight,
  CircleDot,
  Clock,
  Coins,
  Cpu,
  Layers,
  MoveHorizontal,
  Sparkles,
  Star,
  Zap,
} from "lucide-react";

import { getTrace } from "@/lib/api";
import type { Observation, Score, TraceWithDetails } from "@/lib/types";
import {
  formatCost,
  formatDateTime,
  formatDuration,
  formatLatency,
  formatTokens,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LevelBadge,
  ObservationTypeBadge,
} from "@/components/observation-badges";
import { JsonViewer } from "@/components/json-viewer";
import { ErrorState, LoadingRows } from "@/components/state";

// ---------------------------------------------------------------------------
// Observation tree construction
// ---------------------------------------------------------------------------

type TreeNode = {
  observation: Observation;
  children: TreeNode[];
};

/**
 * Builds a forest from the flat observation list using parentObservationId.
 * Children are sorted by startTime; observations whose parent is missing
 * (e.g. filtered out) are treated as roots.
 */
function buildTree(observations: Observation[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  for (const o of observations) {
    nodes.set(o.id, { observation: o, children: [] });
  }
  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.observation.parentObservationId;
    const parent = parentId ? nodes.get(parentId) : undefined;
    if (parent && parent !== node) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortRec = (list: TreeNode[]) => {
    list.sort((a, b) =>
      a.observation.startTime.localeCompare(b.observation.startTime),
    );
    for (const n of list) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

function typeIcon(type: string) {
  switch (type) {
    case "GENERATION":
      return Sparkles;
    case "SPAN":
      return MoveHorizontal;
    case "EVENT":
      return Zap;
    default:
      return CircleDot;
  }
}

function ObservationNode({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const { observation: o } = node;
  const Icon = typeIcon(o.type);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedId === o.id;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(o.id)}
        onKeyDown={(e) => e.key === "Enter" && onSelect(o.id)}
        className={cn(
          "group flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors",
          isSelected
            ? "bg-accent text-accent-foreground"
            : "hover:bg-accent/50",
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {hasChildren ? (
          <button
            className="shrink-0 rounded p-0.5 hover:bg-muted"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                expanded && "rotate-90",
              )}
            />
          </button>
        ) : (
          <span className="w-[18px] shrink-0" />
        )}
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">
          {o.name ?? <span className="text-muted-foreground">(unnamed)</span>}
        </span>
        <ObservationTypeBadge type={o.type} />
        {o.level && o.level !== "DEFAULT" && <LevelBadge level={o.level} />}
        <span className="ml-auto shrink-0 pl-2 font-mono text-[11px] text-muted-foreground">
          {formatDuration(o.startTime, o.endTime)}
        </span>
      </div>
      {expanded &&
        node.children.map((child) => (
          <ObservationNode
            key={child.observation.id}
            node={child}
            depth={depth + 1}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

function StatChip({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <div className="leading-tight">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="text-sm font-semibold">{value}</div>
      </div>
    </div>
  );
}

function ScoreList({ scores }: { scores: Score[] }) {
  if (scores.length === 0) {
    return <p className="text-sm text-muted-foreground">No scores.</p>;
  }
  return (
    <div className="space-y-2">
      {scores.map((s) => (
        <div
          key={s.id}
          className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
        >
          <div className="flex items-center gap-2">
            <Star className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">{s.name}</span>
            <Badge variant="muted">{s.source}</Badge>
          </div>
          <span className="font-mono">
            {s.stringValue ?? s.value?.toFixed(4) ?? "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

function IoTabs({
  input,
  output,
  metadata,
}: {
  input: unknown;
  output: unknown;
  metadata: unknown;
}) {
  return (
    <Tabs defaultValue="input">
      <TabsList>
        <TabsTrigger value="input">Input</TabsTrigger>
        <TabsTrigger value="output">Output</TabsTrigger>
        <TabsTrigger value="metadata">Metadata</TabsTrigger>
      </TabsList>
      <TabsContent value="input" className="mt-3">
        <JsonViewer data={input} />
      </TabsContent>
      <TabsContent value="output" className="mt-3">
        <JsonViewer data={output} />
      </TabsContent>
      <TabsContent value="metadata" className="mt-3">
        <JsonViewer data={metadata} />
      </TabsContent>
    </Tabs>
  );
}

function ObservationDetail({
  observation: o,
  scores,
}: {
  observation: Observation;
  scores: Score[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ObservationTypeBadge type={o.type} />
        <span className="text-base font-semibold">{o.name ?? "(unnamed)"}</span>
        <LevelBadge level={o.level} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StatChip
          icon={Clock}
          label="Duration"
          value={formatDuration(o.startTime, o.endTime)}
        />
        <StatChip
          icon={Coins}
          label="Cost"
          value={formatCost(o.calculatedTotalCost ?? null)}
        />
        <StatChip icon={Cpu} label="Model" value={o.model ?? "—"} />
        <StatChip
          icon={Layers}
          label="Tokens"
          value={
            o.totalTokens > 0
              ? `${formatTokens(o.promptTokens)} → ${formatTokens(o.completionTokens)} (${formatTokens(o.totalTokens)})`
              : "—"
          }
        />
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        <p>Start: {formatDateTime(o.startTime)}</p>
        <p>End: {formatDateTime(o.endTime)}</p>
        <p className="font-mono">ID: {o.id}</p>
        {o.statusMessage && <p>Status: {o.statusMessage}</p>}
      </div>

      <Separator />

      <IoTabs input={o.input} output={o.output} metadata={o.metadata} />

      {scores.length > 0 && (
        <>
          <Separator />
          <div>
            <h3 className="mb-2 text-sm font-semibold">Scores</h3>
            <ScoreList scores={scores} />
          </div>
        </>
      )}
    </div>
  );
}

function TraceDetailPanel({ trace }: { trace: TraceWithDetails }) {
  return (
    <div className="space-y-4">
      <div className="text-base font-semibold">Trace</div>
      <IoTabs
        input={trace.input}
        output={trace.output}
        metadata={trace.metadata}
      />
      <Separator />
      <div>
        <h3 className="mb-2 text-sm font-semibold">
          Scores ({trace.scores.length})
        </h3>
        <ScoreList scores={trace.scores} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function TraceDetailPage() {
  const { traceId } = useParams<{ traceId: string }>();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["trace", traceId],
    queryFn: () => getTrace(traceId!),
    enabled: Boolean(traceId),
  });

  const tree = useMemo(
    () => buildTree(query.data?.observations ?? []),
    [query.data],
  );

  if (query.isLoading) return <LoadingRows rows={12} />;
  if (query.error) return <ErrorState error={query.error} />;
  const trace = query.data;
  if (!trace) return null;

  const selected = selectedId
    ? (trace.observations.find((o) => o.id === selectedId) ?? null)
    : null;

  const totalTokens = trace.observations.reduce(
    (acc, o) => acc + (o.totalTokens || 0),
    0,
  );

  // Scores for the selected observation (trace-level scores shown on Trace).
  const selectedScores = selected
    ? trace.scores.filter((s) => s.observationId === selected.id)
    : [];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <Link
          to="/traces"
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to traces
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">
            {trace.name ?? "(unnamed trace)"}
          </h1>
          {trace.environment && (
            <Badge variant="muted">{trace.environment}</Badge>
          )}
          {trace.version && <Badge variant="outline">v: {trace.version}</Badge>}
          {trace.release && (
            <Badge variant="outline">rel: {trace.release}</Badge>
          )}
          {trace.tags.map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {formatDateTime(trace.timestamp)}
          {trace.userId ? ` · user: ${trace.userId}` : ""}
          {trace.sessionId ? ` · session: ${trace.sessionId}` : ""}
          <span className="ml-2 font-mono">{trace.id}</span>
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <StatChip
            icon={Clock}
            label="Latency"
            value={formatLatency(trace.latency)}
          />
          <StatChip
            icon={Coins}
            label="Cost"
            value={formatCost(trace.totalCost)}
          />
          <StatChip
            icon={Layers}
            label="Observations"
            value={String(trace.observations.length)}
          />
          <StatChip
            icon={Cpu}
            label="Tokens"
            value={formatTokens(totalTokens)}
          />
          <StatChip
            icon={Star}
            label="Scores"
            value={String(trace.scores.length)}
          />
        </div>
      </div>

      {/* Body: tree + detail */}
      <div className="flex min-h-0 flex-1">
        <Card className="m-4 mr-0 flex w-[45%] min-w-[320px] flex-col overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Observation tree</CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 p-2">
            <ScrollArea className="h-full">
              {/* Virtual root representing the trace itself */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => setSelectedId(null)}
                onKeyDown={(e) => e.key === "Enter" && setSelectedId(null)}
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm",
                  selectedId === null
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50",
                )}
              >
                <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-medium">
                  {trace.name ?? "trace root"}
                </span>
                <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                  {formatLatency(trace.latency)}
                </span>
              </div>
              {tree.map((node) => (
                <ObservationNode
                  key={node.observation.id}
                  node={node}
                  depth={1}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              ))}
              {tree.length === 0 && (
                <p className="px-2 py-4 text-sm text-muted-foreground">
                  No observations in this trace.
                </p>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="m-4 flex flex-1 flex-col overflow-hidden">
          <CardContent className="min-h-0 flex-1 overflow-y-auto p-4 pt-6">
            {selected ? (
              <ObservationDetail
                observation={selected}
                scores={selectedScores}
              />
            ) : (
              <TraceDetailPanel trace={trace} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
