import { describe, expect, it } from 'vitest';

import { CliUsageError } from '../src/errors.js';
import { parseAddress, SendCliInputSchema } from '../src/input.js';

describe('CLI input validation', () => {
  it('accepts only HTTP(S) attachment URLs', () => {
    expect(
      SendCliInputSchema.safeParse({
        to: '+15555550100',
        attachments: [{ kind: 'file', source: { type: 'url', url: 'ftp://example.com/file' } }],
      }).success,
    ).toBe(false);
  });

  it('does not treat whitespace-only text as message content', () => {
    expect(SendCliInputSchema.safeParse({ to: '+15555550100', text: '   ' }).success).toBe(false);
  });

  it('rejects empty explicit address prefixes', () => {
    expect(() => parseAddress('phone:')).toThrow(CliUsageError);
    expect(() => parseAddress('email:   ')).toThrow(CliUsageError);
  });
});
