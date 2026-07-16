import { Option } from 'clipanion';
import { z } from 'zod';

import type { BlooioProvider } from '@imessage-sdk/blooio';
import type { PhotonProvider } from '@imessage-sdk/photon';
import type { SendblueProvider } from '@imessage-sdk/sendblue';
import type { IMessageReaction } from 'imessage-sdk';

import type { BuiltInProviderName } from '../providers.js';
import { CliUsageError } from '../errors.js';
import { BUILT_IN_PROVIDER_NAMES, providerRegistry } from '../providers.js';
import { isBuiltInProviderName } from '../runtime.js';
import { BaseCommand } from './base-command.js';
import { ClientCommand } from './client-command.js';

const ReactionSchema = z.enum(['love', 'like', 'dislike', 'laugh', 'emphasize', 'question']);

function fieldSummary(name: BuiltInProviderName): readonly object[] {
  return providerRegistry[name].fields.map((field) => ({
    key: field.key,
    label: field.label,
    kind: field.kind,
    ...(field.env === undefined ? {} : { environmentVariable: field.env }),
    requiredFor: field.requiredFor,
    description: field.description,
  }));
}

export class ProviderListCommand extends BaseCommand {
  static override paths = [['provider', 'list']];
  static override usage = ProviderListCommand.Usage({
    category: 'Providers',
    description: 'List every provider bundled with this CLI.',
  });

  async execute(): Promise<number> {
    return await this.action('provider.list', async () => {
      this.output().success(
        'provider.list',
        BUILT_IN_PROVIDER_NAMES.map((name) => ({
          name,
          displayName: providerRegistry[name].displayName,
          packageName: providerRegistry[name].packageName,
          description: providerRegistry[name].description,
        })),
      );
    });
  }
}

export class ProviderShowCommand extends BaseCommand {
  static override paths = [['provider', 'show']];
  static override usage = ProviderShowCommand.Usage({
    category: 'Providers',
    description: 'Show static capabilities and configuration fields for a provider.',
  });

  name = Option.String({ name: 'provider' });

  async execute(): Promise<number> {
    return await this.action('provider.show', async () => {
      if (!isBuiltInProviderName(this.name)) {
        throw new CliUsageError(`Unknown provider ${this.name}.`);
      }
      const definition = providerRegistry[this.name];
      this.output().success('provider.show', {
        name: definition.name,
        displayName: definition.displayName,
        packageName: definition.packageName,
        description: definition.description,
        capabilities: definition.capabilities,
        fields: fieldSummary(this.name),
      });
    });
  }
}

abstract class NamedProviderCommand extends ClientCommand {
  protected selectProvider(name: BuiltInProviderName): void {
    if (this.provider !== undefined && this.provider !== name) {
      throw new CliUsageError(`This command requires --provider ${name}.`);
    }
    this.provider = name;
  }
}

export class BlooioNumbersListCommand extends NamedProviderCommand {
  static override paths = [['provider', 'blooio', 'numbers', 'list']];
  static override usage = BlooioNumbersListCommand.Usage({
    category: 'Provider extensions',
    description: 'List numbers linked to the selected Blooio API key.',
  });

  async execute(): Promise<number> {
    return await this.action('provider.blooio.numbers.list', async () => {
      this.selectProvider('blooio');
      await this.withClient('api', async ({ provider, connectionId }) => {
        const numbers = await (provider as BlooioProvider).numbers.list();
        this.output().success('provider.blooio.numbers.list', numbers, {
          provider: 'blooio',
          connectionId,
        });
      });
    });
  }
}

abstract class MessageStatusCommand extends NamedProviderCommand {
  conversationId = Option.String('--conversation', { required: true });
  messageId = Option.String('--message', { required: true });
}

export class BlooioMessageStatusCommand extends MessageStatusCommand {
  static override paths = [['provider', 'blooio', 'message', 'status']];
  static override usage = BlooioMessageStatusCommand.Usage({
    category: 'Provider extensions',
    description: 'Get Blooio delivery status for one message.',
  });

  async execute(): Promise<number> {
    return await this.action('provider.blooio.message.status', async () => {
      this.selectProvider('blooio');
      await this.withClient('api', async ({ provider, connectionId }) => {
        const result = await (provider as BlooioProvider).messages.getStatus({
          conversationId: this.conversationId,
          messageId: this.messageId,
        });
        this.output().success('provider.blooio.message.status', result, {
          provider: 'blooio',
          connectionId,
        });
      });
    });
  }
}

export class PhotonLineShowCommand extends NamedProviderCommand {
  static override paths = [['provider', 'photon', 'line', 'show']];
  static override usage = PhotonLineShowCommand.Usage({
    category: 'Provider extensions',
    description: 'Resolve the Photon line selected by the current project configuration.',
  });

  async execute(): Promise<number> {
    return await this.action('provider.photon.line.show', async () => {
      this.selectProvider('photon');
      await this.withClient('api', async ({ provider, connectionId }) => {
        const line = await (provider as PhotonProvider).connection.getLine();
        this.output().success('provider.photon.line.show', line, {
          provider: 'photon',
          connectionId,
        });
      });
    });
  }
}

export class SendblueMessageStatusCommand extends MessageStatusCommand {
  static override paths = [['provider', 'sendblue', 'message', 'status']];
  static override usage = SendblueMessageStatusCommand.Usage({
    category: 'Provider extensions',
    description: 'Get Sendblue delivery status for one message.',
  });

  async execute(): Promise<number> {
    return await this.action('provider.sendblue.message.status', async () => {
      this.selectProvider('sendblue');
      await this.withClient('api', async ({ provider, connectionId }) => {
        const result = await (provider as SendblueProvider<boolean>).messages.getStatus({
          conversationId: this.conversationId,
          messageId: this.messageId,
        });
        this.output().success('provider.sendblue.message.status', result, {
          provider: 'sendblue',
          connectionId,
        });
      });
    });
  }
}

export class SendblueTapbackAddCommand extends NamedProviderCommand {
  static override paths = [['provider', 'sendblue', 'tapback', 'add']];
  static override usage = SendblueTapbackAddCommand.Usage({
    category: 'Provider extensions',
    description: 'Add a Sendblue tapback to an existing inbound iMessage.',
  });

  conversationId = Option.String('--conversation', { required: true });
  messageId = Option.String('--message', { required: true });
  reaction = Option.String('--reaction', { required: true });
  partIndex = Option.String('--part-index');

  async execute(): Promise<number> {
    return await this.action('provider.sendblue.tapback.add', async () => {
      this.selectProvider('sendblue');
      const parsed = ReactionSchema.safeParse(this.reaction);
      if (!parsed.success) throw new CliUsageError(`Unknown reaction ${this.reaction}.`);
      let partIndex: number | undefined;
      if (this.partIndex !== undefined) {
        partIndex = Number(this.partIndex);
        if (!Number.isInteger(partIndex) || partIndex < 0) {
          throw new CliUsageError('--part-index must be a non-negative integer.');
        }
      }
      await this.withClient('api', async ({ provider, connectionId }) => {
        await (provider as SendblueProvider<boolean>).tapbacks.add({
          conversationId: this.conversationId,
          messageId: this.messageId,
          reaction: parsed.data as IMessageReaction,
          ...(partIndex === undefined ? {} : { partIndex }),
        });
        this.output().success(
          'provider.sendblue.tapback.add',
          { messageId: this.messageId, reaction: parsed.data, added: true },
          { provider: 'sendblue', connectionId },
        );
      });
    });
  }
}
