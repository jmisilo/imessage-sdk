import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CredentialStoreError,
  getCredentialAccount,
  MemoryCredentialStore,
  SystemCredentialStore,
} from '../src/credentials.js';

const keyring = vi.hoisted(() => ({
  entries: new Map<string, string>(),
  operations: [] as { readonly account: string; readonly service: string }[],
  error: undefined as Error | undefined,
}));

vi.mock('@napi-rs/keyring', () => ({
  AsyncEntry: class {
    readonly #key: string;

    constructor(service: string, account: string) {
      keyring.operations.push({ service, account });
      this.#key = `${service}:${account}`;
    }

    async getPassword(): Promise<string | undefined> {
      if (keyring.error !== undefined) throw keyring.error;
      return keyring.entries.get(this.#key);
    }

    async setPassword(secret: string): Promise<void> {
      if (keyring.error !== undefined) throw keyring.error;
      keyring.entries.set(this.#key, secret);
    }

    async deleteCredential(): Promise<boolean> {
      if (keyring.error !== undefined) throw keyring.error;
      return keyring.entries.delete(this.#key);
    }
  },
}));

const ref = {
  connection: 'personal',
  provider: 'blooio',
  name: 'api-key',
} as const;

afterEach(() => {
  keyring.entries.clear();
  keyring.operations.length = 0;
  keyring.error = undefined;
});

describe('credential stores', () => {
  it('keeps one in-memory credential per connection, provider, and name', async () => {
    const store = new MemoryCredentialStore();
    const second = { ...ref, connection: 'work' };

    await store.set(ref, 'personal-secret');
    await store.set(second, 'work-secret');

    await expect(store.get(ref)).resolves.toBe('personal-secret');
    await expect(store.get(second)).resolves.toBe('work-secret');
    await expect(store.delete(ref)).resolves.toBe(true);
    await expect(store.get(ref)).resolves.toBeNull();
    await expect(store.get(second)).resolves.toBe('work-secret');
  });

  it('maps each system credential to one stable service/account pair', async () => {
    const store = new SystemCredentialStore();

    await store.set(ref, 'secret');
    await expect(store.get(ref)).resolves.toBe('secret');
    await expect(store.delete(ref)).resolves.toBe(true);

    expect(getCredentialAccount(ref)).toBe('v1:personal:blooio:api-key');
    expect(keyring.operations).toEqual([
      { service: 'imessage-cli', account: 'v1:personal:blooio:api-key' },
      { service: 'imessage-cli', account: 'v1:personal:blooio:api-key' },
      { service: 'imessage-cli', account: 'v1:personal:blooio:api-key' },
    ]);
  });

  it('wraps native keyring failures without falling back to plaintext storage', async () => {
    const store = new SystemCredentialStore();
    const failure = new Error('keyring is locked');
    keyring.error = failure;

    const promise = store.set(ref, 'secret');
    await expect(promise).rejects.toBeInstanceOf(CredentialStoreError);
    await expect(promise).rejects.toMatchObject({ cause: failure });
    expect(keyring.entries).toEqual(new Map());
  });

  it('rejects empty secrets and unsafe account components', async () => {
    const store = new MemoryCredentialStore();

    await expect(store.set(ref, '')).rejects.toBeInstanceOf(CredentialStoreError);
    expect(() => getCredentialAccount({ ...ref, connection: '../personal' })).toThrow(
      CredentialStoreError,
    );
  });
});
