import { Option } from 'clipanion';

import { CliUsageError } from '../errors.js';
import { BaseCommand } from './base-command.js';

const COMMANDS = [
  'send',
  'message get',
  'conversation open',
  'conversation get',
  'conversation mark-read',
  'attachment download',
  'reaction add',
  'reaction remove',
  'typing start',
  'typing stop',
  'webhook serve',
  'provider list',
  'provider show',
  'connection add',
  'connection list',
  'connection show',
  'connection doctor',
  'connection remove',
  'config init',
  'config validate',
  'config path',
  'schema',
] as const;

function bashCompletion(): string {
  const topLevel = [...new Set(COMMANDS.map((command) => command.split(' ')[0]))].join(' ');
  return `_imessage_cli_complete() {
  local current="\${COMP_WORDS[COMP_CWORD]}"
  COMPREPLY=( $(compgen -W "${topLevel}" -- "$current") )
}
complete -F _imessage_cli_complete imessage-cli`;
}

function zshCompletion(): string {
  const topLevel = [...new Set(COMMANDS.map((command) => command.split(' ')[0]))];
  return `#compdef imessage-cli
_arguments '1:command:(${topLevel.join(' ')})' '*::argument:->args'`;
}

function fishCompletion(): string {
  return [
    'complete -c imessage-cli -f',
    ...[...new Set(COMMANDS.map((command) => command.split(' ')[0]))].map(
      (command) => `complete -c imessage-cli -n '__fish_use_subcommand' -a '${command}'`,
    ),
  ].join('\n');
}

function powershellCompletion(): string {
  const commands = [...new Set(COMMANDS.map((command) => command.split(' ')[0]))]
    .map((command) => `'${command}'`)
    .join(', ');
  return `Register-ArgumentCompleter -Native -CommandName imessage-cli -ScriptBlock {
  param($wordToComplete)
  ${commands} | Where-Object { $_ -like "$wordToComplete*" }
}`;
}

export class CompletionCommand extends BaseCommand {
  static override paths = [['completion']];
  static override usage = CompletionCommand.Usage({
    category: 'Automation',
    description: 'Generate basic shell completion for top-level commands.',
  });

  shell = Option.String({ name: 'shell' });

  async execute(): Promise<number> {
    return await this.action('completion', async () => {
      if (this.json) throw new CliUsageError('--json is not supported for shell completion.');
      switch (this.shell) {
        case 'bash':
          this.context.stdout.write(`${bashCompletion()}\n`);
          return;
        case 'zsh':
          this.context.stdout.write(`${zshCompletion()}\n`);
          return;
        case 'fish':
          this.context.stdout.write(`${fishCompletion()}\n`);
          return;
        case 'powershell':
          this.context.stdout.write(`${powershellCompletion()}\n`);
          return;
        default:
          throw new CliUsageError('Expected bash, zsh, fish, or powershell.');
      }
    });
  }
}
