import { Option } from 'clipanion';

import { CliUsageError } from '../errors.js';
import { BaseCommand } from './base-command.js';
import { SendCommandInputJsonSchema } from './send.js';

const SCHEMAS = {
  send: SendCommandInputJsonSchema,
} as const;

export class SchemaCommand extends BaseCommand {
  static override paths = [['schema']];
  static override usage = SchemaCommand.Usage({
    category: 'Automation',
    description: 'Print discoverable JSON Schemas for agent-facing command input.',
  });

  commandName = Option.String({ name: 'command', required: false });

  async execute(): Promise<number> {
    return await this.action('schema', async () => {
      if (this.commandName === undefined) {
        this.output().success('schema', { commands: Object.keys(SCHEMAS) });
        return;
      }
      if (!(this.commandName in SCHEMAS)) {
        throw new CliUsageError(`No input schema is available for ${this.commandName}.`);
      }
      this.output().success('schema', SCHEMAS[this.commandName as keyof typeof SCHEMAS]);
    });
  }
}
