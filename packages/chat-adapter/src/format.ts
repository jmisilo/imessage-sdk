import type { AdapterPostableMessage, Root } from 'chat';

import { BaseFormatConverter, markdownToPlainText, parseMarkdown, stringifyMarkdown } from 'chat';

export class IMessageFormatConverter extends BaseFormatConverter {
  toAst(text: string): Root {
    return parseMarkdown(text);
  }

  fromAst(ast: Root): string {
    return markdownToPlainText(stringifyMarkdown(ast)).trim();
  }

  override renderPostable(message: AdapterPostableMessage): string {
    if (typeof message === 'string') return message;
    if ('raw' in message) return message.raw;
    if ('markdown' in message) return markdownToPlainText(message.markdown).trim();
    if ('ast' in message) return this.fromAst(message.ast);
    return markdownToPlainText(super.renderPostable(message)).trim();
  }
}
