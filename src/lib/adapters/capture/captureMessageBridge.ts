/**
 * captureMessageBridge — listens for `void://capture-submit` events emitted
 * from the secondary capture window, runs `CaptureService.quickCapture`, and
 * emits a `void://capture-result` reply.
 *
 * Lives in the *main* window's bootstrap. The capture window is a thin UI
 * surface that does not own services itself — keeping a single source of
 * truth for the DI container, and letting the main window's notes refresh
 * naturally after a save.
 */

import { listen, emit, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  CaptureService,
  CaptureRequest,
} from '$lib/ports/inbound/CaptureService';
import { getLogger } from '$lib/logging';

const log = getLogger('CaptureMessageBridge');

const REQUEST_EVENT = 'void://capture-submit';
const RESULT_EVENT = 'void://capture-result';

interface ResultPayload {
  ok: boolean;
  path?: string;
  target?: 'inbox' | 'daily';
  created?: boolean;
  error?: string;
}

export interface CaptureMessageBridge {
  /** Tear down: unlistens the cross-window event handler. */
  dispose(): Promise<void>;
}

export async function attachCaptureMessageBridge(
  captureService: CaptureService,
): Promise<CaptureMessageBridge> {
  let unlisten: UnlistenFn | null = null;
  let disposed = false;
  let inflight = false;

  try {
    unlisten = await listen<CaptureRequest>(REQUEST_EVENT, async (event) => {
      // Reject duplicate submits while one is in flight (capture window's
      // own guard is the primary defense — this is belt-and-suspenders for
      // the cross-window race).
      if (inflight) {
        await emit(RESULT_EVENT, {
          ok: false,
          error: 'Another capture is in progress',
        } satisfies ResultPayload);
        return;
      }
      inflight = true;
      try {
        const result = await captureService.quickCapture(event.payload);
        if (result.ok) {
          await emit(RESULT_EVENT, {
            ok: true,
            path: result.value.path,
            target: result.value.target,
            created: result.value.created,
          } satisfies ResultPayload);
          // DocumentService.writeContent / createWithContent already emit
          // `document:saved` and refresh the notes list, so no extra
          // signalling is needed here.
          log.info('capture saved', { path: result.value.path, target: result.value.target });
        } else {
          await emit(RESULT_EVENT, {
            ok: false,
            error: result.error.message,
          } satisfies ResultPayload);
          log.warn('capture failed', { error: result.error.message });
        }
      } catch (err) {
        await emit(RESULT_EVENT, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        } satisfies ResultPayload);
        log.error('capture threw unexpectedly', { error: String(err) });
      } finally {
        inflight = false;
      }
    });
  } catch (err) {
    log.warn('failed to attach capture message bridge', { error: String(err) });
  }

  return {
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      try {
        unlisten?.();
      } catch (err) {
        log.warn('failed to unlisten capture bridge', { error: String(err) });
      }
    },
  };
}
