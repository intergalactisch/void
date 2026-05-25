/**
 * Platform capability values.
 *
 * Pure contracts used by bootstrap and UI shells to select desktop, tablet, or
 * phone behaviours without leaking Tauri/browser details into application code.
 */

export type VoidPlatformKind = 'desktop' | 'ios' | 'android' | 'browser';
export type VoidFormFactor = 'desktop' | 'tablet' | 'phone';
export type WorkspaceStorageMode = 'managed' | 'external';
export type PreferredShell = 'desktop' | 'tablet' | 'mobile';

export interface PlatformCapabilities {
  platform: VoidPlatformKind;
  formFactor: VoidFormFactor;
  preferredShell: PreferredShell;
  isMobile: boolean;
  isDesktop: boolean;
  canRunLocalCli: boolean;
  canUseSystemGit: boolean;
  canUseGlobalShortcut: boolean;
  canUseTray: boolean;
  canUseUpdater: boolean;
  canAccessArbitraryFolders: boolean;
  canUseBiometrics: boolean;
  canUseShareSheet: boolean;
  canUseLocalNotifications: boolean;
  canUsePeerDiscovery: boolean;
  canUsePeerTransport: boolean;
  defaultWorkspaceStorage: WorkspaceStorageMode;
}

export const DESKTOP_PLATFORM_CAPABILITIES: PlatformCapabilities = {
  platform: 'desktop',
  formFactor: 'desktop',
  preferredShell: 'desktop',
  isMobile: false,
  isDesktop: true,
  canRunLocalCli: true,
  canUseSystemGit: false,
  canUseGlobalShortcut: true,
  canUseTray: true,
  canUseUpdater: true,
  canAccessArbitraryFolders: true,
  canUseBiometrics: false,
  canUseShareSheet: false,
  canUseLocalNotifications: true,
  canUsePeerDiscovery: true,
  canUsePeerTransport: true,
  defaultWorkspaceStorage: 'managed',
};

export const IOS_PLATFORM_CAPABILITIES: PlatformCapabilities = {
  platform: 'ios',
  formFactor: 'phone',
  preferredShell: 'mobile',
  isMobile: true,
  isDesktop: false,
  canRunLocalCli: false,
  canUseSystemGit: false,
  canUseGlobalShortcut: false,
  canUseTray: false,
  canUseUpdater: false,
  canAccessArbitraryFolders: false,
  canUseBiometrics: true,
  canUseShareSheet: true,
  canUseLocalNotifications: true,
  canUsePeerDiscovery: true,
  canUsePeerTransport: true,
  defaultWorkspaceStorage: 'managed',
};

export const ANDROID_PLATFORM_CAPABILITIES: PlatformCapabilities = {
  ...IOS_PLATFORM_CAPABILITIES,
  platform: 'android',
};

export const BROWSER_PLATFORM_CAPABILITIES: PlatformCapabilities = {
  ...DESKTOP_PLATFORM_CAPABILITIES,
  platform: 'browser',
  canRunLocalCli: false,
  canUseGlobalShortcut: false,
  canUseTray: false,
  canUseUpdater: false,
  canAccessArbitraryFolders: false,
};

export function capabilitiesForPlatform(
  platform: VoidPlatformKind,
  formFactor: VoidFormFactor = platform === 'desktop' || platform === 'browser' ? 'desktop' : 'phone',
): PlatformCapabilities {
  const base =
    platform === 'ios'
      ? IOS_PLATFORM_CAPABILITIES
      : platform === 'android'
        ? ANDROID_PLATFORM_CAPABILITIES
        : platform === 'browser'
          ? BROWSER_PLATFORM_CAPABILITIES
          : DESKTOP_PLATFORM_CAPABILITIES;

  return {
    ...base,
    formFactor,
    preferredShell: formFactor === 'phone' ? 'mobile' : formFactor === 'tablet' ? 'tablet' : 'desktop',
  };
}

export function inferFormFactor(width: number | null | undefined): VoidFormFactor {
  if (typeof width !== 'number' || !Number.isFinite(width)) return 'desktop';
  if (width < 640) return 'phone';
  if (width < 1100) return 'tablet';
  return 'desktop';
}

export function inferPlatformKind(userAgent: string): VoidPlatformKind {
  const value = userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(value)) return 'ios';
  if (/android/.test(value)) return 'android';
  return 'desktop';
}
