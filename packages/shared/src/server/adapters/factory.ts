/**
 * Adapter Factory – selects the appropriate adapter implementation based on
 * the `LANGFUSE_MODE` environment variable.
 *
 * - `LANGFUSE_MODE=full` (default): uses ClickHouse, Redis/BullMQ, S3
 * - `LANGFUSE_MODE=lite`: uses SQLite, in-memory queues, local filesystem
 */

import {
  type CacheAdapter,
  type LangfuseMode,
  type QueueAdapter,
  type StorageAdapter,
  type TelemetryDBAdapter,
} from "./types";
import { env } from "../../env";
import { ClickHouseTelemetryAdapter } from "./clickhouse-telemetry-adapter";
import { SQLiteTelemetryAdapter } from "./sqlite-telemetry-adapter";
import { BullMQQueueAdapter } from "./bullmq-queue-adapter";
import { InMemoryQueueAdapter } from "./in-memory-queue-adapter";
import { RedisCacheAdapter } from "./redis-cache-adapter";
import { InMemoryCacheAdapter } from "./in-memory-cache-adapter";
import { LocalStorageAdapter } from "./local-storage-adapter";

// ============================================================================
// Mode detection
// ============================================================================

let _mode: LangfuseMode | undefined;

/**
 * Returns the active Langfuse mode. Reads `LANGFUSE_MODE` env var once and
 * caches the result. Defaults to "full" for backward compatibility.
 */
export function getLangfuseMode(): LangfuseMode {
  if (_mode === undefined) {
    const raw = env.LANGFUSE_MODE;
    _mode = raw === "lite" ? "lite" : "full";
  }
  return _mode;
}

/** Returns true when running in lite (zero-dependency) mode. */
export function isLiteMode(): boolean {
  return getLangfuseMode() === "lite";
}

/** Returns true when running in full (production) mode. */
export function isFullMode(): boolean {
  return getLangfuseMode() === "full";
}

// ============================================================================
// Singleton adapter instances
// ============================================================================

let _telemetryDB: TelemetryDBAdapter | undefined;
let _queueAdapter: QueueAdapter | undefined;
let _cacheAdapter: CacheAdapter | undefined;
const _storageAdapters: Map<string, StorageAdapter> = new Map();

/**
 * Get the telemetry database adapter (ClickHouse in full mode, SQLite in lite).
 *
 * Adapters are lazily instantiated on first access.
 */
export function getTelemetryDB(): TelemetryDBAdapter {
  if (!_telemetryDB) {
    _telemetryDB = isLiteMode()
      ? new SQLiteTelemetryAdapter()
      : new ClickHouseTelemetryAdapter();
  }
  return _telemetryDB;
}

/**
 * Get the queue adapter (BullMQ/Redis in full mode, in-memory in lite).
 */
export function getQueueAdapter(): QueueAdapter {
  if (!_queueAdapter) {
    _queueAdapter = isLiteMode()
      ? new InMemoryQueueAdapter()
      : new BullMQQueueAdapter();
  }
  return _queueAdapter;
}

/**
 * Get the cache adapter (Redis in full mode, LRU in-memory in lite).
 */
export function getCacheAdapter(): CacheAdapter {
  if (!_cacheAdapter) {
    _cacheAdapter = isLiteMode()
      ? new InMemoryCacheAdapter()
      : new RedisCacheAdapter();
  }
  return _cacheAdapter;
}

/**
 * Get a storage adapter for the given bucket/purpose.
 *
 * @param bucket - Logical bucket name (e.g. "events", "media", "exports")
 * @param fullModeFactory - Factory function that creates the full-mode storage
 *   service (existing S3/Azure/GCS logic). Only called in full mode.
 */
export function getStorageAdapter(
  bucket: string,
  fullModeFactory?: () => StorageAdapter,
): StorageAdapter {
  const cacheKey = bucket;
  if (!_storageAdapters.has(cacheKey)) {
    if (isLiteMode()) {
      _storageAdapters.set(cacheKey, new LocalStorageAdapter(bucket));
    } else if (fullModeFactory) {
      _storageAdapters.set(cacheKey, fullModeFactory());
    } else {
      throw new Error(
        `No storage adapter factory provided for bucket "${bucket}" in full mode`,
      );
    }
  }
  return _storageAdapters.get(cacheKey)!;
}

// ============================================================================
// Lifecycle
// ============================================================================

/**
 * Gracefully shut down all active adapters. Call on process exit.
 */
export async function shutdownAdapters(): Promise<void> {
  const promises: Promise<void>[] = [];

  if (_telemetryDB) {
    promises.push(_telemetryDB.close());
    _telemetryDB = undefined;
  }
  if (_queueAdapter) {
    promises.push(_queueAdapter.close());
    _queueAdapter = undefined;
  }
  if (_cacheAdapter) {
    promises.push(_cacheAdapter.close());
    _cacheAdapter = undefined;
  }

  _storageAdapters.clear();

  await Promise.allSettled(promises);
}

/**
 * Reset all cached adapter instances. Primarily for testing.
 */
export function resetAdapters(): void {
  _telemetryDB = undefined;
  _queueAdapter = undefined;
  _cacheAdapter = undefined;
  _storageAdapters.clear();
  _mode = undefined;
}
