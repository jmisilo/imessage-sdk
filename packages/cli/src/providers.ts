import type { BlooioProvider } from '@imessage-sdk/blooio';
import type { PhotonProvider } from '@imessage-sdk/photon';
import type { SendblueProvider } from '@imessage-sdk/sendblue';
import type { AnyIMessageProvider, IMessageCapabilities } from 'imessage-sdk';
import { blooio, BLOOIO_CAPABILITIES } from '@imessage-sdk/blooio';
import { photon, PHOTON_CAPABILITIES } from '@imessage-sdk/photon';
import { sendblue, SENDBLUE_CAPABILITIES } from '@imessage-sdk/sendblue';
import { IMessageSDKError, ValidationError } from 'imessage-sdk';

import type { BuiltInProviderName } from './provider-names.js';
import { BUILT_IN_PROVIDER_NAMES } from './provider-names.js';

export type { BuiltInProviderName };
export { BUILT_IN_PROVIDER_NAMES };

export type ProviderPurpose = 'api' | 'webhook' | 'doctor';

export type ProviderValue = string | boolean | number;

/** Values have already been resolved from environment, keyring, or trusted settings. */
export type ProviderValues = Readonly<Record<string, ProviderValue | undefined>>;

export type ProviderFieldKind = 'secret' | 'identity' | 'setting';

export interface ProviderFieldDefinition {
  /** Canonical key accepted by `createProvider()`. */
  readonly key: string;
  readonly label: string;
  readonly kind: ProviderFieldKind;
  /** Standard provider environment variable, when one exists. */
  readonly env?: string;
  /** Purposes for which this field is unconditionally required. */
  readonly requiredFor: readonly ProviderPurpose[];
  readonly description: string;
}

export type ProviderDoctorStatus = 'ok' | 'warning' | 'error';

export type ProviderDoctorDetail = string | number | boolean | readonly string[];

export interface ProviderDoctorResult {
  readonly status: ProviderDoctorStatus;
  readonly message: string;
  readonly code?: string;
  readonly details?: Readonly<Record<string, ProviderDoctorDetail>>;
}

interface BuiltInProviderMap {
  readonly blooio: BlooioProvider;
  readonly photon: PhotonProvider;
  readonly sendblue: SendblueProvider<false> | SendblueProvider<true>;
}

export interface ProviderDefinition<
  TName extends BuiltInProviderName = BuiltInProviderName,
  TProvider extends AnyIMessageProvider = BuiltInProviderMap[TName],
> {
  readonly name: TName;
  readonly displayName: string;
  readonly packageName: `@imessage-sdk/${TName}`;
  readonly description: string;
  /** Base normalized capabilities before optional account-gated settings are applied. */
  readonly capabilities: IMessageCapabilities;
  readonly fields: readonly ProviderFieldDefinition[];
  readonly create: (values: ProviderValues) => TProvider;
  /** Performs only non-mutating checks. It never sends a message or changes provider state. */
  readonly doctor: (values: ProviderValues) => Promise<ProviderDoctorResult>;
}

export type ProviderRegistry = {
  readonly [TName in BuiltInProviderName]: ProviderDefinition<TName, BuiltInProviderMap[TName]>;
};

function optionalString(
  provider: BuiltInProviderName,
  values: ProviderValues,
  key: string,
): string | undefined {
  const value = values[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidValue(provider, key, 'a non-empty string');
  }
  return value;
}

function optionalBoolean(
  provider: BuiltInProviderName,
  values: ProviderValues,
  key: string,
): boolean | undefined {
  const value = values[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw invalidValue(provider, key, 'a boolean');
  return value;
}

function optionalPositiveNumber(
  provider: BuiltInProviderName,
  values: ProviderValues,
  key: string,
): number | undefined {
  const value = values[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw invalidValue(provider, key, 'a positive finite number');
  }
  return value;
}

function invalidValue(
  provider: BuiltInProviderName,
  key: string,
  expected: string,
): ValidationError {
  return new ValidationError(`${provider}.${key} must be ${expected}.`, {
    provider,
    code: 'invalid_provider_configuration',
  });
}

function createBlooio(values: ProviderValues): BlooioProvider {
  const apiKey = optionalString('blooio', values, 'apiKey');
  const sender = optionalString('blooio', values, 'sender');
  const webhookSecret = optionalString('blooio', values, 'webhookSecret');
  const baseUrl = optionalString('blooio', values, 'baseUrl');

  return blooio({
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(sender === undefined
      ? {}
      : {
          sender: {
            kind: sender.includes('@') ? ('email' as const) : ('phone' as const),
            value: sender,
          },
        }),
    ...(webhookSecret === undefined ? {} : { webhookSecret }),
    ...(baseUrl === undefined ? {} : { baseUrl }),
  });
}

function createPhoton(values: ProviderValues): PhotonProvider {
  const projectId = optionalString('photon', values, 'projectId');
  const projectSecret = optionalString('photon', values, 'projectSecret');
  const phone = optionalString('photon', values, 'phone');
  const webhookSecret = optionalString('photon', values, 'webhookSecret');
  const timeout = optionalPositiveNumber('photon', values, 'timeout');
  const retry = optionalBoolean('photon', values, 'retry');

  return photon({
    ...(projectId === undefined ? {} : { projectId }),
    ...(projectSecret === undefined ? {} : { projectSecret }),
    ...(phone === undefined ? {} : { phone }),
    ...(webhookSecret === undefined ? {} : { webhookSecret }),
    ...(timeout === undefined ? {} : { timeout }),
    ...(retry === undefined ? {} : { retry }),
  });
}

function createSendblue(values: ProviderValues): SendblueProvider<false> | SendblueProvider<true> {
  const apiKey = optionalString('sendblue', values, 'apiKey');
  const apiSecret = optionalString('sendblue', values, 'apiSecret');
  const fromNumber = optionalString('sendblue', values, 'fromNumber');
  const webhookSecret = optionalString('sendblue', values, 'webhookSecret');
  const baseUrl = optionalString('sendblue', values, 'baseUrl');
  const markReadEnabled = optionalBoolean('sendblue', values, 'markReadEnabled') ?? false;
  const options = {
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(apiSecret === undefined ? {} : { apiSecret }),
    ...(fromNumber === undefined ? {} : { fromNumber }),
    ...(webhookSecret === undefined ? {} : { webhookSecret }),
    ...(baseUrl === undefined ? {} : { baseUrl }),
  };

  return markReadEnabled
    ? sendblue({ ...options, markReadEnabled: true })
    : sendblue({ ...options, markReadEnabled: false });
}

function redactSecrets(
  message: string,
  values: ProviderValues,
  secretKeys: readonly string[],
): string {
  let redacted = message;
  for (const key of secretKeys) {
    const value = values[key];
    if (typeof value === 'string' && value.length > 0) {
      redacted = redacted.split(value).join('[REDACTED]');
    }
  }
  return redacted;
}

function doctorError(
  error: unknown,
  values: ProviderValues,
  secretKeys: readonly string[],
): ProviderDoctorResult {
  const message =
    error instanceof Error ? error.message : 'The provider doctor check failed unexpectedly.';
  return {
    status: 'error',
    message: redactSecrets(message, values, secretKeys),
    ...(error instanceof IMessageSDKError && error.code !== undefined ? { code: error.code } : {}),
  };
}

async function doctorBlooio(values: ProviderValues): Promise<ProviderDoctorResult> {
  let provider: BlooioProvider | undefined;
  try {
    provider = createBlooio(values);
    const numbers = await provider.numbers.list();
    const activeNumbers = numbers.filter((number) => number.active);
    const sender = optionalString('blooio', values, 'sender');
    if (sender !== undefined && !activeNumbers.some((number) => number.phoneNumber === sender)) {
      return {
        status: 'error',
        code: 'configured_sender_not_active',
        message: 'The configured Blooio sender is not an active number for this API key.',
        details: { sender, activeNumbers: activeNumbers.map((number) => number.phoneNumber) },
      };
    }
    if (activeNumbers.length === 0) {
      return {
        status: 'warning',
        code: 'no_active_numbers',
        message: 'Blooio credentials are valid, but the account has no active linked numbers.',
        details: { linkedNumberCount: numbers.length, activeNumberCount: 0 },
      };
    }
    return {
      status: 'ok',
      message: 'Blooio credentials and active line access were verified.',
      details: {
        linkedNumberCount: numbers.length,
        activeNumberCount: activeNumbers.length,
        activeNumbers: activeNumbers.map((number) => number.phoneNumber),
      },
    };
  } catch (error) {
    return doctorError(error, values, ['apiKey', 'webhookSecret']);
  } finally {
    await provider?.close?.();
  }
}

async function doctorPhoton(values: ProviderValues): Promise<ProviderDoctorResult> {
  let provider: PhotonProvider | undefined;
  try {
    provider = createPhoton(values);
    const line = await provider.connection.getLine();
    return {
      status: 'ok',
      message: 'Photon project credentials and line access were verified.',
      details: {
        phone: line.phone,
        instanceId: line.instanceId,
        lineType: line.type,
      },
    };
  } catch (error) {
    return doctorError(error, values, ['projectSecret', 'webhookSecret']);
  } finally {
    try {
      await provider?.close?.();
    } catch {
      // A failed lazy connection can also reject during cleanup. The original
      // diagnostic above is more useful and must remain the doctor result.
    }
  }
}

async function doctorSendblue(values: ProviderValues): Promise<ProviderDoctorResult> {
  try {
    createSendblue(values);
    const required = ['apiKey', 'apiSecret', 'fromNumber'] as const;
    const missing = required.filter((key) => values[key] === undefined);
    if (missing.length > 0) {
      return {
        status: 'error',
        code: 'missing_provider_configuration',
        message: `Sendblue doctor requires: ${missing.join(', ')}.`,
      };
    }
    const fromNumber = optionalString('sendblue', values, 'fromNumber');
    if (fromNumber === undefined || !/^\+[1-9]\d{6,14}$/u.test(fromNumber)) {
      return {
        status: 'error',
        code: 'invalid_phone_number',
        message: 'The configured Sendblue from number must be an E.164 phone number.',
      };
    }
    return {
      status: 'warning',
      code: 'remote_credentials_not_verified',
      message:
        'Sendblue configuration is complete, but the SDK exposes no non-mutating identity endpoint for remote credential verification.',
      details: {
        fromNumber,
        markReadEnabled: optionalBoolean('sendblue', values, 'markReadEnabled') ?? false,
      },
    };
  } catch (error) {
    return doctorError(error, values, ['apiKey', 'apiSecret', 'webhookSecret']);
  }
}

export const providerRegistry: ProviderRegistry = {
  blooio: {
    name: 'blooio',
    displayName: 'Blooio',
    packageName: '@imessage-sdk/blooio',
    description: 'Blooio API v2 hosted iMessage provider.',
    capabilities: BLOOIO_CAPABILITIES,
    fields: [
      {
        key: 'apiKey',
        label: 'API key',
        kind: 'secret',
        env: 'BLOOIO_API_KEY',
        requiredFor: ['api', 'doctor'],
        description: 'Bearer credential for Blooio API operations.',
      },
      {
        key: 'sender',
        label: 'Sender',
        kind: 'identity',
        env: 'BLOOIO_FROM_NUMBER',
        requiredFor: [],
        description: 'Linked phone number or email address used as the outbound sender.',
      },
      {
        key: 'webhookSecret',
        label: 'Webhook secret',
        kind: 'secret',
        env: 'BLOOIO_WEBHOOK_SECRET',
        requiredFor: ['webhook'],
        description: 'HMAC secret used to verify Blooio webhook requests.',
      },
      {
        key: 'baseUrl',
        label: 'API base URL',
        kind: 'setting',
        requiredFor: [],
        description: 'Trusted Blooio API endpoint override.',
      },
    ],
    create: createBlooio,
    doctor: doctorBlooio,
  },
  photon: {
    name: 'photon',
    displayName: 'Photon Cloud',
    packageName: '@imessage-sdk/photon',
    description: 'Photon provider backed by a Spectrum Cloud project.',
    capabilities: PHOTON_CAPABILITIES,
    fields: [
      {
        key: 'projectId',
        label: 'Project ID',
        kind: 'identity',
        env: 'PHOTON_PROJECT_ID',
        requiredFor: ['api', 'doctor'],
        description: 'Spectrum Cloud project identifier.',
      },
      {
        key: 'projectSecret',
        label: 'Project secret',
        kind: 'secret',
        env: 'PHOTON_PROJECT_SECRET',
        requiredFor: ['api', 'doctor'],
        description: 'Spectrum Cloud project credential.',
      },
      {
        key: 'phone',
        label: 'Phone number',
        kind: 'identity',
        env: 'PHOTON_PHONE_NUMBER',
        requiredFor: [],
        description: 'Dedicated line selector; optional when the project resolves one line.',
      },
      {
        key: 'webhookSecret',
        label: 'Webhook secret',
        kind: 'secret',
        env: 'PHOTON_WEBHOOK_SECRET',
        requiredFor: ['webhook'],
        description: 'HMAC secret used to verify Spectrum webhook requests.',
      },
      {
        key: 'timeout',
        label: 'Request timeout',
        kind: 'setting',
        requiredFor: [],
        description: 'Positive timeout forwarded to the Photon client.',
      },
      {
        key: 'retry',
        label: 'Retry enabled',
        kind: 'setting',
        requiredFor: [],
        description: 'Whether the Photon transport may retry eligible upstream operations.',
      },
    ],
    create: createPhoton,
    doctor: doctorPhoton,
  },
  sendblue: {
    name: 'sendblue',
    displayName: 'Sendblue',
    packageName: '@imessage-sdk/sendblue',
    description: 'Sendblue API v2 hosted iMessage provider.',
    capabilities: SENDBLUE_CAPABILITIES,
    fields: [
      {
        key: 'apiKey',
        label: 'API key',
        kind: 'secret',
        env: 'SENDBLUE_API_KEY',
        requiredFor: ['api', 'doctor'],
        description: 'Sendblue API key ID; handled as a secret credential.',
      },
      {
        key: 'apiSecret',
        label: 'API secret',
        kind: 'secret',
        env: 'SENDBLUE_API_SECRET',
        requiredFor: ['api', 'doctor'],
        description: 'Sendblue API secret key.',
      },
      {
        key: 'fromNumber',
        label: 'From number',
        kind: 'identity',
        env: 'SENDBLUE_FROM_NUMBER',
        requiredFor: ['api', 'webhook', 'doctor'],
        description: 'E.164 Sendblue line used for API calls and account-wide webhook filtering.',
      },
      {
        key: 'webhookSecret',
        label: 'Webhook secret',
        kind: 'secret',
        env: 'SENDBLUE_WEBHOOK_SECRET',
        requiredFor: ['webhook'],
        description: 'Shared secret expected in the sb-signing-secret webhook header.',
      },
      {
        key: 'markReadEnabled',
        label: 'Mark read enabled',
        kind: 'setting',
        requiredFor: [],
        description: 'Enable only after Sendblue activates manual mark-read for the account.',
      },
      {
        key: 'baseUrl',
        label: 'API base URL',
        kind: 'setting',
        requiredFor: [],
        description: 'Trusted Sendblue API endpoint override.',
      },
    ],
    create: createSendblue,
    doctor: doctorSendblue,
  },
};

export function createProvider<TName extends BuiltInProviderName>(
  name: TName,
  values: ProviderValues = {},
): BuiltInProviderMap[TName] {
  return providerRegistry[name].create(values) as BuiltInProviderMap[TName];
}
