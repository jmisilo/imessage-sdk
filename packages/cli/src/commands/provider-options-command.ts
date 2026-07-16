import { Option } from 'clipanion';

import type { ProviderOverrides } from '../runtime.js';
import { CliUsageError } from '../errors.js';
import { BaseCommand } from './base-command.js';

export abstract class ProviderOptionsCommand extends BaseCommand {
  provider = Option.String('--provider', {
    description: 'Use Blooio, Photon, or Sendblue (and its configured default connection).',
  });

  noInput = Option.Boolean('--no-input', false, {
    description: 'Never prompt for missing credentials or settings.',
  });

  apiKey = Option.String('--api-key', { description: 'One-time Blooio or Sendblue API key.' });
  apiSecret = Option.String('--api-secret', { description: 'One-time Sendblue API secret.' });
  projectId = Option.String('--project-id', { description: 'One-time Photon project ID.' });
  projectSecret = Option.String('--project-secret', {
    description: 'One-time Photon project secret.',
  });
  fromNumber = Option.String('--from-number', {
    description: 'One-time Blooio sender or Sendblue from number.',
  });
  phoneNumber = Option.String('--phone-number', {
    description: 'One-time Photon phone-number selector.',
  });
  webhookSecret = Option.String('--webhook-secret', {
    description: 'One-time provider webhook verification secret.',
  });
  timeout = Option.String('--timeout', { description: 'One-time Photon timeout in milliseconds.' });
  retry = Option.Boolean('--retry', { description: 'Enable or disable Photon transport retries.' });
  markReadEnabled = Option.Boolean('--mark-read-enabled', {
    description: 'Enable Sendblue manual mark-read support for this invocation.',
  });

  protected providerOverrides(): ProviderOverrides {
    let timeout: number | undefined;
    if (this.timeout !== undefined) {
      timeout = Number(this.timeout);
      if (!Number.isFinite(timeout) || timeout <= 0) {
        throw new CliUsageError('--timeout must be a positive number.');
      }
    }
    return {
      ...(this.apiKey === undefined ? {} : { apiKey: this.apiKey }),
      ...(this.apiSecret === undefined ? {} : { apiSecret: this.apiSecret }),
      ...(this.projectId === undefined ? {} : { projectId: this.projectId }),
      ...(this.projectSecret === undefined ? {} : { projectSecret: this.projectSecret }),
      ...(this.fromNumber === undefined ? {} : { fromNumber: this.fromNumber }),
      ...(this.phoneNumber === undefined ? {} : { phoneNumber: this.phoneNumber }),
      ...(this.webhookSecret === undefined ? {} : { webhookSecret: this.webhookSecret }),
      ...(timeout === undefined ? {} : { timeout }),
      ...(this.retry === undefined ? {} : { retry: this.retry }),
      ...(this.markReadEnabled === undefined ? {} : { markReadEnabled: this.markReadEnabled }),
    };
  }

  protected promptsAllowed(): boolean {
    const stdin = this.context.stdin as NodeJS.ReadStream;
    return !this.noInput && !this.json && stdin.isTTY === true;
  }
}
