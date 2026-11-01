import { err, ok, type Result } from './result';

/** Serialize close requests, allowing Quit to supersede a pending window hide. */
export function createCloseCoordinator(actions: {
  prepare: () => Promise<Result<void, Error>>;
  hide: () => Promise<void>;
  quit: () => Promise<void>;
}) {
  let pending: Promise<Result<void, Error>> | null = null;
  let quitRequested = false;
  return (quit = false): Promise<Result<void, Error>> => {
    quitRequested ||= quit;
    if (pending) return pending;
    pending = Promise.resolve().then(async () => {
      try {
        const prepared = await actions.prepare();
        if (!prepared.ok) return prepared;
        if (quitRequested) await actions.quit();
        else {
          await actions.hide();
          if (quitRequested) await actions.quit();
        }
        return ok(undefined);
      } catch (cause) {
        return err(cause instanceof Error ? cause : new Error(String(cause)));
      }
    }).finally(() => { pending = null; quitRequested = false; });
    return pending;
  };
}
