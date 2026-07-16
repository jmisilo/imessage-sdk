import { Command, Option } from 'clipanion';

import type { CliContext } from '../context.js';
import { ConfigStore } from '../config.js';
import { exitCodeForError } from '../errors.js';
import { CommandOutput } from '../output.js';

export abstract class BaseCommand extends Command<CliContext> {
  json = Option.Boolean('--json', false, {
    description: 'Write one stable JSON object instead of human-readable output.',
  });

  configPath = Option.String('--config', {
    description: 'Use a specific imessage-cli configuration file.',
  });

  protected output(): CommandOutput {
    return new CommandOutput(this.context.stdout, this.context.stderr, this.json);
  }

  protected configStore(): ConfigStore {
    return this.configPath === undefined
      ? this.context.configStore
      : new ConfigStore(this.configPath);
  }

  protected async action(
    command: string,
    operation: () => Promise<number | void>,
  ): Promise<number> {
    try {
      return (await operation()) ?? 0;
    } catch (error) {
      this.output().failure(command, error);
      return exitCodeForError(error);
    }
  }
}
