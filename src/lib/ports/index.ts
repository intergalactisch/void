/**
 * Ports - Interfaces/Contracts
 *
 * The ports layer defines all interfaces (contracts) between the application
 * and the outside world. No implementations exist here - only interfaces.
 *
 * Structure:
 * - inbound/ - Application API (what the app exposes to UI, tests, CLI)
 * - outbound/ - Infrastructure needs (what the app needs from external systems)
 *
 * In Hexagonal Architecture:
 * - Inbound ports are implemented by Application Services
 * - Outbound ports are implemented by Secondary Adapters (Tauri, Memory, etc.)
 */

// Inbound ports (Application API)
export * from './inbound';

// Outbound ports (Infrastructure needs)
export * from './outbound';
