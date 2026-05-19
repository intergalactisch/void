/**
 * Capture adapters — primary adapters bridging the OS-level global shortcut
 * and the secondary capture window to the rest of the app.
 */

export {
  TauriCaptureWindowManager,
  NoopCaptureWindowManager,
  chordToTauriAccelerator,
  type CaptureWindowManager,
} from './captureWindowManager';

export {
  attachCaptureMessageBridge,
  type CaptureMessageBridge,
} from './captureMessageBridge';
