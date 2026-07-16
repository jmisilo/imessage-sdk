import { Command } from 'clipanion';

import type { CliContext } from '../context.js';

export class DefaultCommand extends Command<CliContext> {
  static override paths = [Command.Default];

  async execute(): Promise<void> {
    this.context.stdout.write(this.cli.usage(null, { detailed: false }));
  }
}
