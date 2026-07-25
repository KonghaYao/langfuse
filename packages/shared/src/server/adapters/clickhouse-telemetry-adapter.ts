/**
 * ClickHouse telemetry adapter – wraps the existing ClickHouse query functions
 * to conform to the TelemetryDBAdapter interface.
 *
 * This is the "full mode" adapter. It delegates entirely to the existing
 * `queryClickhouse`, `commandClickhouse`, `queryClickhouseStream`, and
 * `clickhouseClient().insert()` implementations.
 */

import {
  type TelemetryDBAdapter,
  type TelemetryInsertOpts,
  type TelemetryQueryOpts,
} from "./types";
import {
  queryClickhouse,
  commandClickhouse,
  queryClickhouseStream,
} from "../repositories/clickhouse";
import { clickhouseClient, convertDateToClickhouseDateTime } from "../clickhouse/client";

export class ClickHouseTelemetryAdapter implements TelemetryDBAdapter {
  async query<T = Record<string, unknown>>(
    opts: TelemetryQueryOpts,
  ): Promise<T[]> {
    return queryClickhouse<T>({
      query: opts.query,
      params: opts.params,
      tags: opts.tags,
      ...(opts.timeoutMs ? { request_timeout: opts.timeoutMs } : {}),
    });
  }

  async command(opts: TelemetryQueryOpts): Promise<void> {
    return commandClickhouse({
      query: opts.query,
      params: opts.params,
      tags: opts.tags,
    });
  }

  async insert<T = Record<string, unknown>>(
    opts: TelemetryInsertOpts<T>,
  ): Promise<void> {
    await clickhouseClient().insert({
      table: opts.table,
      values: opts.records.map((record) => ({
        ...(record as Record<string, unknown>),
        event_ts: convertDateToClickhouseDateTime(new Date()),
      })),
      format: "JSONEachRow",
    });
  }

  async *queryStream<T = Record<string, unknown>>(
    opts: TelemetryQueryOpts,
  ): AsyncGenerator<T> {
    yield* queryClickhouseStream<T>({
      query: opts.query,
      params: opts.params,
      tags: opts.tags,
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      await clickhouseClient().ping();
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    // ClickHouse client connections are managed by the ClickHouseClientManager
    // singleton. We don't close them here as other code may still reference them.
  }
}
