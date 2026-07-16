import type { BaseContext } from 'clipanion';

import { confirm, input, password } from '@inquirer/prompts';

import type { CredentialStore } from './credentials.js';
import { ConfigStore, getDefaultConfigPath } from './config.js';
import { SystemCredentialStore } from './credentials.js';

export interface PromptService {
  text(message: string, options?: { readonly default?: string }): Promise<string>;
  secret(message: string): Promise<string>;
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
}

export interface CliContext extends BaseContext {
  readonly configStore: ConfigStore;
  readonly credentialStore: CredentialStore;
  readonly prompt: PromptService;
  readonly cwd: string;
}

function defaultPromptService(
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
): PromptService {
  const promptContext = { input: stdin, output: stdout, clearPromptOnDone: true };
  return {
    async text(message, options = {}) {
      return await input(
        {
          message,
          ...(options.default === undefined ? {} : { default: options.default }),
        },
        promptContext,
      );
    },
    async secret(message) {
      return await password({ message, mask: true }, promptContext);
    },
    async confirm(message, defaultValue = false) {
      return await confirm({ message, default: defaultValue }, promptContext);
    },
  };
}

export function createDefaultContext(): CliContext {
  const stdin = process.stdin;
  const stdout = process.stdout;
  return {
    env: process.env,
    stdin,
    stdout,
    stderr: process.stderr,
    colorDepth: process.env['NO_COLOR'] === undefined && stdout.isTTY ? stdout.getColorDepth() : 1,
    configStore: new ConfigStore(getDefaultConfigPath({ env: process.env })),
    credentialStore: new SystemCredentialStore(),
    prompt: defaultPromptService(stdin, process.stderr),
    cwd: process.cwd(),
  };
}
