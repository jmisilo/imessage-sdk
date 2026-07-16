import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { Option } from 'clipanion';

import { CliUsageError } from '../errors.js';
import { ClientCommand } from './client-command.js';

export class AttachmentDownloadCommand extends ClientCommand {
  static override paths = [['attachment', 'download']];
  static override usage = AttachmentDownloadCommand.Usage({
    category: 'Attachments',
    description: 'Download one provider-native inbound attachment.',
  });

  attachmentId = Option.String({ name: 'attachmentId' });
  outputPath = Option.String('--output', { required: true });

  async execute(): Promise<number> {
    return await this.action('attachment.download', async () => {
      if (this.outputPath === '-' && this.json) {
        throw new CliUsageError('--json cannot be combined with binary --output -.');
      }

      await this.withClient('api', async ({ client, providerName, connectionId }) => {
        const data = await client.attachments.download(this.attachmentId);
        if (this.outputPath === '-') {
          this.context.stdout.write(data);
          return;
        }
        await mkdir(dirname(this.outputPath), { recursive: true });
        await writeFile(this.outputPath, data);
        this.output().success(
          'attachment.download',
          { attachmentId: this.attachmentId, path: this.outputPath, byteLength: data.byteLength },
          { provider: providerName, connectionId },
        );
      });
    });
  }
}
