/**
 * Pi extension entry point.
 *
 * Registers the CANNBOT provider as a native Pi provider: `/login` collects a
 * Virtual Key, Pi stores the exchanged access token in `auth.json`, refreshes
 * it through the same exchange, and `refreshModels` keeps the account's model
 * roster current without a restart.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { getApiKey, login, refreshToken } from "./auth.ts";
import { fetchCatalog } from "./catalog.ts";
import { GATEWAY_BASE_URL, PROVIDER_ID, PROVIDER_NAME } from "./constants.ts";
import { fallbackModels, toModels } from "./models.ts";

export default function piCannbot(pi: ExtensionAPI): void {
  pi.registerProvider(PROVIDER_ID, {
    name: PROVIDER_NAME,
    baseUrl: GATEWAY_BASE_URL,
    api: "openai-completions",
    models: fallbackModels(),
    refreshModels: async (context) => {
      const credential = context.credential;
      if (credential?.type !== "oauth") return fallbackModels();
      const catalog = await fetchCatalog(credential.access, context.signal);
      return catalog === undefined ? fallbackModels() : toModels(catalog);
    },
    oauth: {
      name: PROVIDER_NAME,
      login,
      refreshToken,
      getApiKey,
      // The VK travels in `x-api-vkey` while the access token travels as
      // `Authorization: Bearer`. Both come from the same stored credential, so
      // a refresh rotates them together.
      modifyModels: (models, credentials) =>
        models.map((model) => ({
          ...model,
          headers: { ...model.headers, "x-api-vkey": credentials.refresh },
        })),
    },
  });
}
