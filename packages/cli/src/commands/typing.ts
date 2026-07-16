import { Option } from 'clipanion';

import { ClientCommand } from './client-command.js';

abstract class TypingCommand extends ClientCommand {
  conversationId = Option.String({ name: 'conversationId' });
}

export class TypingStartCommand extends TypingCommand {
  static override paths = [['typing', 'start']];
  static override usage = TypingStartCommand.Usage({
    category: 'Interactions',
    description: 'Start the provider typing indicator.',
  });

  async execute(): Promise<number> {
    return await this.action('typing.start', async () => {
      await this.withClient('api', async ({ client, providerName, connectionId }) => {
        await client.typing.start(this.conversationId);
        this.output().success(
          'typing.start',
          { conversationId: this.conversationId, typing: true },
          { provider: providerName, connectionId },
        );
      });
    });
  }
}

export class TypingStopCommand extends TypingCommand {
  static override paths = [['typing', 'stop']];
  static override usage = TypingStopCommand.Usage({
    category: 'Interactions',
    description: 'Stop the provider typing indicator.',
  });

  async execute(): Promise<number> {
    return await this.action('typing.stop', async () => {
      await this.withClient('api', async ({ client, providerName, connectionId }) => {
        await client.typing.stop(this.conversationId);
        this.output().success(
          'typing.stop',
          { conversationId: this.conversationId, typing: false },
          { provider: providerName, connectionId },
        );
      });
    });
  }
}
