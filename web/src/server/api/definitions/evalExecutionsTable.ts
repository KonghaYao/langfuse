import { type ColumnDefinition, JobExecutionStatus } from "@langfuse/shared";

// Lightweight check to avoid importing heavy server barrel into client bundle
const isLite = process.env.LANGFUSE_MODE === "lite";

export const evalExecutionsFilterCols: ColumnDefinition[] = [
  {
    name: "Status",
    id: "status",
    type: "stringOptions",
    internal: isLite ? 'je."status"' : 'je."status"::text',
    options: Object.values(JobExecutionStatus)
      .filter((value) => value !== JobExecutionStatus.CANCELLED)
      .map((value) => ({ value })),
  },
  {
    name: "Trace ID",
    id: "traceId",
    type: "string",
    internal: 'je."job_input_trace_id"',
  },
  {
    name: "Execution Trace ID",
    id: "executionTraceId",
    type: "string",
    internal: 'je."execution_trace_id"',
  },
];
