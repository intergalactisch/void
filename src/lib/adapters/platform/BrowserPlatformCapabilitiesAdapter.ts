import {
  capabilitiesForPlatform,
  inferFormFactor,
  inferPlatformKind,
  type PlatformCapabilities,
} from '$lib/domain/values';
import type { PlatformCapabilitiesPort } from '$lib/ports/outbound';

export class BrowserPlatformCapabilitiesAdapter implements PlatformCapabilitiesPort {
  current(): PlatformCapabilities {
    const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
    const width = typeof window === 'undefined' ? null : window.innerWidth;
    return capabilitiesForPlatform(inferPlatformKind(userAgent), inferFormFactor(width));
  }
}
