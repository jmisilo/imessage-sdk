import { Option } from 'clipanion';

import type { ProviderPurpose } from '../providers.js';
import type { ResolvedClient } from '../runtime.js';
import { withResolvedClient } from '../runtime.js';
import { ProviderOptionsCommand } from './provider-options-command.js';

export abstract class ClientCommand extends ProviderOptionsCommand {
  connection = Option.String('--connection', {
    description: 'Use an exact saved connection; its provider is inferred.',
  });

  protected async withClient<T>(
    purpose: ProviderPurpose,
    operation: (resolved: ResolvedClient) => Promise<T>,
  ): Promise<T> {
    const config = await this.configStore().load();
    return await withResolvedClient(
      this.context,
      config,
      {
        ...(this.provider === undefined ? {} : { provider: this.provider }),
        ...(this.connection === undefined ? {} : { connection: this.connection }),
        overrides: this.providerOverrides(),
        purpose,
        allowPrompt: this.promptsAllowed(),
      },
      operation,
      (_error, resolved) => {
        this.output().diagnostic(
          `Warning: ${resolved.providerName} resources did not close cleanly; the command result is unchanged.`,
        );
      },
    );
  }
}
