import {
  capabilitiesForPlatform,
  type PlatformCapabilities,
  type VoidFormFactor,
  type VoidPlatformKind,
} from '$lib/domain/values';
import type { PlatformCapabilitiesPort } from '$lib/ports/outbound';

export class MemoryPlatformCapabilitiesAdapter implements PlatformCapabilitiesPort {
  private capabilities: PlatformCapabilities;

  constructor(platform: VoidPlatformKind = 'browser', formFactor: VoidFormFactor = 'desktop') {
    this.capabilities = capabilitiesForPlatform(platform, formFactor);
  }

  current(): PlatformCapabilities {
    return { ...this.capabilities };
  }

  set(capabilities: PlatformCapabilities): void {
    this.capabilities = { ...capabilities };
  }
}
