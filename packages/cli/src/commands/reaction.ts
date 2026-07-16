import { Option } from 'clipanion';
import { z } from 'zod';

import type { IMessageReaction } from 'imessage-sdk';

import { CliUsageError } from '../errors.js';
import { ClientCommand } from './client-command.js';

const ReactionSchema = z.enum(['love', 'like', 'dislike', 'laugh', 'emphasize', 'question']);

abstract class ReactionCommand extends ClientCommand {
  conversationId = Option.String('--conversation', { required: true });
  messageId = Option.String('--message', { required: true });
  reaction = Option.String('--reaction', { required: true });
  partIndex = Option.String('--part-index');

  protected input(): {
    readonly conversationId: string;
    readonly messageId: string;
    readonly reaction: IMessageReaction;
    readonly partIndex?: number;
  } {
    const reaction = ReactionSchema.safeParse(this.reaction);
    if (!reaction.success) {
      throw new CliUsageError(`Unknown reaction ${JSON.stringify(this.reaction)}.`);
    }
    let partIndex: number | undefined;
    if (this.partIndex !== undefined) {
      partIndex = Number(this.partIndex);
      if (!Number.isInteger(partIndex) || partIndex < 0) {
        throw new CliUsageError('--part-index must be a non-negative integer.');
      }
    }
    return {
      conversationId: this.conversationId,
      messageId: this.messageId,
      reaction: reaction.data,
      ...(partIndex === undefined ? {} : { partIndex }),
    };
  }
}

export class ReactionAddCommand extends ReactionCommand {
  static override paths = [['reaction', 'add']];
  static override usage = ReactionAddCommand.Usage({
    category: 'Interactions',
    description: 'Add a normalized reaction to a provider-native message.',
  });

  async execute(): Promise<number> {
    return await this.action('reaction.add', async () => {
      const input = this.input();
      await this.withClient('api', async ({ client, providerName, connectionId }) => {
        await client.reactions.add(input);
        this.output().success(
          'reaction.add',
          { ...input, added: true },
          { provider: providerName, connectionId },
        );
      });
    });
  }
}

export class ReactionRemoveCommand extends ReactionCommand {
  static override paths = [['reaction', 'remove']];
  static override usage = ReactionRemoveCommand.Usage({
    category: 'Interactions',
    description: 'Remove a normalized reaction from a provider-native message.',
  });

  async execute(): Promise<number> {
    return await this.action('reaction.remove', async () => {
      const input = this.input();
      await this.withClient('api', async ({ client, providerName, connectionId }) => {
        await client.reactions.remove(input);
        this.output().success(
          'reaction.remove',
          { ...input, removed: true },
          { provider: providerName, connectionId },
        );
      });
    });
  }
}
