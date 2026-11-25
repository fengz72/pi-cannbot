import assert from "node:assert/strict";
import test from "node:test";
import { createModels, InMemoryCredentialStore, InMemoryModelsStore, type Provider } from "@earendil-works/pi-ai";

import { AUTH_URL, CATALOG_URL, GATEWAY_BASE_URL, PROVIDER_ID } from "../src/cannbot.ts";
import register, { createCannbotProvider } from "../src/extension.ts";

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  return ((input: unknown, init?: RequestInit) => Promise.resolve(handler(String(input), init))) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("default export registers the native cannbot provider", () => {
  let registered: Provider | undefined;
  register({
    registerProvider: (provider: Provider) => {
      registered = provider;
    },
  } as never);

  assert.ok(registered !== undefined);
  assert.equal(registered.id, PROVIDER_ID);
  assert.equal(registered.name, "CANNBOT");
  assert.equal(registered.baseUrl, GATEWAY_BASE_URL);
  assert.equal(registered.auth.oauth?.isSubscription, false);
  assert.deepEqual(registered.getModels(), []);
});

test("provider integrates with Pi Models: secret login, dual auth headers, persist, and restore", async () => {
  let catalogCalls = 0;
  let failCatalog = false;

  const fetchImpl = mockFetch((url) => {
    if (url === AUTH_URL) {
      return jsonResponse({ accessToken: "fresh-token", expiresIn: 3600 });
    }
    if (url === CATALOG_URL) {
      catalogCalls++;
      if (failCatalog) return new Response("error", { status: 500 });
      return jsonResponse({
        models: [{ model: "live-model", title: "Live Model", status: 1, contextLength: 8192, maxTokens: 4096 }],
      });
    }
    return new Response("not found", { status: 404 });
  });

  const credentials = new InMemoryCredentialStore();
  const modelsStore = new InMemoryModelsStore();
  const models = createModels({ credentials, modelsStore });
  models.setProvider(createCannbotProvider(fetchImpl));

  // Login prompts with type: "secret" and stores the exchanged OAuth credential.
  let promptType: string | undefined;
  await models.login(PROVIDER_ID, "oauth", {
    prompt: async (prompt) => {
      promptType = prompt.type;
      return "  vk-xyz \n";
    },
    notify() {},
  });
  assert.equal(promptType, "secret");

  // toAuth injects both Bearer apiKey and x-api-vkey header.
  const resolved = await models.getAuth(PROVIDER_ID);
  assert.equal(resolved?.auth.apiKey, "fresh-token");
  assert.deepEqual(resolved?.auth.headers, { "x-api-vkey": "vk-xyz" });

  // Offline refresh must NOT hit the network.
  await models.refresh({ allowNetwork: false });
  assert.equal(catalogCalls, 0);
  assert.deepEqual(models.getModels(PROVIDER_ID), []);

  // Online refresh fetches the catalog once and persists it to modelsStore.
  await models.refresh({ allowNetwork: true });
  assert.equal(catalogCalls, 1);
  assert.deepEqual(
    models.getModels(PROVIDER_ID).map((m) => m.id),
    ["live-model"],
  );

  // A fresh instance (e.g. cold restart / `pi -p`) restores persisted models offline without network calls.
  const coldModels = createModels({ credentials, modelsStore });
  coldModels.setProvider(createCannbotProvider(fetchImpl));
  await coldModels.refresh({ allowNetwork: false });
  assert.equal(catalogCalls, 1);
  assert.deepEqual(
    coldModels.getModels(PROVIDER_ID).map((m) => m.id),
    ["live-model"],
  );

  // A subsequent catalog failure retains the previously persisted/live catalog.
  failCatalog = true;
  await coldModels.refresh({ allowNetwork: true });
  assert.deepEqual(
    coldModels.getModels(PROVIDER_ID).map((m) => m.id),
    ["live-model"],
  );
});

test("streamSimple routes inference through the injected fetch with dual auth headers", async () => {
  let capturedUrl: string | undefined;
  let capturedHeaders: Headers | undefined;

  const sse =
    'data: {"id":"1","object":"chat.completion.chunk","created":0,"model":"deepseek-v4.1-flash","choices":[{"index":0,"delta":{"role":"assistant","content":"hi"},"finish_reason":null}]}\n\n' +
    'data: {"id":"1","object":"chat.completion.chunk","created":0,"model":"deepseek-v4.1-flash","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n' +
    "data: [DONE]\n\n";

  const models = createModels({ credentials: new InMemoryCredentialStore() });
  models.setProvider(
    createCannbotProvider(
      mockFetch((url, init) => {
        if (url === AUTH_URL) {
          return jsonResponse({ accessToken: "access-123", expiresIn: 3600 });
        }
        if (url === CATALOG_URL) {
          return jsonResponse({
            models: [{ model: "deepseek-v4.1-flash", title: "DeepSeek-V4.1-Flash", status: 1 }],
          });
        }
        capturedUrl = url;
        capturedHeaders = new Headers(init?.headers);
        return new Response(sse, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }),
    ),
  );

  await models.login(PROVIDER_ID, "oauth", {
    prompt: async () => "vk-secret",
    notify() {},
  });
  await models.refresh({ allowNetwork: true });

  const model = models.getModel(PROVIDER_ID, "deepseek-v4.1-flash");
  assert.ok(model !== undefined);
  const reply = await models.completeSimple(model, {
    messages: [{ role: "user", content: "hello", timestamp: 0 }],
  });

  assert.equal(capturedUrl, `${GATEWAY_BASE_URL}/chat/completions`);
  assert.equal(capturedHeaders?.get("authorization"), "Bearer access-123");
  assert.equal(capturedHeaders?.get("x-api-vkey"), "vk-secret");
  assert.equal(reply.stopReason, "stop");
  assert.deepEqual(reply.content, [{ type: "text", text: "hi" }]);
});
