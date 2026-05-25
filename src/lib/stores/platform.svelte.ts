import {
  DESKTOP_PLATFORM_CAPABILITIES,
  type PlatformCapabilities,
} from '$lib/domain/values';
import type { PlatformCapabilitiesPort } from '$lib/ports/outbound';

class PlatformStore {
  #port: PlatformCapabilitiesPort | null = null;
  capabilities = $state<PlatformCapabilities>(DESKTOP_PLATFORM_CAPABILITIES);

  init(port: PlatformCapabilitiesPort): void {
    this.#port = port;
    this.refresh();
  }

  refresh(): void {
    if (!this.#port) return;
    this.capabilities = this.#port.current();
  }

  get isMobileShell(): boolean {
    return this.capabilities.preferredShell === 'mobile';
  }

  get isTabletShell(): boolean {
    return this.capabilities.preferredShell === 'tablet';
  }
}

export const platformStore = new PlatformStore();
