/**
 * Adapter layer – unified exports.
 *
 * Usage:
 * ```ts
 * import { getTelemetryDB, getQueueAdapter, isLiteMode } from "@langfuse/shared/src/server/adapters";
 * ```
 */

// Types
export type {
  LangfuseMode,
  TelemetryDBAdapter,
  TelemetryQueryOpts,
  TelemetryInsertOpts,
  QueueAdapter,
  QueueInstance,
  QueueJob,
  QueueJobOptions,
  QueueWorkerOptions,
  QueueProcessor,
  WorkerInstance,
  CacheAdapter,
  StorageAdapter,
} from "./types";

// Factory functions
export {
  getLangfuseMode,
  isLiteMode,
  isFullMode,
  getTelemetryDB,
  getQueueAdapter,
  getCacheAdapter,
  getStorageAdapter,
  shutdownAdapters,
  resetAdapters,
} from "./factory";

// Concrete implementations (for direct usage / testing)
export { ClickHouseTelemetryAdapter } from "./clickhouse-telemetry-adapter";
export { SQLiteTelemetryAdapter } from "./sqlite-telemetry-adapter";
export { BullMQQueueAdapter } from "./bullmq-queue-adapter";
export { InMemoryQueueAdapter } from "./in-memory-queue-adapter";
export { RedisCacheAdapter } from "./redis-cache-adapter";
export { InMemoryCacheAdapter } from "./in-memory-cache-adapter";
export { LocalStorageAdapter } from "./local-storage-adapter";
