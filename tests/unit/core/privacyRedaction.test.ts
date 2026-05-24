import { describe, expect, it } from 'vitest';
import { redactSensitiveText, redactSensitiveValue } from '$lib/core/privacyRedaction';

describe('privacyRedaction', () => {
  it('redacts env-style secrets from strings', () => {
    const redacted = redactSensitiveText('OPENAI_API_KEY=sk_test_abcdefghijklmnopqrstuvwxyz');

    expect(redacted).toContain('[redacted secret]');
    expect(redacted).not.toContain('sk_test_abcdefghijklmnopqrstuvwxyz');
  });

  it('aggressively redacts protected content fields', () => {
    const redacted = redactSensitiveValue(
      {
        selectedText: 'database password is hunter2',
        beforeText: 'left context',
        title: 'Visible title',
      },
      { aggressive: true },
    ) as Record<string, unknown>;

    expect(redacted.selectedText).toBe('[protected content redacted]');
    expect(redacted.beforeText).toBe('[protected content redacted]');
    expect(redacted.title).toBe('Visible title');
  });
});
