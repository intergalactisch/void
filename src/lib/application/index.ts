/**
 * Application Layer - Use Cases and Orchestration
 *
 * The application layer contains service implementations that:
 * - Implement inbound port interfaces (what the app exposes to UI)
 * - Depend on outbound port interfaces (what the app needs from infrastructure)
 * - Contain use case logic and orchestration
 * - Are completely decoupled from infrastructure details
 *
 * In Hexagonal Architecture, this layer sits between the domain and
 * the adapters, coordinating the flow of data and operations.
 *
 * Part of Hexagonal Architecture application layer.
 */

export * from './services';
