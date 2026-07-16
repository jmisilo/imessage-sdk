import { Option } from 'clipanion';

import { CliUsageError } from '../errors.js';
import { parseAddress } from '../input.js';
import { ClientCommand } from './client-command.js';

export class ConversationOpenCommand extends ClientCommand {
  static override paths = [['conversation', 'open']];
  static override usage = ConversationOpenCommand.Usage({
    category: 'Conversations',
    description: 'Open a direct or supported group conversation.',
  });

  participants = Option.Array('--participant', { required: true });

  async execute(): Promise<number> {
    return await this.action('conversation.open', async () => {
      await this.withClient('api', async ({ client, providerName, connectionId }) => {
        const addresses = this.participants.map(parseAddress);
        const first = addresses[0];
        if (first === undefined) throw new CliUsageError('Provide at least one --participant.');
        const conversation = await client.conversations.open({
          participants: [first, ...addresses.slice(1)],
        });
        this.output().success('conversation.open', conversation, {
          provider: providerName,
          connectionId,
        });
      });
    });
  }
}

export class ConversationGetCommand extends ClientCommand {
  static override paths = [['conversation', 'get']];
  static override usage = ConversationGetCommand.Usage({
    category: 'Conversations',
    description: 'Get one provider-native conversation.',
  });

  conversationId = Option.String({ name: 'conversationId' });

  async execute(): Promise<number> {
    return await this.action('conversation.get', async () => {
      await this.withClient('api', async ({ client, providerName, connectionId }) => {
        const conversation = await client.conversations.get(this.conversationId);
        this.output().success('conversation.get', conversation, {
          provider: providerName,
          connectionId,
        });
      });
    });
  }
}

export class ConversationMarkReadCommand extends ClientCommand {
  static override paths = [['conversation', 'mark-read']];
  static override usage = ConversationMarkReadCommand.Usage({
    category: 'Conversations',
    description: 'Mark a provider-native conversation as read.',
  });

  conversationId = Option.String({ name: 'conversationId' });

  async execute(): Promise<number> {
    return await this.action('conversation.mark-read', async () => {
      await this.withClient('api', async ({ client, providerName, connectionId }) => {
        await client.conversations.markRead(this.conversationId);
        this.output().success(
          'conversation.mark-read',
          { conversationId: this.conversationId, markedRead: true },
          { provider: providerName, connectionId },
        );
      });
    });
  }
}
