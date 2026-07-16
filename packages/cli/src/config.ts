import { randomUUID } from 'node:crypto';
import { chmod, link, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { z } from 'zod';

import type { BuiltInProviderName } from './provider-names.js';
import { ConfigError } from './errors.js';
import { BUILT_IN_PROVIDER_NAMES } from './provider-names.js';

export { ConfigError } from './errors.js';

export type ProviderName = BuiltInProviderName;

export interface ConnectionConfig {
  readonly provider: ProviderName;
  readonly settings?: Readonly<Record<string, unknown>> | undefined;
}

export type DefaultConnections = Readonly<{
  readonly [TProvider in ProviderName]?: string | undefined;
}>;

export interface CliConfig {
  readonly version: 1;
  readonly connections: Readonly<Record<string, ConnectionConfig>>;
  readonly defaultConnections: DefaultConnections;
}

export interface ConfigPathOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly homeDirectory?: string;
  readonly platform?: NodeJS.Platform;
}

const ProviderNameSchema = z.enum(BUILT_IN_PROVIDER_NAMES);
const ConnectionNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    'Connection names may contain only letters, numbers, dots, underscores, and hyphens.',
  );

const ConnectionConfigSchema = z
  .object({
    provider: ProviderNameSchema,
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const DefaultConnectionsSchema = z
  .object({
    blooio: ConnectionNameSchema.optional(),
    photon: ConnectionNameSchema.optional(),
    sendblue: ConnectionNameSchema.optional(),
  })
  .strict()
  .default({});

export const CliConfigSchema: z.ZodType<CliConfig> = z
  .object({
    version: z.literal(1),
    connections: z.record(ConnectionNameSchema, ConnectionConfigSchema).default({}),
    defaultConnections: DefaultConnectionsSchema,
  })
  .strict()
  .superRefine((config, context) => {
    for (const provider of BUILT_IN_PROVIDER_NAMES) {
      const connectionName = config.defaultConnections[provider];
      if (connectionName === undefined) {
        continue;
      }

      const connection = config.connections[connectionName];
      if (connection === undefined) {
        context.addIssue({
          code: 'custom',
          message: `Default ${provider} connection ${JSON.stringify(connectionName)} does not exist.`,
          path: ['defaultConnections', provider],
        });
        continue;
      }

      if (connection.provider !== provider) {
        context.addIssue({
          code: 'custom',
          message: `Default ${provider} connection ${JSON.stringify(connectionName)} uses provider ${JSON.stringify(connection.provider)}.`,
          path: ['defaultConnections', provider],
        });
      }
    }
  });

export function createEmptyConfig(): CliConfig {
  return {
    version: 1,
    connections: {},
    defaultConnections: {},
  };
}

export function getDefaultConfigPath(options: ConfigPathOptions = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDirectory = options.homeDirectory ?? homedir();
  const xdgConfigHome = env['XDG_CONFIG_HOME'];

  if (xdgConfigHome !== undefined && xdgConfigHome.length > 0) {
    return join(xdgConfigHome, 'imessage-cli', 'config.json');
  }

  const appData = env['APPDATA'];
  if (platform === 'win32' && appData !== undefined && appData.length > 0) {
    return join(appData, 'imessage-cli', 'config.json');
  }

  return join(homeDirectory, '.config', 'imessage-cli', 'config.json');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

async function removeTemporaryFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      throw error;
    }
  }
}

export class ConfigStore {
  readonly path: string;

  constructor(path = getDefaultConfigPath()) {
    this.path = path;
  }

  async load(): Promise<CliConfig> {
    let contents: string;

    try {
      contents = await readFile(this.path, 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return createEmptyConfig();
      }

      throw new ConfigError(`Could not read CLI configuration from ${this.path}.`, {
        cause: error,
      });
    }

    let value: unknown;
    try {
      value = JSON.parse(contents) as unknown;
    } catch (error) {
      throw new ConfigError(`CLI configuration at ${this.path} is not valid JSON.`, {
        cause: error,
      });
    }

    const parsed = CliConfigSchema.safeParse(value);
    if (!parsed.success) {
      throw new ConfigError(
        `CLI configuration at ${this.path} is invalid.\n${z.prettifyError(parsed.error)}`,
        { cause: parsed.error },
      );
    }

    return parsed.data;
  }

  async create(config: CliConfig): Promise<void> {
    await this.write(config, false);
  }

  async save(config: CliConfig): Promise<void> {
    await this.write(config, true);
  }

  private async write(config: CliConfig, replace: boolean): Promise<void> {
    const parsed = CliConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new ConfigError(
        `Cannot save invalid CLI configuration.\n${z.prettifyError(parsed.error)}`,
        {
          cause: parsed.error,
        },
      );
    }

    let contents: string;
    try {
      contents = `${JSON.stringify(parsed.data, null, 2)}\n`;
    } catch (error) {
      throw new ConfigError('Cannot serialize CLI configuration.', { cause: error });
    }

    const directory = dirname(this.path);
    const temporaryPath = join(
      directory,
      `.${basename(this.path)}.${process.pid}.${randomUUID()}.tmp`,
    );

    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const createdDirectory = await mkdir(directory, { recursive: true, mode: 0o700 });
      if (createdDirectory !== undefined) {
        await chmod(directory, 0o700);
      }

      handle = await open(temporaryPath, 'wx', 0o600);
      await handle.writeFile(contents, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;

      await chmod(temporaryPath, 0o600);
      if (replace) {
        await rename(temporaryPath, this.path);
      } else {
        await link(temporaryPath, this.path);
        await removeTemporaryFile(temporaryPath);
      }
    } catch (error) {
      await handle?.close();
      await removeTemporaryFile(temporaryPath);
      if (!replace && isNodeError(error) && error.code === 'EEXIST') {
        throw new ConfigError(`Configuration already exists at ${this.path}.`, {
          cause: error,
        });
      }
      throw new ConfigError(`Could not save CLI configuration to ${this.path}.`, {
        cause: error,
      });
    }
  }
}
