import { Option } from 'clipanion';

import { CliUsageError } from '../errors.js';
import { startWebhookServer } from '../webhook-server.js';
import { ClientCommand } from './client-command.js';

function waitForShutdown(): Promise<NodeJS.Signals> {
  return new Promise((resolve) => {
    const finish = (signal: NodeJS.Signals): void => {
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onTerminate);
      resolve(signal);
    };
    const onInterrupt = (): void => finish('SIGINT');
    const onTerminate = (): void => finish('SIGTERM');
    process.once('SIGINT', onInterrupt);
    process.once('SIGTERM', onTerminate);
  });
}

function exitCodeForSignal(signal: NodeJS.Signals): number {
  return signal === 'SIGINT' ? 130 : 143;
}

export class WebhookServeCommand extends ClientCommand {
  static override paths = [['webhook', 'serve']];
  static override usage = WebhookServeCommand.Usage({
    category: 'Webhooks',
    description: 'Serve and normalize signed provider webhooks on localhost.',
    details:
      'This development server does not create a public tunnel. Run ngrok or cloudflared separately and register its HTTPS origin plus the configured path with the provider.',
  });

  host = Option.String('--host', '127.0.0.1', {
    description: 'Local interface to bind. Use 0.0.0.0 only intentionally.',
  });
  port = Option.String('--port', '8787', { description: 'Local TCP port.' });
  webhookPath = Option.String('--path', '/webhooks', { description: 'Webhook URL path.' });
  healthPath = Option.String('--health-path', '/healthz', {
    description: 'Health-check URL path.',
  });
  maxBodyBytes = Option.String('--max-body-bytes', '1048576', {
    description: 'Maximum accepted webhook body size.',
  });
  experimental = Option.Boolean('--experimental', false, {
    description: 'Acknowledge that the CLI webhook server is experimental.',
  });

  async execute(): Promise<number> {
    return await this.action('webhook.serve', async () => {
      if (!this.experimental) {
        throw new CliUsageError(
          'The CLI webhook server is experimental. Re-run this command with --experimental.',
        );
      }

      const port = Number(this.port);
      const maxBodyBytes = Number(this.maxBodyBytes);
      if (!Number.isInteger(port) || port < 0 || port > 65_535) {
        throw new CliUsageError('--port must be an integer between 0 and 65535.');
      }
      if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0) {
        throw new CliUsageError('--max-body-bytes must be a positive safe integer.');
      }

      return await this.withClient('webhook', async ({ client, providerName, connectionId }) => {
        const server = await startWebhookServer({
          client,
          host: this.host,
          port,
          path: this.webhookPath,
          healthPath: this.healthPath,
          maxBodyBytes,
          onEvent: (event) => {
            this.output().success('webhook.event', event, { provider: providerName, connectionId });
          },
          onError: ({ statusCode, code }) => {
            this.output().diagnostic(`Webhook request rejected: ${statusCode} ${code}.`);
          },
        });
        this.output().diagnostic(`Listening for ${providerName} webhooks at ${server.address.url}`);
        this.output().diagnostic(
          `Expose this URL with an HTTPS tunnel and register <public-origin>${server.address.path}.`,
        );

        try {
          return exitCodeForSignal(await waitForShutdown());
        } finally {
          await server.close();
        }
      });
    });
  }
}
