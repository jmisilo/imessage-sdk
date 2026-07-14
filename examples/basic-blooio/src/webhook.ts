import process from 'node:process';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';

import { blooio } from '@imessage-sdk/blooio';
import { createIMessageClient, WebhookVerificationError } from 'imessage-sdk';

required('BLOOIO_WEBHOOK_SECRET');

const client = createIMessageClient({
  provider: blooio(),
});
const app = new Hono();

app.post('/webhooks/blooio', async (context) => {
  try {
    const events = await client.webhooks.handle(context.req.raw);
    console.dir(events, { depth: null });
    return context.body(null, 204);
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      return context.text('Invalid webhook signature', 401);
    }

    console.error(error);
    return context.text('Webhook handling failed', 500);
  }
});

serve(
  {
    fetch: app.fetch,
    port: 3000,
  },
  (info) => {
    console.log(
      `Listening for signed Blooio webhooks at http://localhost:${info.port}/webhooks/blooio`,
    );
  },
);

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}
