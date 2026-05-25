import type { PlatformCapabilities } from '$lib/domain/values';

export interface PlatformCapabilitiesPort {
  current(): PlatformCapabilities;
}
