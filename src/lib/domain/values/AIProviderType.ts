/**
 * AIProviderType - AI provider configuration types
 *
 * Defines the supported AI providers and their configuration structures.
 * The application is provider-agnostic - all providers implement the same port.
 *
 * Part of the Hexagonal Architecture domain layer.
 */

/**
 * Supported AI provider types.
 */
export type AIProviderType = 'claude' | 'openai' | 'gemini' | 'ollama' | 'mock';

/**
 * AI model identifier for each provider.
 */
export type AIModel = string;

/**
 * Base configuration shared by all providers.
 */
export interface BaseAIConfig {
  /** Whether this provider is enabled */
  enabled: boolean;
  /** Default model to use */
  defaultModel: AIModel;
  /** Maximum tokens for responses */
  maxTokens?: number;
  /** Temperature for response randomness (0-1) */
  temperature?: number;
}

/**
 * Claude (Anthropic) specific configuration.
 */
export interface ClaudeConfig extends BaseAIConfig {
  provider: 'claude';
  /** API key stored securely */
  apiKey?: string;
  /** Custom API endpoint (for proxies) */
  apiEndpoint?: string;
}

/**
 * OpenAI specific configuration.
 */
export interface OpenAIConfig extends BaseAIConfig {
  provider: 'openai';
  /** API key stored securely */
  apiKey?: string;
  /** Organization ID (optional) */
  organizationId?: string;
  /** Custom API endpoint (for Azure, proxies) */
  apiEndpoint?: string;
}

/**
 * Google Gemini specific configuration.
 */
export interface GeminiConfig extends BaseAIConfig {
  provider: 'gemini';
  /** API key stored securely */
  apiKey?: string;
}

/**
 * Ollama (local) specific configuration.
 */
export interface OllamaConfig extends BaseAIConfig {
  provider: 'ollama';
  /** Local server URL (default: http://localhost:11434) */
  serverUrl: string;
  /** Pull models automatically if not present */
  autoPull?: boolean;
}

/**
 * Mock provider for testing.
 */
export interface MockAIConfig extends BaseAIConfig {
  provider: 'mock';
  /** Simulated delay in ms */
  delay?: number;
  /** Simulate errors */
  simulateErrors?: boolean;
}

/**
 * Union of all provider configurations.
 */
export type AIProviderConfig =
  | ClaudeConfig
  | OpenAIConfig
  | GeminiConfig
  | OllamaConfig
  | MockAIConfig;

/**
 * Default configurations for each provider.
 */
export const DEFAULT_AI_CONFIGS: Record<AIProviderType, AIProviderConfig> = {
  claude: {
    provider: 'claude',
    enabled: false,
    defaultModel: 'claude-sonnet-4-20250514',
    maxTokens: 4096,
    temperature: 0.7,
  },
  openai: {
    provider: 'openai',
    enabled: false,
    defaultModel: 'gpt-4o',
    maxTokens: 4096,
    temperature: 0.7,
  },
  gemini: {
    provider: 'gemini',
    enabled: false,
    defaultModel: 'gemini-2.0-flash',
    maxTokens: 4096,
    temperature: 0.7,
  },
  ollama: {
    provider: 'ollama',
    enabled: false,
    defaultModel: 'llama3.2',
    serverUrl: 'http://localhost:11434',
    autoPull: true,
  },
  mock: {
    provider: 'mock',
    enabled: true,
    defaultModel: 'mock-model',
    delay: 500,
    simulateErrors: false,
  },
};

/**
 * Get the display name for a provider.
 */
export function getProviderDisplayName(provider: AIProviderType): string {
  const names: Record<AIProviderType, string> = {
    claude: 'Claude (Anthropic)',
    openai: 'OpenAI',
    gemini: 'Google Gemini',
    ollama: 'Ollama (Local)',
    mock: 'Mock (Testing)',
  };
  return names[provider];
}

/**
 * Check if a provider requires an API key.
 */
export function providerRequiresApiKey(provider: AIProviderType): boolean {
  return provider === 'claude' || provider === 'openai' || provider === 'gemini';
}

/**
 * Get available models for a provider (common ones).
 */
export function getProviderModels(provider: AIProviderType): AIModel[] {
  const models: Record<AIProviderType, AIModel[]> = {
    claude: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-5-haiku-20241022'],
    openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    gemini: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    ollama: ['llama3.2', 'llama3.1', 'mistral', 'codellama', 'phi3'],
    mock: ['mock-model'],
  };
  return models[provider];
}
