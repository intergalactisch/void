/**
 * Memory Adapters - In-memory implementations for testing
 *
 * These adapters implement the outbound ports using in-memory storage,
 * enabling testing without Tauri or other infrastructure dependencies.
 *
 * Part of the Hexagonal Architecture - Secondary Adapters layer.
 *
 * Usage:
 * ```typescript
 * import { MemoryFileSystemAdapter, MemorySettingsAdapter } from '$lib/adapters/memory';
 *
 * // In tests
 * const fs = new MemoryFileSystemAdapter();
 * fs.seed({ '/notes/test.md': '# Hello' });
 *
 * const service = new FileServiceImpl(fs);
 * ```
 */

export { MemoryFileSystemAdapter } from './MemoryFileSystemAdapter';
export { MemoryFolderAccessAdapter } from './MemoryFolderAccessAdapter';
export { MemoryPlatformCapabilitiesAdapter } from './MemoryPlatformCapabilitiesAdapter';
export { MemoryNotificationAdapter } from './MemoryNotificationAdapter';
export { MemoryShareIntentAdapter } from './MemoryShareIntentAdapter';
export { MemoryPeerDiscoveryAdapter } from './MemoryPeerDiscoveryAdapter';
export { MemoryPeerTransportAdapter } from './MemoryPeerTransportAdapter';
export { MemoryDeviceTrustAdapter } from './MemoryDeviceTrustAdapter';
export { MemoryAIJobExecutorAdapter } from './MemoryAIJobExecutorAdapter';
export { MemorySettingsAdapter } from './MemorySettingsAdapter';
export { MemoryCredentialAdapter } from './MemoryCredentialAdapter';
export { MemoryCryptoAdapter } from './MemoryCryptoAdapter';
export { MemoryKeyCustodyAdapter } from './MemoryKeyCustodyAdapter';
export { MemoryGitRepositoryAdapter } from './MemoryGitRepositoryAdapter';
export { MemoryGitHubAdapter } from './MemoryGitHubAdapter';
export { MemoryUpdaterAdapter } from './MemoryUpdaterAdapter';
export { MemoryConversationAdapter, createMemoryConversationAdapter } from './MemoryConversationAdapter';
export { MemoryLoggerAdapter } from './MemoryLoggerAdapter';
export { MemoryOperationStorageAdapter } from './MemoryOperationStorageAdapter';
export { MemoryVoidStorageAdapter } from './MemoryVoidStorageAdapter';
export { MemoryLineageStorageAdapter } from './MemoryLineageStorageAdapter';
export { MemoryExternalNavigationAdapter } from './MemoryExternalNavigationAdapter';
export { MemoryAgentRunStorageAdapter } from './MemoryAgentRunStorageAdapter';
export { MemorySessionStorageAdapter } from './MemorySessionStorageAdapter';
export { MemoryResearchSourceAdapter } from './MemoryResearchSourceAdapter';
export { MemoryMediaSourceAdapter } from './MemoryMediaSourceAdapter';
export { MemoryWebFetchAdapter } from './MemoryWebFetchAdapter';
