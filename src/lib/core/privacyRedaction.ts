const REDACTED_SECRET = '[redacted secret]';
const REDACTED_PROTECTED = '[protected content redacted]';

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(?:sk|rk|pk|org|ghp|github_pat|xox[baprs])_[A-Za-z0-9_=-]{16,}\b/g,
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  /^\s*(?:export\s+)?[A-Z][A-Z0-9_]{2,}\s*=\s*["']?[^"'\n#]{8,}["']?/gm,
];

const SENSITIVE_FIELD = /^(content|markdown|prompt|systemPrompt|response|chat|findings|concepts|artifactDrafts|transcript|before|after|beforeText|afterText|selectedText|surroundingText|diff|patch|text|result|summary|message|output|input|toolInvocations|activity|initialContext)$/i;

export interface RedactionOptions {
  aggressive?: boolean;
  redactionText?: string;
}

export function redactSensitiveText(value: string): string {
  let redacted = value;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, REDACTED_SECRET);
  }
  if (redacted.includes('void-protected-note')) {
    return REDACTED_PROTECTED;
  }
  return redacted;
}

export function redactSensitiveValue(
  value: unknown,
  options: RedactionOptions = {},
  key = '',
): unknown {
  if (typeof value === 'string') {
    const redacted = redactSensitiveText(value);
    if (options.aggressive && SENSITIVE_FIELD.test(key) && redacted.trim().length > 0) {
      return options.redactionText ?? REDACTED_PROTECTED;
    }
    return redacted;
  }

  if (value instanceof Date) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValue(item, options, key));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const out: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    out[childKey] = redactSensitiveValue(childValue, options, childKey);
  }
  return out;
}
