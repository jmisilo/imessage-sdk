import { readdir } from 'node:fs/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProviderFieldDefinition } from '../src/providers.js';
import { BUILT_IN_PROVIDER_NAMES, createProvider, providerRegistry } from '../src/providers.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('built-in provider registry', () => {
  it('contains every provider package in the workspace', async () => {
    const entries = await readdir(new URL('../../providers/', import.meta.url), {
      withFileTypes: true,
    });
    const packageDirectories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect([...BUILT_IN_PROVIDER_NAMES].sort()).toEqual(packageDirectories);
    expect(Object.keys(providerRegistry).sort()).toEqual(packageDirectories);
  });

  it('defines unique fields, environment variables, and required purposes', () => {
    for (const name of BUILT_IN_PROVIDER_NAMES) {
      const definition = providerRegistry[name];
      expect(definition.name).toBe(name);
      expect(definition.packageName).toBe(`@imessage-sdk/${name}`);
      expect(definition.capabilities).toBeDefined();
      const fields: readonly ProviderFieldDefinition[] = definition.fields;
      expect(new Set(fields.map((field) => field.key)).size).toBe(fields.length);

      const environmentVariables = fields.flatMap((field) =>
        field.env === undefined ? [] : [field.env],
      );
      expect(new Set(environmentVariables).size).toBe(environmentVariables.length);

      for (const field of fields) {
        expect(['secret', 'identity', 'setting']).toContain(field.kind);
        expect(
          field.requiredFor.every((purpose) => ['api', 'webhook', 'doctor'].includes(purpose)),
        ).toBe(true);
      }
    }
  });

  it('marks the exact webhook requirements for each provider', () => {
    const requiredWebhookFields = (name: (typeof BUILT_IN_PROVIDER_NAMES)[number]): string[] => {
      const fields: readonly ProviderFieldDefinition[] = providerRegistry[name].fields;
      return fields
        .filter((field) => field.requiredFor.includes('webhook'))
        .map((field) => field.key);
    };

    expect(requiredWebhookFields('blooio')).toEqual(['webhookSecret']);
    expect(requiredWebhookFields('photon')).toEqual(['webhookSecret']);
    expect(requiredWebhookFields('sendblue')).toEqual(['fromNumber', 'webhookSecret']);
  });

  it('creates each bundled provider without initializing a network connection', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const blooio = createProvider('blooio', {
      apiKey: 'blooio-key',
      sender: '+15550000001',
    });
    const photon = createProvider('photon', {
      projectId: 'project-id',
      projectSecret: 'project-secret',
      phone: '+15550000002',
    });
    const sendblue = createProvider('sendblue', {
      apiKey: 'sendblue-key',
      apiSecret: 'sendblue-secret',
      fromNumber: '+15550000003',
      markReadEnabled: true,
    });

    expect(blooio.name).toBe('blooio');
    expect(photon.name).toBe('photon');
    expect(sendblue.name).toBe('sendblue');
    expect(sendblue.capabilities.conversations.markRead).toBe(true);
    expect('markRead' in sendblue.conversations).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    await photon.close?.();
  });

  it('rejects settings with the wrong resolved value type', () => {
    expect(() => createProvider('photon', { timeout: 'slow' })).toThrowError(
      expect.objectContaining({
        name: 'ValidationError',
        code: 'invalid_provider_configuration',
      }),
    );
    expect(() => createProvider('sendblue', { markReadEnabled: 'yes' })).toThrowError(
      expect.objectContaining({
        name: 'ValidationError',
        code: 'invalid_provider_configuration',
      }),
    );
  });

  it('verifies Blooio credentials through a non-mutating number lookup', async () => {
    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            numbers: [
              {
                phone_number: '+15550000001',
                is_active: true,
                plan_kind: 'dedicated',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await providerRegistry.blooio.doctor({
      apiKey: 'blooio-key',
      sender: '+15550000001',
      baseUrl: 'https://blooio.test/v2/api',
    });

    expect(result).toMatchObject({
      status: 'ok',
      details: { activeNumberCount: 1, activeNumbers: ['+15550000001'] },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://blooio.test/v2/api/me/numbers',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer blooio-key' }),
      }),
    );
  });

  it('keeps Sendblue doctor non-mutating and reports remote verification limits', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await providerRegistry.sendblue.doctor({
      apiKey: 'sendblue-key',
      apiSecret: 'sendblue-secret',
      fromNumber: '+15550000003',
    });

    expect(result).toMatchObject({
      status: 'warning',
      code: 'remote_credentials_not_verified',
      details: { fromNumber: '+15550000003', markReadEnabled: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns safe doctor failures without exposing secret values', async () => {
    const secret = 'blooio-secret-value';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.resolve(
          new Response(JSON.stringify({ message: `Rejected ${secret}` }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    );

    const result = await providerRegistry.blooio.doctor({ apiKey: secret });

    expect(result).toMatchObject({ status: 'error' });
    expect(result.message).not.toContain(secret);
    expect(result.message).toContain('[REDACTED]');
  });
});
