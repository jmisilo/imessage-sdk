export const BUILT_IN_PROVIDER_NAMES = ['blooio', 'photon', 'sendblue'] as const;

export type BuiltInProviderName = (typeof BUILT_IN_PROVIDER_NAMES)[number];
