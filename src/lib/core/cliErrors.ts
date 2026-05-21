export const KEYLESS_CODEX_UNSUPPORTED_MESSAGE =
  'This Codex CLI version requires API-key authentication, which Void does not support. Install or log in to a keyless Codex CLI and try again.';

const API_KEY_GUIDANCE_PATTERNS = [
  /OPENAI_API_KEY/gi,
  /missing\s+openai\s+api\s+key/gi,
  /set\s+the\s+environment\s+variable\s+[A-Z0-9_]+/gi,
  /platform\.openai\.com\/account\/api-keys/gi,
  /api-keys/gi,
];

export function containsApiKeyGuidance(value: string): boolean {
  return API_KEY_GUIDANCE_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

export function sanitizeCLIErrorMessage(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value ?? '');
  if (containsApiKeyGuidance(text)) {
    return KEYLESS_CODEX_UNSUPPORTED_MESSAGE;
  }
  return text;
}
