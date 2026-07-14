import { describe, expect, it } from 'vitest';

import { IMessageFormatConverter } from '../src/index.js';

describe('IMessageFormatConverter', () => {
  const converter = new IMessageFormatConverter();

  it('renders markdown as plain text', () => {
    expect(converter.renderPostable({ markdown: '**Hello** [there](https://example.com)' })).toBe(
      'Hello there',
    );
  });

  it('preserves raw text', () => {
    expect(converter.renderPostable({ raw: '**not markdown**' })).toBe('**not markdown**');
  });

  it('roundtrips plain text through an AST', () => {
    expect(converter.fromAst(converter.toAst('Hello world'))).toBe('Hello world');
  });
});
