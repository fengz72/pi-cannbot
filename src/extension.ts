/** Pi extension registering CANNBOT as a native provider. */

import { isModelType, type Provider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  authenticate,
  buildModel,
  fetchCatalog,
  GATEWAY_BASE_URL,
  PROVIDER_ID,
  PROVIDER_NAME,
  type CannbotModel,
} from "./cannbot.ts";
import { cannbotFetch } from "./http.ts";

export function createCannbotProvider(fetchFn: typeof fetch = cannbotFetch): Provider {
  const api = openAICompletionsApi();
  let liveModels: readonly CannbotModel[] = [];

  return {
    id: PROVIDER_ID,
    name: PROVIDER_NAME,
    baseUrl: GATEWAY_BASE_URL,
    auth: {
      oauth: {
        name: PROVIDER_NAME,
        isSubscription: false,
        login: async (interaction) => {
          const raw = await interaction.prompt({
            type: "secret",
            message: "CANNBOT Virtual Key (vkey):",
            placeholder: "vk-...",
          });
          return authenticate(raw, interaction.signal, fetchFn);
        },
        refresh: (credential, signal) => authenticate(credential.refresh, signal, fetchFn),
        toAuth: async (credential) => ({
          apiKey: credential.access,
          headers: { "x-api-vkey": credential.refresh },
        }),
      },
    },
    getModels: () => liveModels,
    refreshModels: async (context) => {
      if (context.stored) {
        const restored = context.stored.models
          .filter(
            (model): model is CannbotModel =>
              isModelType(model, "chat") && model.provider === PROVIDER_ID && model.api === "openai-completions",
          )
          .map(buildModel);
        if (
          !(await context.publish({
            update: () => {
              liveModels = restored;
            },
          }))
        ) {
          return;
        }
      }
      if (!context.allowNetwork || context.signal.aborted || context.credential?.type !== "oauth") return;
      const models = await fetchCatalog(context.credential.access, context.signal, fetchFn);
      if (!models || context.signal.aborted) return;
      await context.publish({
        persist: { models, checkedAt: Date.now() },
        update: () => {
          liveModels = models;
        },
      });
    },
    stream: (model, context, options) =>
      api.stream(model, context, { ...options, fetch: options?.fetch ?? fetchFn }),
    streamSimple: (model, context, options) =>
      api.streamSimple(model, context, { ...options, fetch: options?.fetch ?? fetchFn }),
  };
}

export default function piCannbot(pi: ExtensionAPI): void {
  pi.registerProvider(createCannbotProvider());
}
