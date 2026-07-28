import { Badge } from "@/components/ui/badge";

/**
 * Shared badge styling for observation type and level, used by the
 * observations list and the trace-detail tree.
 */

export function ObservationTypeBadge({ type }: { type: string }) {
  const variant =
    type === "GENERATION"
      ? "info"
      : type === "EVENT"
        ? "muted"
        : type === "SPAN"
          ? "secondary"
          : "outline";
  return <Badge variant={variant}>{type}</Badge>;
}

export function LevelBadge({ level }: { level: string | null }) {
  if (!level) return <span className="text-muted-foreground">—</span>;
  const variant =
    level === "ERROR"
      ? "error"
      : level === "WARNING"
        ? "warning"
        : level === "DEBUG"
          ? "muted"
          : "secondary";
  return <Badge variant={variant}>{level}</Badge>;
}
