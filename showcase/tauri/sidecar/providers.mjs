// What the setup guide offers to connect: sign-in cards, and a card per API key with where to get one.
// A provider that takes a plan key and a pay-per-token key (Kimi, Xiaomi) gets a card for each: they're
// stored apart, and each works only on its own endpoint.

import { apiKeyStorageKeys, getModelsForProvider, providerStorageKeys } from '@kenkaiiii/gg-core';

/** Roamies reads screenshots, so a model that can't see images is never offered, picked or kept. */
export const seesImages = (provider, id) => !!getModelsForProvider(provider).find((m) => m.id === id)?.supportsImages;

/** Everywhere a provider's sign-in and keys are saved, so removing it from Roamies leaves none behind. */
export const accountKeys = (provider) => [...new Set([...providerStorageKeys(provider), ...apiKeyStorageKeys(provider)])];

// Checked by hand: each opens the provider's own key page (or its console, where keys are made).
export const KEY_LINKS = {
  anthropic: 'https://platform.claude.com/settings/keys', openai: 'https://platform.openai.com/api-keys', gemini: 'https://aistudio.google.com/apikey',
  xai: 'https://console.x.ai/', 'kimi-code': 'https://www.kimi.com/code/console', moonshot: 'https://platform.kimi.ai/console/api-keys',
  glm: 'https://z.ai/manage-apikey/apikey-list', 'glm:api': 'https://z.ai/manage-apikey/apikey-list', minimax: 'https://platform.minimax.io/console/keys', xiaomi: 'https://platform.xiaomimimo.com/',
  'xiaomi-credits': 'https://platform.xiaomimimo.com/', deepseek: 'https://platform.deepseek.com/api_keys', sakana: 'https://console.sakana.ai/',
  openrouter: 'https://openrouter.ai/settings/keys', huggingface: 'https://huggingface.co/settings/tokens',
  // One OpenCode Console makes the keys for both: Go is the subscription, OpenCode the pay-per-token credits.
  'opencode-go': 'https://opencode.ai/console', opencode: 'https://opencode.ai/console',
};
const SIGN_IN_NAMES = { anthropic: ['Claude', 'Anthropic'], openai: ['ChatGPT', 'OpenAI'] };
// Short enough for a one-line card; gg-core's labels ("Token Plan") don't say whose.
const KEY_NAMES = { 'kimi-code': 'Kimi Code', moonshot: 'Moonshot', xiaomi: 'MiMo Plan', 'xiaomi-credits': 'MiMo Credits', 'opencode-go': 'OpenCode Go', opencode: 'OpenCode' };

/** Sign-in cards, in `ids` order; `on(id)`: signed in with that account (not just a key). */
export const signInCards = (ids, on, labels = {}) =>
  ids.map((id) => ({ id, name: SIGN_IN_NAMES[id]?.[0] ?? labels[id] ?? id, company: SIGN_IN_NAMES[id]?.[1] ?? '', connected: !!on(id) }));

// Z.AI: a GLM Coding Plan key and a pay-per-token key look alike, but each works only on its own endpoint (a plan
// key on the pay-per-token one is refused as "insufficient balance", code 1113). gg-core knows only the
// pay-per-token endpoint, so the choice is made here: both kinds are saved under 'glm', with the endpoint they use.
export const GLM_PLAN_URL = 'https://api.z.ai/api/coding/paas/v4', GLM_API_URL = 'https://api.z.ai/api/paas/v4';
const GLM_KINDS = [
  ['glm', 'GLM Plan', 'Uses your GLM Coding Plan quota. Z.AI lists the tools the plan is meant for; this app is not one of them.'],
  ['glm:api', 'Z.AI API', 'Pay-per-token from your Z.AI balance.'],
];
/** For a GLM key kind: the provider, where its key is saved and the endpoint it works on. null for any other id. */
export const keyTarget = (id) => (id === 'glm' ? { provider: 'glm', key: 'glm', baseUrl: GLM_PLAN_URL }
  : id === 'glm:api' ? { provider: 'glm', key: 'glm', baseUrl: GLM_API_URL } : null);
/** Which GLM kind a saved key is, from the endpoint saved with it (none saved: the pay-per-token one it went to). */
export const glmKind = (creds) => (creds?.baseUrl === GLM_PLAN_URL ? 'glm' : 'glm:api');

/** The kinds of key a provider takes, as [storage key, label, billing]; one entry for most providers. */
export const keyKinds = (meta) => (meta.value === 'glm' ? GLM_KINDS : meta.apiKeyVariants?.length > 1
  ? meta.apiKeyVariants.map((v) => [v.key, KEY_NAMES[v.key] ?? v.label, v.billing])
  : [[meta.value, KEY_NAMES[meta.value] ?? meta.apiKeyLabel ?? meta.label, meta.methodDetails?.apikey?.billing ?? '']]);

/** One card per kind of API key; `on(id)`: a key of that kind is saved. `id` is what apiKeyLogin takes. */
export const keyCards = (authProviders, on) =>
  authProviders.filter((p) => p.methods?.includes('apikey'))
    .flatMap((p) => keyKinds(p).map(([id, name, billing]) => ({ id, name, billing, connected: !!on(id), link: KEY_LINKS[id] ?? null })));
