import { request as httpRequest } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ValidationError, WebhookVerificationError } from 'imessage-sdk';

import type { WebhookServer, WebhookServerClient } from '../src/webhook-server.js';
import { startWebhookServer } from '../src/webhook-server.js';

interface TestEvent {
  readonly id: string;
}

function createClient(
  handle: (request: Request) => Promise<readonly TestEvent[]>,
): WebhookServerClient<TestEvent> & { close: ReturnType<typeof vi.fn> } {
  return {
    webhooks: { handle },
    close: vi.fn(async () => {}),
  };
}

async function rawRequest(
  url: string,
  options: {
    readonly method: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
  },
): Promise<{ readonly status: number; readonly headers: Headers; readonly body: string }> {
  const target = new URL(url);

  return await new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: options.method,
        headers: options.headers,
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.once('error', reject);
        response.once('end', () => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) {
              for (const item of value) headers.append(name, item);
            } else if (value !== undefined) {
              headers.append(name, value);
            }
          }
          resolve({
            status: response.statusCode ?? 0,
            headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );

    request.once('error', reject);

    if (options.body !== undefined) {
      request.write(options.body);
    }

    request.end();
  });
}

describe('startWebhookServer', () => {
  const servers: WebhookServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(async (server) => await server.close()));
  });

  it('preserves the request and emits normalized events sequentially', async () => {
    const receivedRequests: Request[] = [];
    const client = createClient(async (request) => {
      receivedRequests.push(request);
      return [{ id: 'first' }, { id: 'second' }];
    });
    const emitted: string[] = [];
    const server = await startWebhookServer({
      client,
      port: 0,
      path: '/provider-hook',
      onEvent: async (event) => {
        emitted.push(`start:${event.id}`);
        await Promise.resolve();
        emitted.push(`end:${event.id}`);
      },
    });
    servers.push(server);

    const body = '{"message":"hello"}\n';
    const response = await fetch(`${server.address.url}?delivery=one`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-provider-signature': 'signature-value',
      },
      body,
    });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(emitted).toEqual(['start:first', 'end:first', 'start:second', 'end:second']);
    expect(receivedRequests).toHaveLength(1);

    const providerRequest = receivedRequests[0];
    expect(providerRequest?.method).toBe('POST');
    expect(providerRequest?.headers.get('content-type')).toBe('application/json');
    expect(providerRequest?.headers.get('x-provider-signature')).toBe('signature-value');
    expect(new URL(providerRequest?.url ?? '').search).toBe('?delivery=one');
    expect(await providerRequest?.text()).toBe(body);

    await server.close();
    expect(client.close).not.toHaveBeenCalled();
  });

  it('accepts a verified webhook that produces no events', async () => {
    const client = createClient(async () => []);
    const onEvent = vi.fn();
    const server = await startWebhookServer({ client, onEvent, port: 0 });
    servers.push(server);

    const response = await fetch(server.address.url, { method: 'POST' });

    expect(response.status).toBe(204);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'verification failure',
      error: new WebhookVerificationError(),
      status: 401,
      code: 'webhook_verification_failed',
    },
    {
      name: 'SDK validation failure',
      error: new ValidationError('Malformed provider payload.'),
      status: 400,
      code: 'invalid_webhook_request',
    },
    {
      name: 'unexpected processing failure',
      error: new Error('unexpected'),
      status: 500,
      code: 'webhook_processing_failed',
    },
  ])('maps $name to HTTP $status', async ({ error, status, code }) => {
    const client = createClient(async () => {
      throw error;
    });
    const onError = vi.fn();
    const server = await startWebhookServer({ client, onEvent: vi.fn(), onError, port: 0 });
    servers.push(server);

    const response = await fetch(server.address.url, { method: 'POST' });

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: code });
    expect(onError).toHaveBeenCalledWith({ statusCode: status, code, error });
  });

  it('rejects oversized request bodies without calling the client', async () => {
    const handle = vi.fn(async () => []);
    const client = createClient(handle);
    const server = await startWebhookServer({
      client,
      onEvent: vi.fn(),
      port: 0,
      maxBodyBytes: 4,
    });
    servers.push(server);

    const response = await fetch(server.address.url, {
      method: 'POST',
      body: '12345',
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'request_body_too_large' });
    expect(handle).not.toHaveBeenCalled();
  });

  it('serves health checks, rejects other methods, and returns 404 for unknown paths', async () => {
    const client = createClient(async () => []);
    const server = await startWebhookServer({ client, onEvent: vi.fn(), port: 0 });
    servers.push(server);

    const health = await fetch(server.address.healthUrl ?? '');
    expect(health.status).toBe(204);

    const wrongHealthMethod = await fetch(server.address.healthUrl ?? '', { method: 'POST' });
    expect(wrongHealthMethod.status).toBe(405);
    expect(wrongHealthMethod.headers.get('allow')).toBe('GET');

    const wrongWebhookMethod = await fetch(server.address.url);
    expect(wrongWebhookMethod.status).toBe(405);
    expect(wrongWebhookMethod.headers.get('allow')).toBe('POST');

    const missing = await fetch(new URL('/missing', server.address.url));
    expect(missing.status).toBe(404);
  });

  it('can disable the health endpoint', async () => {
    const client = createClient(async () => []);
    const server = await startWebhookServer({
      client,
      onEvent: vi.fn(),
      port: 0,
      healthPath: false,
    });
    servers.push(server);

    expect(server.address.healthUrl).toBeUndefined();
    const response = await fetch(new URL('/healthz', server.address.url));
    expect(response.status).toBe(404);
  });

  it('rejects a malformed Content-Length header', async () => {
    const handle = vi.fn(async () => []);
    const client = createClient(handle);
    const server = await startWebhookServer({ client, onEvent: vi.fn(), port: 0 });
    servers.push(server);

    const response = await rawRequest(server.address.url, {
      method: 'POST',
      headers: { 'content-length': 'not-a-number' },
    });

    expect(response.status).toBe(400);
    expect(response.status).toBe(400);
    if (response.body.length > 0) {
      expect(JSON.parse(response.body)).toEqual({ error: 'invalid_webhook_request' });
    }
    expect(handle).not.toHaveBeenCalled();
  });

  it('validates server paths before binding', async () => {
    const client = createClient(async () => []);

    await expect(
      startWebhookServer({ client, onEvent: vi.fn(), path: 'webhooks' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
