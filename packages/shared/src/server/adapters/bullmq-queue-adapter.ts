/**
 * BullMQ queue adapter – wraps the existing Redis/BullMQ infrastructure
 * to conform to the QueueAdapter interface.
 *
 * This is the "full mode" adapter. It delegates to the existing
 * `createBullMQQueueOptionsWithRedis` and BullMQ Queue/Worker classes.
 */

import { Queue, Worker } from "bullmq";
import {
  type QueueAdapter,
  type QueueInstance,
  type QueueJob,
  type QueueJobOptions,
  type QueueProcessor,
  type QueueWorkerOptions,
  type WorkerInstance,
} from "./types";
import {
  createBullMQQueueOptionsWithRedis,
  createBullMQWorkerOptionsWithRedis,
} from "../redis/redis";
import { logger } from "../logger";

// ============================================================================
// BullMQ Queue Wrapper
// ============================================================================

class BullMQQueueWrapper<T = unknown> implements QueueInstance<T> {
  constructor(private queue: Queue) {}

  async add(name: string, data: T, opts?: QueueJobOptions): Promise<QueueJob<T>> {
    const job = await this.queue.add(name, data, {
      attempts: opts?.attempts,
      backoff: opts?.backoff,
      delay: opts?.delay,
      priority: opts?.priority,
      removeOnComplete: opts?.removeOnComplete,
      removeOnFail: opts?.removeOnFail,
      jobId: opts?.jobId,
    });
    return {
      id: job.id ?? "",
      name: job.name,
      data: job.data as T,
      attemptsMade: job.attemptsMade,
      opts: opts ?? {},
      timestamp: job.timestamp,
    };
  }

  async addBulk(
    jobs: Array<{ name: string; data: T; opts?: QueueJobOptions }>,
  ): Promise<QueueJob<T>[]> {
    const bullJobs = await this.queue.addBulk(
      jobs.map((j) => ({
        name: j.name,
        data: j.data,
        opts: {
          attempts: j.opts?.attempts,
          backoff: j.opts?.backoff,
          delay: j.opts?.delay,
          priority: j.opts?.priority,
          removeOnComplete: j.opts?.removeOnComplete,
          removeOnFail: j.opts?.removeOnFail,
          jobId: j.opts?.jobId,
        },
      })),
    );
    return bullJobs.map((job, i) => ({
      id: job.id ?? "",
      name: job.name,
      data: job.data as T,
      attemptsMade: job.attemptsMade,
      opts: jobs[i]?.opts ?? {},
      timestamp: job.timestamp,
    }));
  }

  async getWaitingCount(): Promise<number> {
    return this.queue.getWaitingCount();
  }

  async getActiveCount(): Promise<number> {
    return this.queue.getActiveCount();
  }

  async getFailedCount(): Promise<number> {
    return this.queue.getFailedCount();
  }

  async drain(): Promise<void> {
    await this.queue.drain();
  }

  async close(): Promise<void> {
    await this.queue.close();
  }

  on(event: "error", handler: (error: Error) => void): void;
  on(event: "completed", handler: (job: QueueJob) => void): void;
  on(event: "failed", handler: (job: QueueJob, error: Error) => void): void;
  on(event: string, handler: (...args: never[]) => void): void {
    this.queue.on(event, handler);
  }
}

// ============================================================================
// BullMQ Worker Wrapper
// ============================================================================

class BullMQWorkerWrapper implements WorkerInstance {
  constructor(private worker: Worker) {}

  async close(): Promise<void> {
    await this.worker.close();
  }

  isRunning(): boolean {
    return this.worker.isRunning();
  }
}

// ============================================================================
// BullMQ Queue Adapter
// ============================================================================

export class BullMQQueueAdapter implements QueueAdapter {
  private queues: Map<string, BullMQQueueWrapper> = new Map();
  private workers: BullMQWorkerWrapper[] = [];

  getQueue<T = unknown>(
    name: string,
    defaultJobOptions?: QueueJobOptions,
  ): QueueInstance<T> | null {
    if (this.queues.has(name)) {
      return this.queues.get(name)! as unknown as QueueInstance<T>;
    }

    const queueOptions = createBullMQQueueOptionsWithRedis(name);
    if (!queueOptions) {
      logger.error(`[BullMQQueueAdapter] Failed to create Redis connection for queue: ${name}`);
      return null;
    }

    const queue = new Queue(name, {
      ...queueOptions,
      defaultJobOptions: {
        removeOnComplete: defaultJobOptions?.removeOnComplete ?? true,
        removeOnFail: defaultJobOptions?.removeOnFail ?? 100_000,
        attempts: defaultJobOptions?.attempts ?? 3,
        backoff: defaultJobOptions?.backoff ?? {
          type: "exponential",
          delay: 5000,
        },
      },
    });

    const wrapper = new BullMQQueueWrapper(queue);
    this.queues.set(name, wrapper);
    return wrapper as unknown as QueueInstance<T>;
  }

  createWorker<T = unknown>(
    name: string,
    processor: QueueProcessor<T>,
    opts?: QueueWorkerOptions,
  ): WorkerInstance | null {
    const workerOptions = createBullMQWorkerOptionsWithRedis(name);
    if (!workerOptions) {
      logger.error(`[BullMQQueueAdapter] Failed to create Redis connection for worker: ${name}`);
      return null;
    }

    const worker = new Worker(
      name,
      async (job) => {
        await processor({
          id: job.id ?? "",
          name: job.name,
          data: job.data as T,
          attemptsMade: job.attemptsMade,
          opts: {},
          timestamp: job.timestamp,
        });
      },
      {
        ...workerOptions,
        concurrency: opts?.concurrency ?? 1,
        limiter: opts?.limiter,
        lockDuration: opts?.lockDuration,
        stalledInterval: opts?.stalledInterval,
        maxStalledCount: opts?.maxStalledCount,
      },
    );

    const wrapper = new BullMQWorkerWrapper(worker);
    this.workers.push(wrapper);
    return wrapper;
  }

  async close(): Promise<void> {
    const queueCloses = Array.from(this.queues.values()).map((q) => q.close());
    const workerCloses = this.workers.map((w) => w.close());
    await Promise.allSettled([...queueCloses, ...workerCloses]);
    this.queues.clear();
    this.workers = [];
  }
}
