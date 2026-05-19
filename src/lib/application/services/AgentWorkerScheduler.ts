/**
 * AgentWorkerScheduler - dependency-aware bounded worker concurrency.
 */

import type { AgentWorkerSpec } from '$lib/domain/entities/AgentRun';

export interface WorkerScheduleResult<TResult> {
  results: TResult[];
  failures: Array<{ workerId: string; error: Error }>;
  maxObservedConcurrency: number;
}

export class AgentWorkerScheduler {
  async run<TResult>(
    specs: AgentWorkerSpec[],
    maxConcurrency: number,
    worker: (spec: AgentWorkerSpec) => Promise<TResult>
  ): Promise<WorkerScheduleResult<TResult>> {
    const pending = new Map(specs.map((spec) => [spec.id, spec]));
    const completed = new Set<string>();
    const failed = new Set<string>();
    const active = new Map<string, Promise<{ spec: AgentWorkerSpec; result?: TResult; error?: Error }>>();
    const results: TResult[] = [];
    const failures: Array<{ workerId: string; error: Error }> = [];
    let maxObservedConcurrency = 0;
    const limit = Math.max(1, maxConcurrency);

    while (pending.size > 0 || active.size > 0) {
      const ready = [...pending.values()].filter((spec) =>
        spec.dependencies.every((dependency) => completed.has(dependency))
      );

      while (active.size < limit && ready.length > 0) {
        const spec = ready.shift()!;
        pending.delete(spec.id);
        const promise = worker(spec)
          .then((result) => ({ spec, result }))
          .catch((error: unknown) => ({
            spec,
            error: error instanceof Error ? error : new Error(String(error)),
          }));
        active.set(spec.id, promise);
        maxObservedConcurrency = Math.max(maxObservedConcurrency, active.size);
      }

      if (active.size === 0 && pending.size > 0) {
        const blocked = pending.values().next().value as AgentWorkerSpec;
        pending.delete(blocked.id);
        const error = new Error(`Worker ${blocked.id} is blocked by failed or missing dependencies`);
        failed.add(blocked.id);
        failures.push({ workerId: blocked.id, error });
        continue;
      }

      const settled = await Promise.race(active.values());
      active.delete(settled.spec.id);

      if (settled.error) {
        failed.add(settled.spec.id);
        failures.push({ workerId: settled.spec.id, error: settled.error });
        for (const spec of [...pending.values()]) {
          if (spec.dependencies.some((dependency) => failed.has(dependency))) {
            pending.delete(spec.id);
            failures.push({
              workerId: spec.id,
              error: new Error(`Worker ${spec.id} was blocked because a dependency failed`),
            });
            failed.add(spec.id);
          }
        }
      } else if (settled.result !== undefined) {
        completed.add(settled.spec.id);
        results.push(settled.result);
      }
    }

    return { results, failures, maxObservedConcurrency };
  }
}
