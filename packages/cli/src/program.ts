import { Builtins, Cli } from 'clipanion';

import type { CliContext } from './context.js';
import packageJson from '../package.json' with { type: 'json' };
import { AttachmentDownloadCommand } from './commands/attachment.js';
import { CompletionCommand } from './commands/completion.js';
import { ConfigInitCommand, ConfigPathCommand, ConfigValidateCommand } from './commands/config.js';
import {
  ConnectionAddCommand,
  ConnectionCredentialSetCommand,
  ConnectionDoctorCommand,
  ConnectionListCommand,
  ConnectionRemoveCommand,
  ConnectionShowCommand,
} from './commands/connection.js';
import {
  ConversationGetCommand,
  ConversationMarkReadCommand,
  ConversationOpenCommand,
} from './commands/conversation.js';
import { DefaultCommand } from './commands/default.js';
import { MessageGetCommand } from './commands/message.js';
import {
  BlooioMessageStatusCommand,
  BlooioNumbersListCommand,
  PhotonLineShowCommand,
  ProviderListCommand,
  ProviderShowCommand,
  SendblueMessageStatusCommand,
  SendblueTapbackAddCommand,
} from './commands/provider.js';
import { ReactionAddCommand, ReactionRemoveCommand } from './commands/reaction.js';
import { SchemaCommand } from './commands/schema.js';
import { SendCommand } from './commands/send.js';
import { TypingStartCommand, TypingStopCommand } from './commands/typing.js';
import { WebhookServeCommand } from './commands/webhook.js';
import { CliUsageError } from './errors.js';
import { CommandOutput } from './output.js';

const COMMANDS = [
  DefaultCommand,
  Builtins.HelpCommand,
  Builtins.VersionCommand,
  Builtins.DefinitionsCommand,
  SendCommand,
  MessageGetCommand,
  ConversationOpenCommand,
  ConversationGetCommand,
  ConversationMarkReadCommand,
  AttachmentDownloadCommand,
  ReactionAddCommand,
  ReactionRemoveCommand,
  TypingStartCommand,
  TypingStopCommand,
  WebhookServeCommand,
  ProviderListCommand,
  ProviderShowCommand,
  BlooioNumbersListCommand,
  BlooioMessageStatusCommand,
  PhotonLineShowCommand,
  SendblueMessageStatusCommand,
  SendblueTapbackAddCommand,
  ConnectionAddCommand,
  ConnectionListCommand,
  ConnectionShowCommand,
  ConnectionDoctorCommand,
  ConnectionRemoveCommand,
  ConnectionCredentialSetCommand,
  ConfigInitCommand,
  ConfigValidateCommand,
  ConfigPathCommand,
  SchemaCommand,
  CompletionCommand,
] as const;

export function createCli(): Cli<CliContext> {
  const cli = new Cli<CliContext>({
    binaryLabel: 'iMessage CLI',
    binaryName: 'imessage-cli',
    binaryVersion: packageJson.version,
    enableCapture: false,
  });
  for (const command of COMMANDS) cli.register(command);
  return cli;
}

export async function runCli(args: readonly string[], context: CliContext): Promise<number> {
  const cli = createCli();
  let command;
  try {
    command = cli.process([...args], context);
  } catch (error) {
    if (args.includes('--json')) {
      const message = error instanceof Error ? error.message : 'Could not parse the command.';
      new CommandOutput(context.stdout, context.stderr, true).failure(
        'cli',
        new CliUsageError(message),
      );
    } else {
      const colored = context.colorDepth > 1;
      context.stderr.write(cli.error(error, { colored }));
    }
    return 2;
  }
  return await cli.run(command, context);
}
