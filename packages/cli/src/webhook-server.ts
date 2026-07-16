import type { AddressInfo } from 'node:net';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import type { IMessageEvent } from 'imessage-sdk';
import { ValidationError, WebhookVerificationError } from 'imessage-sdk';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const DEFAULT_PATH = '/webhooks';
const DEFAULT_HEALTH_PATH = '/healthz';
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

class MalformedWebhookRequestError extends Error {}

class WebhookBodyTooLargeError extends Error {}

export interface WebhookServerClient<TEvent = IMessageEvent> {
  readonly webhooks: {
    handle(request: Request): Promise<readonly TEvent[]>;
  };
  close(): Promise<void>;
}

export interface StartWebhookServerOptions<TEvent = IMessageEvent> {
  readonly client: WebhookServerClient<TEvent>;
  readonly onEvent: (event: TEvent) => void | Promise<void>;
  readonly onError?: (failure: WebhookServerFailure) => void | Promise<void>;
  readonly host?: string;
  /** Use `0` to bind an available ephemeral port. */
  readonly port?: number;
  readonly path?: string;
  /** Defaults to `/healthz`. Set to `false` to disable the health endpoint. */
  readonly healthPath?: string | false;
  readonly maxBodyBytes?: number;
}

export interface WebhookServerFailure {
  readonly statusCode: number;
  readonly code: string;
  readonly error: unknown;
}

export interface WebhookServerAddress {
  readonly host: string;
  readonly port: number;
  readonly path: string;
  readonly url: string;
  readonly healthUrl?: string;
}

export interface WebhookServer {
  readonly address: WebhookServerAddress;
  /** Stops accepting requests and waits for in-flight requests. Does not close the SDK client. */
  close(): Promise<void>;
}

function validatePath(value: string, name: string): void {
  if (!value.startsWith('/') || value.includes('?') || value.includes('#')) {
    throw new ValidationError(`${name} must be an absolute URL path without a query or fragment.`, {
      code: 'invalid_webhook_server_path',
    });
  }
}

function validateOptions<TEvent>(options: StartWebhookServerOptions<TEvent>): void {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const path = options.path ?? DEFAULT_PATH;
  const healthPath = options.healthPath ?? DEFAULT_HEALTH_PATH;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  if (host.trim().length === 0) {
    throw new ValidationError('host must not be empty.', {
      code: 'invalid_webhook_server_host',
    });
  }

  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new ValidationError('port must be an integer between 0 and 65535.', {
      code: 'invalid_webhook_server_port',
    });
  }

  validatePath(path, 'path');

  if (healthPath !== false) {
    validatePath(healthPath, 'healthPath');

    if (healthPath === path) {
      throw new ValidationError('healthPath must differ from path.', {
        code: 'invalid_webhook_server_health_path',
      });
    }
  }

  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0) {
    throw new ValidationError('maxBodyBytes must be a positive safe integer.', {
      code: 'invalid_webhook_server_body_limit',
    });
  }
}

function formatHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function errorResponse(statusCode: number, code: string, allow?: string): Response {
  const body = `${JSON.stringify({ error: code })}\n`;
  return new Response(body, {
    status: statusCode,
    headers: {
      ...(allow === undefined ? {} : { allow }),
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

function parseContentLength(request: Request): number | undefined {
  const value = request.headers.get('content-length');
  if (value === null) return undefined;
  if (!/^\d+$/u.test(value)) {
    throw new MalformedWebhookRequestError('Invalid Content-Length header.');
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length)) {
    throw new MalformedWebhookRequestError('Invalid Content-Length header.');
  }
  return length;
}

function providerRequest(request: Request, body: ArrayBuffer): Request {
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    ...(body.byteLength === 0 ? {} : { body }),
  });
}

export async function startWebhookServer<TEvent = IMessageEvent>(
  options: StartWebhookServerOptions<TEvent>,
): Promise<WebhookServer> {
  validateOptions(options);

  const host = options.host ?? DEFAULT_HOST;
  const requestedPort = options.port ?? DEFAULT_PORT;
  const path = options.path ?? DEFAULT_PATH;
  const healthPath = options.healthPath ?? DEFAULT_HEALTH_PATH;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const app = new Hono();

  const reportError = async (failure: WebhookServerFailure): Promise<void> => {
    try {
      await options.onError?.(failure);
    } catch {
      // Diagnostics must never change the provider's webhook response.
    }
  };

  const limitWebhookBody = bodyLimit({
    maxSize: maxBodyBytes,
    onError: async () => {
      const error = new WebhookBodyTooLargeError('Webhook request body is too large.');
      await reportError({ statusCode: 413, code: 'request_body_too_large', error });
      return errorResponse(413, 'request_body_too_large');
    },
  });

  app.use('*', async (context, next) => {
    const url = new URL(context.req.url);
    if (url.pathname !== path || context.req.method !== 'POST') return await next();

    try {
      const contentLength = parseContentLength(context.req.raw);
      if (contentLength !== undefined && contentLength > maxBodyBytes) {
        const error = new WebhookBodyTooLargeError('Webhook request body is too large.');
        await reportError({ statusCode: 413, code: 'request_body_too_large', error });
        return errorResponse(413, 'request_body_too_large');
      }
    } catch (error) {
      await reportError({ statusCode: 400, code: 'invalid_webhook_request', error });
      return errorResponse(400, 'invalid_webhook_request');
    }

    return await limitWebhookBody(context, next);
  });

  app.all('*', async (context) => {
    const url = new URL(context.req.url);

    if (healthPath !== false && url.pathname === healthPath) {
      return context.req.method === 'GET'
        ? new Response(null, { status: 204 })
        : errorResponse(405, 'method_not_allowed', 'GET');
    }

    if (url.pathname !== path) return errorResponse(404, 'not_found');
    if (context.req.method !== 'POST') {
      return errorResponse(405, 'method_not_allowed', 'POST');
    }

    try {
      const body = await context.req.arrayBuffer();
      const events = await options.client.webhooks.handle(providerRequest(context.req.raw, body));

      for (const event of events) {
        await options.onEvent(event);
      }

      return new Response(null, { status: 204 });
    } catch (error) {
      let statusCode = 500;
      let code = 'webhook_processing_failed';
      if (error instanceof WebhookVerificationError) {
        statusCode = 401;
        code = 'webhook_verification_failed';
      } else if (error instanceof WebhookBodyTooLargeError) {
        statusCode = 413;
        code = 'request_body_too_large';
      } else if (
        error instanceof ValidationError ||
        error instanceof MalformedWebhookRequestError
      ) {
        statusCode = 400;
        code = 'invalid_webhook_request';
      }
      await reportError({ statusCode, code, error });
      return errorResponse(statusCode, code);
    }
  });

  app.onError(async (error) => {
    await reportError({ statusCode: 500, code: 'webhook_processing_failed', error });
    return errorResponse(500, 'webhook_processing_failed');
  });

  let server: ReturnType<typeof serve> | undefined;
  const boundAddress = await new Promise<AddressInfo>((resolve, reject) => {
    server = serve(
      {
        fetch: app.fetch,
        hostname: host,
        port: requestedPort,
      },
      resolve,
    );
    server.once('error', reject);
  });

  if (server === undefined) throw new Error('Webhook server did not start.');
  const boundServer = server;

  const boundPort = boundAddress.port;
  const origin = `http://${formatHost(host)}:${boundPort}`;
  let closePromise: Promise<void> | undefined;

  return {
    address: {
      host,
      port: boundPort,
      path,
      url: `${origin}${path}`,
      ...(healthPath === false ? {} : { healthUrl: `${origin}${healthPath}` }),
    },
    close() {
      if (closePromise !== undefined) return closePromise;

      closePromise = new Promise<void>((resolve, reject) => {
        boundServer.close((error) => {
          if (error !== undefined) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      return closePromise;
    },
  };
}
