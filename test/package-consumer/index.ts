import { blooio } from '@imessage-sdk/blooio';
import { photon } from '@imessage-sdk/photon';
import { createIMessageClient } from 'imessage-sdk';

const blooioClient = createIMessageClient({
  connectionId: 'blooio-consumer',
  provider: blooio({ apiKey: 'test' }),
});

const photonClient = createIMessageClient({
  connectionId: 'photon-consumer',
  provider: photon({ projectId: 'test', projectSecret: 'test' }),
});

const blooioProvider: 'blooio' = blooioClient.provider;
const photonProvider: 'photon' = photonClient.provider;

void blooioProvider;
void photonProvider;
void blooioClient.providers.blooio.numbers.list;
void photonClient.providers.photon.connection.getLine;
