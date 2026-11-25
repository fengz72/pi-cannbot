import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import {
  authenticate,
  getApiKey,
  login,
  normalizeVk,
  primaryMac,
  refreshToken,
} from "../src/auth.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function withFetch(t: TestContext, impl: typeof fetch): void {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  t.after(() => {
    globalThis.fetch = original;
  });
}

test("normalizeVk trims and rejects unusable values", () => {
  assert.equal(normalizeVk("  vk-abc\n"), "vk-abc");
  assert.throws(() => normalizeVk("   "), /required/);
  assert.throws(() => normalizeVk("vk-a b"), /HTTP header/);
});

test("primaryMac returns a MAC-shaped string", () => {
  assert.match(primaryMac(), /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i);
});

test("authenticate exchanges the VK and returns millisecond expiry", async (t) => {
  let captured: { url: string; init: RequestInit } | undefined;
  withFetch(t, (async (input: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(input), init: init ?? {} };
    return jsonResponse({ accessToken: "access-token", expiresIn: 3600 });
  }) as typeof fetch);

  const before = Date.now();
  const credentials = await authenticate("vk-abc");

  assert.equal(captured?.init.method, "POST");
  assert.equal(captured?.url, "https://cannbot.hicann.cn/cannbot/api/auth/authenticate");
  const headers = new Headers(captured?.init.headers);
  assert.equal(headers.get("x-api-vkey"), "vk-abc");
  assert.equal(headers.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(captured?.init.body)), { type: "cli", mac: primaryMac() });

  assert.equal(credentials.refresh, "vk-abc");
  assert.equal(credentials.access, "access-token");
  // 3600s minus the 5 minute safety margin, compared in milliseconds.
  const expected = before + 3_600_000 - 300_000;
  assert.ok(credentials.expires >= expected - 1000, `expires ${credentials.expires} < ${expected}`);
  assert.ok(credentials.expires <= Date.now() + 3_600_000 - 300_000 + 1000);
});

test("authenticate falls back to a one day lifetime without expiresIn", async (t) => {
  withFetch(t, (async () => jsonResponse({ accessToken: "t" })) as typeof fetch);
  const before = Date.now();
  const credentials = await authenticate("vk-abc");
  assert.ok(credentials.expires > before + 23 * 3600 * 1000);
});

test("authenticate reports an HTTP failure", async (t) => {
  withFetch(t, (async () => new Response('{"message":"Access Token required."}', { status: 401 })) as typeof fetch);
  await assert.rejects(() => authenticate("vk-abc"), /HTTP 401/);
});

test("authenticate rejects a response without an access token", async (t) => {
  withFetch(t, (async () => jsonResponse({ expiresIn: 60 })) as typeof fetch);
  await assert.rejects(() => authenticate("vk-abc"), /no accessToken/);
});

test("login prompts for the VK and normalizes it", async (t) => {
  let header: string | null = null;
  withFetch(t, (async (_input: string | URL | Request, init?: RequestInit) => {
    header = new Headers(init?.headers).get("x-api-vkey");
    return jsonResponse({ accessToken: "t", expiresIn: 60 });
  }) as typeof fetch);

  const credentials = await login({
    onAuth() {},
    onDeviceCode() {},
    onSelect: async () => undefined,
    onPrompt: async (prompt) => {
      assert.match(prompt.message, /Virtual Key/);
      return "  vk-xyz \n";
    },
  });

  assert.equal(header, "vk-xyz");
  assert.equal(credentials.refresh, "vk-xyz");
});

test("refreshToken reuses the stored refresh value as the VK", async (t) => {
  let header: string | null = null;
  withFetch(t, (async (_input: string | URL | Request, init?: RequestInit) => {
    header = new Headers(init?.headers).get("x-api-vkey");
    return jsonResponse({ accessToken: "fresh", expiresIn: 60 });
  }) as typeof fetch);

  const credentials = await refreshToken(
    { refresh: "vk-stored", access: "stale", expires: 0 },
    new AbortController().signal,
  );

  assert.equal(header, "vk-stored");
  assert.equal(credentials.access, "fresh");
  assert.equal(credentials.refresh, "vk-stored");
});

test("getApiKey returns the access token", () => {
  assert.equal(getApiKey({ refresh: "vk", access: "token", expires: 0 }), "token");
});
