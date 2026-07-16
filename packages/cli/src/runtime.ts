import type { AnyIMessageProvider, IMessageClient } from 'imessage-sdk';
import { createIMessageClient, DEFAULT_CONNECTION_ID } from 'imessage-sdk';

import type { CliConfig, ConnectionConfig, ProviderName } from './config.js';
import type { CliContext } from './context.js';
import type { CredentialRef } from './credentials.js';
import type {
  BuiltInProviderName,
  ProviderDefinition,
  ProviderPurpose,
  ProviderValue,
  ProviderValues,
} from './providers.js';
import { CliUsageError, ConfigError } from './errors.js';
import { BUILT_IN_PROVIDER_NAMES, createProvider, providerRegistry } from './providers.js';

export interface ProviderOverrides {
  readonly apiKey?: string;
  readonly apiSecret?: string;
  readonly projectId?: string;
  readonly projectSecret?: string;
  readonly fromNumber?: string;
  readonly phoneNumber?: string;
  readonly webhookSecret?: string;
  readonly timeout?: number;
  readonly retry?: boolean;
  readonly markReadEnabled?: boolean;
}

export interface ClientSelection {
  readonly provider?: string;
  readonly connection?: string;
  readonly overrides?: ProviderOverrides;
  readonly purpose: ProviderPurpose;
  readonly allowPrompt: boolean;
}

export interface ResolvedClient {
  readonly client: IMessageClient<AnyIMessageProvider, string>;
  readonly provider: AnyIMessageProvider;
  readonly definition: ProviderDefinition;
  readonly providerName: BuiltInProviderName;
  readonly connectionName?: string;
  readonly connectionId: string;
  readonly values: ProviderValues;
}

export function isBuiltInProviderName(value: string): value is BuiltInProviderName {
  return (BUILT_IN_PROVIDER_NAMES as readonly string[]).includes(value);
}

function assertProviderName(value: string): BuiltInProviderName {
  if (!isBuiltInProviderName(value)) {
    throw new CliUsageError(
      `Unknown provider ${JSON.stringify(value)}. Expected one of: ${BUILT_IN_PROVIDER_NAMES.join(', ')}.`,
    );
  }
  return value;
}

function readConnection(config: CliConfig, name: string): ConnectionConfig {
  const connection = config.connections[name];
  if (connection === undefined) {
    throw new ConfigError(`Connection ${JSON.stringify(name)} does not exist.`);
  }
  return connection;
}

function resolveSelection(
  config: CliConfig,
  selection: ClientSelection,
): {
  readonly providerName: BuiltInProviderName;
  readonly connectionName?: string;
  readonly connection?: ConnectionConfig;
} {
  if (selection.connection !== undefined) {
    const connection = readConnection(config, selection.connection);
    const providerName = assertProviderName(connection.provider);
    if (selection.provider !== undefined && selection.provider !== providerName) {
      throw new CliUsageError(
        `Connection ${JSON.stringify(selection.connection)} uses ${providerName}, not ${selection.provider}.`,
      );
    }
    return { providerName, connectionName: selection.connection, connection };
  }

  if (selection.provider === undefined) {
    throw new CliUsageError('Provide --provider <name> or --connection <name>.');
  }

  const providerName = assertProviderName(selection.provider);
  const defaultConnection = config.defaultConnections[providerName];
  if (defaultConnection === undefined) return { providerName };
  return {
    providerName,
    connectionName: defaultConnection,
    connection: readConnection(config, defaultConnection),
  };
}

function settingValue(provider: BuiltInProviderName, key: string, value: unknown): ProviderValue {
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  throw new ConfigError(`Stored setting ${provider}.${key} must be a string, boolean, or number.`);
}

function environmentValue(key: string, value: string): ProviderValue {
  if (key === 'timeout') {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
      throw new ConfigError(`${key} environment value must be a positive number.`);
    }
    return number;
  }
  if (key === 'retry' || key === 'markReadEnabled') {
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    throw new ConfigError(`${key} environment value must be true or false.`);
  }
  return value;
}

export function providerValuesFromOverrides(
  provider: BuiltInProviderName,
  overrides: ProviderOverrides,
): Readonly<Record<string, ProviderValue | undefined>> {
  const shared = {
    apiKey: overrides.apiKey,
    webhookSecret: overrides.webhookSecret,
  };
  switch (provider) {
    case 'blooio':
      return { ...shared, sender: overrides.fromNumber };
    case 'photon':
      return {
        projectId: overrides.projectId,
        projectSecret: overrides.projectSecret,
        phone: overrides.phoneNumber,
        webhookSecret: overrides.webhookSecret,
        timeout: overrides.timeout,
        retry: overrides.retry,
      };
    case 'sendblue':
      return {
        ...shared,
        apiSecret: overrides.apiSecret,
        fromNumber: overrides.fromNumber,
        markReadEnabled: overrides.markReadEnabled,
      };
  }
}

function credentialRef(
  connection: string,
  provider: BuiltInProviderName,
  name: string,
): CredentialRef {
  return { connection, provider, name };
}

async function resolveValues(
  context: CliContext,
  config: CliConfig,
  selection: ClientSelection,
  providerName: BuiltInProviderName,
  connectionName: string | undefined,
  connection: ConnectionConfig | undefined,
): Promise<ProviderValues> {
  const definition = providerRegistry[providerName];
  const values: Record<string, ProviderValue | undefined> = {};
  const allowedKeys = new Set(definition.fields.map((field) => field.key));

  for (const [key, value] of Object.entries(connection?.settings ?? {})) {
    if (!allowedKeys.has(key)) {
      throw new ConfigError(`Connection contains an unknown ${providerName} setting: ${key}.`);
    }
    values[key] = settingValue(providerName, key, value);
  }

  if (connectionName !== undefined) {
    for (const field of definition.fields) {
      if (field.kind === 'setting') continue;
      const value = await context.credentialStore.get(
        credentialRef(connectionName, providerName, field.key),
      );
      if (value !== null) values[field.key] = value;
    }
  }

  for (const field of definition.fields) {
    if (field.env === undefined) continue;
    const value = context.env[field.env];
    if (value !== undefined && value.length > 0) {
      values[field.key] = environmentValue(field.key, value);
    }
  }

  for (const [key, value] of Object.entries(
    providerValuesFromOverrides(providerName, selection.overrides ?? {}),
  )) {
    if (value !== undefined) values[key] = value;
  }

  for (const field of definition.fields) {
    if (!field.requiredFor.includes(selection.purpose) || values[field.key] !== undefined) continue;
    if (!selection.allowPrompt) {
      throw new ConfigError(
        `Missing ${field.label} for ${providerName}. Configure a connection, set ${field.env ?? field.key}, or pass the corresponding option.`,
      );
    }
    values[field.key] =
      field.kind === 'secret'
        ? await context.prompt.secret(`${definition.displayName} ${field.label}`)
        : await context.prompt.text(`${definition.displayName} ${field.label}`);
  }

  void config;
  return values;
}

export async function resolveClient(
  context: CliContext,
  config: CliConfig,
  selection: ClientSelection,
): Promise<ResolvedClient> {
  const resolved = resolveSelection(config, selection);
  const values = await resolveValues(
    context,
    config,
    selection,
    resolved.providerName,
    resolved.connectionName,
    resolved.connection,
  );
  const provider = createProvider(resolved.providerName, values) as AnyIMessageProvider;
  const connectionId = resolved.connectionName ?? DEFAULT_CONNECTION_ID;
  const client = createIMessageClient({ provider, connectionId });
  return {
    client,
    provider,
    definition: providerRegistry[resolved.providerName],
    providerName: resolved.providerName,
    ...(resolved.connectionName === undefined ? {} : { connectionName: resolved.connectionName }),
    connectionId,
    values,
  };
}

export async function withResolvedClient<T>(
  context: CliContext,
  config: CliConfig,
  selection: ClientSelection,
  operation: (resolved: ResolvedClient) => Promise<T>,
  onCleanupError?: (error: unknown, resolved: ResolvedClient) => void,
): Promise<T> {
  const resolved = await resolveClient(context, config, selection);
  try {
    return await operation(resolved);
  } finally {
    try {
      await resolved.client.close();
    } catch (error) {
      onCleanupError?.(error, resolved);
    }
  }
}

export function providerForConnection(config: CliConfig, connectionName: string): ProviderName {
  return readConnection(config, connectionName).provider;
}
