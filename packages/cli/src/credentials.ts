import type { ProviderName } from './config.js';
import { CredentialStoreUnavailableError } from './errors.js';

export const DEFAULT_CREDENTIAL_SERVICE = 'imessage-cli';

export interface CredentialRef {
  readonly connection: string;
  readonly provider: ProviderName;
  readonly name: string;
}

export interface CredentialStore {
  get(ref: CredentialRef): Promise<string | null>;
  set(ref: CredentialRef, secret: string): Promise<void>;
  delete(ref: CredentialRef): Promise<boolean>;
}

export class CredentialStoreError extends CredentialStoreUnavailableError {
  override readonly name = 'CredentialStoreError';

  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

function assertAccountPart(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) {
    throw new CredentialStoreError(
      `${label} may contain only letters, numbers, dots, underscores, and hyphens.`,
    );
  }
}

export function getCredentialAccount(ref: CredentialRef): string {
  assertAccountPart(ref.connection, 'Connection name');
  assertAccountPart(ref.name, 'Credential name');
  return `v1:${ref.connection}:${ref.provider}:${ref.name}`;
}

export class SystemCredentialStore implements CredentialStore {
  readonly service: string;

  constructor(service = DEFAULT_CREDENTIAL_SERVICE) {
    if (service.trim().length === 0) {
      throw new CredentialStoreError('Credential service must not be empty.');
    }

    this.service = service;
  }

  async get(ref: CredentialRef): Promise<string | null> {
    try {
      const { AsyncEntry } = await import('@napi-rs/keyring');
      return (await new AsyncEntry(this.service, getCredentialAccount(ref)).getPassword()) ?? null;
    } catch (error) {
      throw new CredentialStoreError(
        'Could not read credentials from the system credential store.',
        {
          cause: error,
        },
      );
    }
  }

  async set(ref: CredentialRef, secret: string): Promise<void> {
    if (secret.length === 0) {
      throw new CredentialStoreError('Credential value must not be empty.');
    }

    try {
      const { AsyncEntry } = await import('@napi-rs/keyring');
      await new AsyncEntry(this.service, getCredentialAccount(ref)).setPassword(secret);
    } catch (error) {
      throw new CredentialStoreError(
        'Could not write credentials to the system credential store.',
        {
          cause: error,
        },
      );
    }
  }

  async delete(ref: CredentialRef): Promise<boolean> {
    try {
      const { AsyncEntry } = await import('@napi-rs/keyring');
      return await new AsyncEntry(this.service, getCredentialAccount(ref)).deleteCredential();
    } catch (error) {
      throw new CredentialStoreError(
        'Could not delete credentials from the system credential store.',
        { cause: error },
      );
    }
  }
}

export class MemoryCredentialStore implements CredentialStore {
  readonly #credentials = new Map<string, string>();
  readonly #service: string;

  constructor(service = DEFAULT_CREDENTIAL_SERVICE) {
    this.#service = service;
  }

  async get(ref: CredentialRef): Promise<string | null> {
    return this.#credentials.get(this.#key(ref)) ?? null;
  }

  async set(ref: CredentialRef, secret: string): Promise<void> {
    if (secret.length === 0) {
      throw new CredentialStoreError('Credential value must not be empty.');
    }

    this.#credentials.set(this.#key(ref), secret);
  }

  async delete(ref: CredentialRef): Promise<boolean> {
    return this.#credentials.delete(this.#key(ref));
  }

  #key(ref: CredentialRef): string {
    return `${this.#service}:${getCredentialAccount(ref)}`;
  }
}
