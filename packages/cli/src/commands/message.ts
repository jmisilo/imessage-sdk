import { Option } from 'clipanion';

import { ClientCommand } from './client-command.js';

export class MessageGetCommand extends ClientCommand {
  static override paths = [['message', 'get']];
  static override usage = MessageGetCommand.Usage({
    category: 'Messages',
    description: 'Get one provider-native message.',
  });

  conversationId = Option.String('--conversation', { required: true });
  messageId = Option.String('--message', { required: true });

  async execute(): Promise<number> {
    return await this.action('message.get', async () => {
      await this.withClient('api', async ({ client, providerName, connectionId }) => {
        const message = await client.messages.get({
          conversationId: this.conversationId,
          messageId: this.messageId,
        });
        this.output().success('message.get', message, {
          provider: providerName,
          connectionId,
        });
      });
    });
  }
}
