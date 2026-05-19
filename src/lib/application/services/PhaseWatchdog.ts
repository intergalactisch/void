import type { DeepResearchPhase } from '$lib/domain/values/DeepResearchPhase';

export type PhaseTimeouts = Record<DeepResearchPhase, number>;

export const DEFAULT_PHASE_TIMEOUTS: PhaseTimeouts = {
  outline: 90_000,
  discover: 120_000,
  ingest: 300_000,
  synthesize: 240_000,
  overview: 90_000,
  sources: 30_000,
};

export async function withWatchdog<T>(
  phase: DeepResearchPhase,
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
  parentSignal: AbortSignal | undefined,
  onTimeout: () => Promise<void>
): Promise<T> {
  const ctrl = new AbortController();
  const onParentAbort = () => ctrl.abort(parentSignal?.reason ?? new Error('Cancelled'));
  if (parentSignal?.aborted) {
    onParentAbort();
  } else {
    parentSignal?.addEventListener('abort', onParentAbort);
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutMessage = `Phase "${phase}" timed out after ${timeoutMs}ms`;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort(new Error(timeoutMessage));
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });
  try {
    return await Promise.race([fn(ctrl.signal), timeoutPromise]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === timeoutMessage) {
      await onTimeout();
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}
