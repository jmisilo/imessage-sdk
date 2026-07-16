import type { Adapter } from 'chat';

import { blooio } from '@imessage-sdk/blooio';
import { createIMessageAdapter } from '@imessage-sdk/chat-adapter';
import { photon } from '@imessage-sdk/photon';
import { sendblue } from '@imessage-sdk/sendblue';
import { createIMessageClient } from 'imessage-sdk';

const blooioClient = createIMessageClient({
  connectionId: 'blooio-consumer',
  provider: blooio({ apiKey: 'test' }),
});

const photonClient = createIMessageClient({
  connectionId: 'photon-consumer',
  provider: photon({ projectId: 'test', projectSecret: 'test' }),
});

const sendblueClient = createIMessageClient({
  connectionId: 'sendblue-consumer',
  provider: sendblue({ apiKey: 'test', apiSecret: 'test', fromNumber: '+15555550100' }),
});

const sendblueMarkReadClient = createIMessageClient({
  connectionId: 'sendblue-mark-read-consumer',
  provider: sendblue({
    apiKey: 'test',
    apiSecret: 'test',
    fromNumber: '+15555550100',
    markReadEnabled: true,
  }),
});

const blooioProvider: 'blooio' = blooioClient.provider;
const photonProvider: 'photon' = photonClient.provider;
const sendblueProvider: 'sendblue' = sendblueClient.provider;

void blooioProvider;
void photonProvider;
void sendblueProvider;
void blooioClient.providers.blooio.numbers.list;
void photonClient.providers.photon.connection.getLine;
void sendblueClient.providers.sendblue.tapbacks.add;
void photonClient.attachments.download;
const photonDownloadsAttachments: true = photonClient.capabilities.attachments.download;
const blooioDownloadsAttachments: false = blooioClient.capabilities.attachments.download;
const sendblueDownloadsAttachments: false = sendblueClient.capabilities.attachments.download;
const sendblueSendsAttachments: true = sendblueClient.capabilities.messages.attachments;
const sendblueDefaultMarkRead: false = sendblueClient.capabilities.conversations.markRead;
const sendblueDefaultReadReceipts: false = sendblueClient.capabilities.interactions.readReceipts;
const sendblueReadReceipts: false = sendblueMarkReadClient.capabilities.interactions.readReceipts;
const sendblueMarkRead: true = sendblueMarkReadClient.capabilities.conversations.markRead;
void photonDownloadsAttachments;
void blooioDownloadsAttachments;
void sendblueDownloadsAttachments;
void sendblueSendsAttachments;
void sendblueDefaultMarkRead;
void sendblueDefaultReadReceipts;
void sendblueReadReceipts;
void sendblueMarkRead;

const imessage = createIMessageAdapter({
  connectionId: 'chat-consumer',
  provider: blooio({ apiKey: 'test' }),
});
const sendblueImessage = createIMessageAdapter({
  connectionId: 'sendblue-chat-consumer',
  provider: sendblue({ apiKey: 'test', apiSecret: 'test', fromNumber: '+15555550100' }),
});
const chatAdapter: Adapter = imessage;
const chatProvider: 'blooio' = imessage.client.provider;
const sendblueChatAdapter: Adapter = sendblueImessage;
const sendblueChatProvider: 'sendblue' = sendblueImessage.client.provider;

void chatAdapter;
void chatProvider;
void sendblueChatAdapter;
void sendblueChatProvider;
void imessage.client.providers.blooio.numbers.list;
void sendblueImessage.client.providers.sendblue.tapbacks.add;
