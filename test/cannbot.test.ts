import assert from "node:assert/strict";
import test from "node:test";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";

import {
  AUTH_URL,
  authenticate,
  buildModel,
  CATALOG_URL,
  fetchCatalog,
  parseCatalog,
  primaryMac,
} from "../src/cannbot.ts";

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  return ((input: unknown, init?: RequestInit) => Promise.resolve(handler(String(input), init))) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("primaryMac returns a MAC-shaped string", () => {
  assert.match(primaryMac(), /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i);
});

test("authenticate trims VK, calls auth endpoint, and returns exact expiry", async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;

  const before = Date.now();
  const cred = await authenticate(
    "  vk-abc\n",
    undefined,
    mockFetch((url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return jsonResponse({ accessToken: "access-token", expiresIn: 3600 });
    }),
  );

  assert.equal(capturedUrl, AUTH_URL);
  assert.equal(capturedInit?.method, "POST");
  assert.equal(capturedInit?.redirect, "error");
  assert.deepEqual(capturedInit?.headers, {
    "content-type": "application/json",
    "x-api-vkey": "vk-abc",
  });
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), { type: "cli", mac: primaryMac() });

  assert.equal(cred.type, "oauth");
  assert.equal(cred.refresh, "vk-abc");
  assert.equal(cred.access, "access-token");
  assert.ok(cred.expires >= before + 3_600_000 - 1000);
  assert.ok(cred.expires <= Date.now() + 3_600_000 + 1000);
});

test("authenticate falls back to a one day lifetime without expiresIn", async () => {
  const before = Date.now();
  const cred = await authenticate("vk-abc", undefined, mockFetch(() => jsonResponse({ accessToken: "t" })));
  assert.ok(cred.expires >= before + 86_400_000 - 1000);
});

test("authenticate rejects empty VK, HTTP failures, bad JSON, and missing accessToken", async () => {
  await assert.rejects(() => authenticate("   "), /required/);
  await assert.rejects(
    () => authenticate("vk-abc", undefined, mockFetch(() => new Response("denied", { status: 401 }))),
    /HTTP 401 denied/,
  );
  await assert.rejects(
    () => authenticate("vk-abc", undefined, mockFetch(() => new Response("<html>", { status: 200 }))),
    SyntaxError,
  );
  await assert.rejects(
    () => authenticate("vk-abc", undefined, mockFetch(() => jsonResponse({ expiresIn: 60 }))),
    /no accessToken/,
  );
});

test("parseCatalog deduplicates, drops inactive rows, and fills defaults", () => {
  const models = parseCatalog([
    { model: "deepseek-v4.1-flash", title: "DeepSeek-V4.1-Flash", status: 1, contextLength: 1000.9, maxTokens: 393_216 },
    { model: "deepseek-v4.1-flash", title: "Duplicate", status: 1, contextLength: 5 },
    { model: "disabled", status: 0 },
    { model: "  ", status: 1 },
    { model: "qwen3.8-max", status: 1, contextLength: 0 },
  ]);

  assert.deepEqual(
    models.map((m) => m.id),
    ["deepseek-v4.1-flash", "qwen3.8-max"],
  );
  assert.equal(models[0]?.name, "DeepSeek-V4.1-Flash");
  assert.equal(models[0]?.contextWindow, 1000);
  assert.equal(models[0]?.maxTokens, 393_216);
  assert.deepEqual(models[0]?.input, ["text", "image"]);
  assert.deepEqual(models[0]?.compat, {
    thinkingFormat: "deepseek",
    requiresReasoningContentOnAssistantMessages: true,
  });

  assert.equal(models[1]?.name, "qwen3.8-max");
  assert.equal(models[1]?.contextWindow, 1_048_576);
  assert.equal(models[1]?.maxTokens, 131_072);
  assert.equal(models[1]?.compat, undefined);
});

test("fetchCatalog authenticates with Bearer token and maps models", async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;

  const models = await fetchCatalog(
    "the-token",
    undefined,
    mockFetch((url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return jsonResponse({
        models: [{ model: "glm-5.3-flash", title: "GLM-5.3-Flash", status: 1, contextLength: 1_048_576, maxTokens: 131_072 }],
        total: 1,
        page: 1,
        size: 100,
        totalPages: 1,
      });
    }),
  );

  assert.equal(capturedUrl, CATALOG_URL);
  assert.equal(capturedInit?.redirect, "error");
  assert.deepEqual(capturedInit?.headers, { authorization: "Bearer the-token" });
  assert.equal(models?.length, 1);
  assert.equal(models?.[0]?.id, "glm-5.3-flash");
  assert.deepEqual(models?.[0]?.input, ["text", "image"]);
});

test("fetchCatalog returns undefined on empty, HTTP, JSON, or transport failure", async () => {
  assert.equal(
    await fetchCatalog("t", undefined, mockFetch(() => jsonResponse({ models: [{ model: "x", status: 0 }] }))),
    undefined,
  );
  assert.equal(
    await fetchCatalog("t", undefined, mockFetch(() => new Response("nope", { status: 401 }))),
    undefined,
  );
  assert.equal(
    await fetchCatalog("t", undefined, mockFetch(() => new Response("<html>", { status: 200 }))),
    undefined,
  );
  assert.equal(
    await fetchCatalog(
      "t",
      undefined,
      mockFetch(() => {
        throw new Error("offline");
      }),
    ),
    undefined,
  );
});

test("buildModel sets vision, compat, thinking levels, and zero cost", () => {
  const ds = buildModel({ id: "deepseek-v4.1-flash", name: "DS" });
  const qwen = buildModel({ id: "qwen3.8-max", name: "Qwen" });
  const glm = buildModel({ id: "glm-5.3-flash", name: "GLM" });
  const custom = buildModel({ id: "custom", name: "Custom" });

  assert.deepEqual(ds.input, ["text", "image"]);
  assert.deepEqual(qwen.input, ["text", "image"]);
  assert.deepEqual(buildModel({ id: "deepseek-v4-pro", name: "DS Pro" }).input, ["text"]);
  assert.deepEqual(ds.compat, {
    thinkingFormat: "deepseek",
    requiresReasoningContentOnAssistantMessages: true,
  });
  assert.deepEqual(getSupportedThinkingLevels(ds), ["off", "low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(getSupportedThinkingLevels(qwen), ["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
  assert.equal(qwen.thinkingLevelMap?.off, "none");
  assert.deepEqual(getSupportedThinkingLevels(glm), ["low", "high", "max"]);
  assert.equal(clampThinkingLevel(glm, "off"), "low");
  assert.equal(clampThinkingLevel(glm, "medium"), "high");
  assert.equal(clampThinkingLevel(glm, "xhigh"), "max");
  assert.deepEqual(custom.cost, {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  });
});
