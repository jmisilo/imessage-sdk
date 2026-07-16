import { Option } from 'clipanion';

import { createEmptyConfig } from '../config.js';
import { BaseCommand } from './base-command.js';

export class ConfigPathCommand extends BaseCommand {
  static override paths = [['config', 'path']];
  static override usage = ConfigPathCommand.Usage({
    category: 'Configuration',
    description: 'Print the active configuration path.',
  });

  async execute(): Promise<number> {
    return await this.action('config.path', async () => {
      this.output().success('config.path', this.configStore().path);
    });
  }
}

export class ConfigValidateCommand extends BaseCommand {
  static override paths = [['config', 'validate']];
  static override usage = ConfigValidateCommand.Usage({
    category: 'Configuration',
    description: 'Parse and validate the active configuration.',
  });

  async execute(): Promise<number> {
    return await this.action('config.validate', async () => {
      const store = this.configStore();
      const config = await store.load();
      this.output().success('config.validate', {
        path: store.path,
        valid: true,
        connectionCount: Object.keys(config.connections).length,
      });
    });
  }
}

export class ConfigInitCommand extends BaseCommand {
  static override paths = [['config', 'init']];
  static override usage = ConfigInitCommand.Usage({
    category: 'Configuration',
    description: 'Create an empty, user-only configuration file.',
  });

  force = Option.Boolean('--force', false, { description: 'Replace an existing configuration.' });

  async execute(): Promise<number> {
    return await this.action('config.init', async () => {
      const store = this.configStore();
      if (this.force) await store.save(createEmptyConfig());
      else await store.create(createEmptyConfig());
      this.output().success('config.init', { path: store.path, created: true });
    });
  }
}
