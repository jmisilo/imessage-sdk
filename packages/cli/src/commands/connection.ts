import { Option } from 'clipanion';

import type { CliConfig, ConnectionConfig } from '../config.js';
import type { CredentialRef, CredentialStore } from '../credentials.js';
import type { BuiltInProviderName, ProviderValue } from '../providers.js';
import { CliUsageError, ConfigError } from '../errors.js';
import { readTextInput } from '../input.js';
import { providerRegistry } from '../providers.js';
import { isBuiltInProviderName, providerValuesFromOverrides, resolveClient } from '../runtime.js';
import { BaseCommand } from './base-command.js';
import { ProviderOptionsCommand } from './provider-options-command.js';

function ref(connection: string, provider: BuiltInProviderName, name: string): CredentialRef {
  return { connection, provider, name };
}

function maskIdentity(value: string): string {
  if (value.includes('@')) {
    const [local = '', domain = ''] = value.split('@', 2);
    return `${local.slice(0, 1)}•••@${domain}`;
  }
  if (value.length <= 4) return '••••';
  return `${value.slice(0, Math.min(3, value.length - 4))}${'•'.repeat(Math.min(6, value.length - 4))}${value.slice(-4)}`;
}

function withConnection(
  config: CliConfig,
  name: string,
  connection: ConnectionConfig,
  makeDefault: boolean,
  previous?: ConnectionConfig,
): CliConfig {
  const defaultConnections = {
    ...config.defaultConnections,
  };
  if (
    previous !== undefined &&
    previous.provider !== connection.provider &&
    defaultConnections[previous.provider] === name
  ) {
    delete defaultConnections[previous.provider];
  }
  if (makeDefault) defaultConnections[connection.provider] = name;
  return {
    version: 1,
    connections: { ...config.connections, [name]: connection },
    defaultConnections,
  };
}

interface CredentialSnapshot {
  readonly ref: CredentialRef;
  readonly value: string | null;
}

async function snapshotCredentials(
  store: CredentialStore,
  refs: readonly CredentialRef[],
): Promise<readonly CredentialSnapshot[]> {
  const snapshots: CredentialSnapshot[] = [];
  for (const credential of refs) {
    snapshots.push({ ref: credential, value: await store.get(credential) });
  }
  return snapshots;
}

async function restoreCredentials(
  store: CredentialStore,
  snapshots: readonly CredentialSnapshot[],
): Promise<void> {
  for (const snapshot of snapshots) {
    if (snapshot.value === null) {
      await store.delete(snapshot.ref);
    } else {
      await store.set(snapshot.ref, snapshot.value);
    }
  }
}

function withoutConnection(config: CliConfig, name: string): CliConfig {
  const connections = { ...config.connections };
  delete connections[name];
  const defaultConnections = { ...config.defaultConnections };
  for (const provider of Object.keys(defaultConnections) as BuiltInProviderName[]) {
    if (defaultConnections[provider] === name) delete defaultConnections[provider];
  }
  return { version: 1, connections, defaultConnections };
}

export class ConnectionAddCommand extends ProviderOptionsCommand {
  static override paths = [['connection', 'add']];
  static override usage = ConnectionAddCommand.Usage({
    category: 'Connections',
    description: 'Store one provider account or sending line on this device.',
  });

  name = Option.String({ name: 'name' });
  makeDefault = Option.Boolean('--default', false, {
    description: 'Make this the default connection for its provider.',
  });
  force = Option.Boolean('--force', false, { description: 'Replace an existing connection.' });

  async execute(): Promise<number> {
    return await this.action('connection.add', async () => {
      if (this.provider === undefined || !isBuiltInProviderName(this.provider)) {
        throw new CliUsageError(
          `--provider must be one of: ${Object.keys(providerRegistry).join(', ')}.`,
        );
      }
      const providerName = this.provider;
      const definition = providerRegistry[providerName];
      const store = this.configStore();
      const config = await store.load();
      const existing = config.connections[this.name];
      if (existing !== undefined && !this.force) {
        throw new ConfigError(
          `Connection ${JSON.stringify(this.name)} already exists. Use --force to replace it.`,
        );
      }

      const values: Record<string, ProviderValue | undefined> = {
        ...providerValuesFromOverrides(providerName, this.providerOverrides()),
      };
      for (const field of definition.fields) {
        if (values[field.key] !== undefined) continue;
        const required = field.requiredFor.includes('api');
        const promptOptional = field.kind === 'identity' || field.key === 'webhookSecret';
        if (!this.promptsAllowed()) {
          if (required) {
            throw new ConfigError(`Missing ${field.label}. Pass its option or run interactively.`);
          }
          continue;
        }
        if (!required && !promptOptional) continue;
        const value =
          field.kind === 'secret'
            ? await this.context.prompt.secret(
                `${definition.displayName} ${field.label}${required ? '' : ' (optional)'}`,
              )
            : await this.context.prompt.text(
                `${definition.displayName} ${field.label}${required ? '' : ' (optional)'}`,
              );
        if (value.length > 0) values[field.key] = value;
      }

      const settings: Record<string, unknown> = {};
      for (const field of definition.fields) {
        const value = values[field.key];
        if (field.kind === 'setting' && value !== undefined) settings[field.key] = value;
      }
      const connection: ConnectionConfig = {
        provider: providerName,
        ...(Object.keys(settings).length === 0 ? {} : { settings }),
      };
      const isFirstForProvider = !Object.values(config.connections).some(
        (candidate) => candidate.provider === providerName && candidate !== existing,
      );
      const next = withConnection(
        config,
        this.name,
        connection,
        this.makeDefault || isFirstForProvider,
        existing,
      );

      const credentialsToWrite = definition.fields.flatMap((field) => {
        if (field.kind === 'setting') return [];
        const value = values[field.key];
        return typeof value === 'string' && value.length > 0
          ? [{ ref: ref(this.name, providerName, field.key), value }]
          : [];
      });
      const staleCredentials =
        existing === undefined || existing.provider === providerName
          ? []
          : providerRegistry[existing.provider].fields.flatMap((field) =>
              field.kind === 'setting' ? [] : [ref(this.name, existing.provider, field.key)],
            );
      const snapshots = await snapshotCredentials(this.context.credentialStore, [
        ...credentialsToWrite.map((credential) => credential.ref),
        ...staleCredentials,
      ]);

      try {
        for (const credential of credentialsToWrite) {
          await this.context.credentialStore.set(credential.ref, credential.value);
        }
        await store.save(next);
        for (const credential of staleCredentials) {
          await this.context.credentialStore.delete(credential);
        }
      } catch (error) {
        const rollback = await Promise.allSettled([
          store.save(config),
          restoreCredentials(this.context.credentialStore, snapshots),
        ]);
        const rollbackFailures = rollback.filter((result) => result.status === 'rejected');
        if (rollbackFailures.length > 0) {
          throw new ConfigError(
            'Could not replace the connection atomically; local configuration may need repair.',
            { cause: error, rollbackFailureCount: rollbackFailures.length },
          );
        }
        throw error;
      }

      this.output().success('connection.add', {
        name: this.name,
        provider: providerName,
        default: next.defaultConnections[providerName] === this.name,
        configuredFields: definition.fields
          .filter((field) => values[field.key] !== undefined)
          .map((field) => field.key),
      });
    });
  }
}

export class ConnectionListCommand extends BaseCommand {
  static override paths = [['connection', 'list']];
  static override usage = ConnectionListCommand.Usage({
    category: 'Connections',
    description: 'List locally configured provider connections.',
  });

  async execute(): Promise<number> {
    return await this.action('connection.list', async () => {
      const config = await this.configStore().load();
      const connections = Object.entries(config.connections)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, connection]) => ({
          name,
          provider: connection.provider,
          connectionId: name,
          default: config.defaultConnections[connection.provider] === name,
        }));
      this.output().success('connection.list', connections);
    });
  }
}

export class ConnectionShowCommand extends BaseCommand {
  static override paths = [['connection', 'show']];
  static override usage = ConnectionShowCommand.Usage({
    category: 'Connections',
    description: 'Show safe connection settings and credential presence.',
  });

  name = Option.String({ name: 'name' });

  async execute(): Promise<number> {
    return await this.action('connection.show', async () => {
      const config = await this.configStore().load();
      const connection = config.connections[this.name];
      if (connection === undefined)
        throw new ConfigError(`Connection ${this.name} does not exist.`);
      const definition = providerRegistry[connection.provider];
      const fields: Record<string, unknown> = {};
      for (const field of definition.fields) {
        if (field.kind === 'setting') {
          fields[field.key] = connection.settings?.[field.key] ?? null;
          continue;
        }
        const value = await this.context.credentialStore.get(
          ref(this.name, connection.provider, field.key),
        );
        fields[field.key] =
          field.kind === 'secret'
            ? { configured: value !== null }
            : {
                configured: value !== null,
                ...(value === null ? {} : { value: maskIdentity(value) }),
              };
      }
      this.output().success('connection.show', {
        name: this.name,
        provider: connection.provider,
        connectionId: this.name,
        default: config.defaultConnections[connection.provider] === this.name,
        fields,
      });
    });
  }
}

export class ConnectionDoctorCommand extends BaseCommand {
  static override paths = [['connection', 'doctor']];
  static override usage = ConnectionDoctorCommand.Usage({
    category: 'Connections',
    description: 'Validate a connection without sending or mutating provider data.',
  });

  name = Option.String({ name: 'name' });
  offline = Option.Boolean('--offline', false, {
    description: 'Check only local configuration and credential availability.',
  });

  async execute(): Promise<number> {
    return await this.action('connection.doctor', async () => {
      const config = await this.configStore().load();
      const resolved = await resolveClient(this.context, config, {
        connection: this.name,
        purpose: 'doctor',
        allowPrompt: false,
      });
      let result;
      try {
        result = this.offline
          ? {
              status: 'ok' as const,
              message: 'Local configuration and required credentials are valid.',
            }
          : await resolved.definition.doctor(resolved.values);
      } finally {
        try {
          await resolved.client.close();
        } catch {
          this.output().diagnostic(
            `Warning: ${resolved.providerName} resources did not close cleanly; the doctor result is unchanged.`,
          );
        }
      }
      this.output().success('connection.doctor', result, {
        provider: resolved.providerName,
        connectionId: resolved.connectionId,
      });
    });
  }
}

export class ConnectionRemoveCommand extends BaseCommand {
  static override paths = [['connection', 'remove']];
  static override usage = ConnectionRemoveCommand.Usage({
    category: 'Connections',
    description: 'Remove local configuration and keychain entries only.',
  });

  name = Option.String({ name: 'name' });
  yes = Option.Boolean('--yes', false, { description: 'Skip the confirmation prompt.' });

  async execute(): Promise<number> {
    return await this.action('connection.remove', async () => {
      const store = this.configStore();
      const config = await store.load();
      const connection = config.connections[this.name];
      if (connection === undefined)
        throw new ConfigError(`Connection ${this.name} does not exist.`);
      if (!this.yes) {
        const stdin = this.context.stdin as NodeJS.ReadStream;
        if (this.json || stdin.isTTY !== true) {
          throw new CliUsageError('Use --yes when removing a connection non-interactively.');
        }
        const confirmed = await this.context.prompt.confirm(
          `Remove local connection ${this.name}? This does not change the provider account.`,
        );
        if (!confirmed) {
          this.output().success('connection.remove', { name: this.name, removed: false });
          return;
        }
      }
      const credentialRefs = providerRegistry[connection.provider].fields.flatMap((field) =>
        field.kind === 'setting' ? [] : [ref(this.name, connection.provider, field.key)],
      );
      const snapshots = await snapshotCredentials(this.context.credentialStore, credentialRefs);
      try {
        for (const credential of credentialRefs) {
          await this.context.credentialStore.delete(credential);
        }
        await store.save(withoutConnection(config, this.name));
      } catch (error) {
        const rollback = await Promise.allSettled([
          store.save(config),
          restoreCredentials(this.context.credentialStore, snapshots),
        ]);
        const rollbackFailures = rollback.filter((result) => result.status === 'rejected');
        if (rollbackFailures.length > 0) {
          throw new ConfigError(
            'Could not remove the connection atomically; local configuration may need repair.',
            { cause: error, rollbackFailureCount: rollbackFailures.length },
          );
        }
        throw error;
      }
      this.output().success('connection.remove', { name: this.name, removed: true });
    });
  }
}

export class ConnectionCredentialSetCommand extends BaseCommand {
  static override paths = [['connection', 'credential', 'set']];
  static override usage = ConnectionCredentialSetCommand.Usage({
    category: 'Connections',
    description: 'Set one connection credential from a masked prompt or stdin.',
  });

  connectionName = Option.String({ name: 'connection' });
  fieldName = Option.String({ name: 'field' });
  inputPath = Option.String('--input', {
    description: 'Read the value from a file, or use - for stdin.',
  });

  async execute(): Promise<number> {
    return await this.action('connection.credential.set', async () => {
      const config = await this.configStore().load();
      const connection = config.connections[this.connectionName];
      if (connection === undefined) {
        throw new ConfigError(`Connection ${this.connectionName} does not exist.`);
      }
      const field = providerRegistry[connection.provider].fields.find(
        (candidate) => candidate.key === this.fieldName,
      );
      if (field === undefined || field.kind === 'setting') {
        throw new CliUsageError(`${this.fieldName} is not a credential or identity field.`);
      }
      let value: string;
      if (this.inputPath !== undefined) {
        value = (await readTextInput(this.inputPath, this.context.stdin)).replace(/\r?\n$/u, '');
      } else {
        const stdin = this.context.stdin as NodeJS.ReadStream;
        if (this.json || stdin.isTTY !== true) {
          throw new CliUsageError('Use --input in non-interactive mode.');
        }
        value =
          field.kind === 'secret'
            ? await this.context.prompt.secret(`${field.label}`)
            : await this.context.prompt.text(`${field.label}`);
      }
      if (value.length === 0) throw new CliUsageError('Credential value must not be empty.');
      await this.context.credentialStore.set(
        ref(this.connectionName, connection.provider, field.key),
        value,
      );
      this.output().success('connection.credential.set', {
        connection: this.connectionName,
        field: field.key,
        configured: true,
      });
    });
  }
}
