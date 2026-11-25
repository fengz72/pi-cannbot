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
import { setRequestImpl, type HttpRequestOptions } from "../src/http.ts";

function withoutTransport(t: TestContext): void {
  t.after(() => setRequestImpl(undefined));
}

function jsonResponse(body: unknown, status = 200): { status: number; text: string } {
  return { status, text: JSON.stringify(body) };
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
  withoutTransport(t);
  let captured: HttpRequestOptions | undefined;
  setRequestImpl(async (options) => {
    captured = options;
    return jsonResponse({ accessToken: "access-token", expiresIn: 3600 });
  });

  const before = Date.now();
  const credentials = await authenticate("vk-abc");

  assert.equal(captured?.method, "POST");
  assert.equal(captured?.url, "https://cannbot.hicann.cn/cannbot/api/auth/authenticate");
  assert.equal(captured?.headers["x-api-vkey"], "vk-abc");
  assert.equal(captured?.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(String(captured?.body)), { type: "cli", mac: primaryMac() });
  assert.equal(captured?.timeoutMs, 8_000);

  assert.equal(credentials.refresh, "vk-abc");
  assert.equal(credentials.access, "access-token");
  // 3600s minus the 5 minute safety margin, compared in milliseconds.
  const expected = before + 3_600_000 - 300_000;
  assert.ok(credentials.expires >= expected - 1000, `expires ${credentials.expires} < ${expected}`);
  assert.ok(credentials.expires <= Date.now() + 3_600_000 - 300_000 + 1000);
});

test("authenticate falls back to a one day lifetime without expiresIn", async (t) => {
  withoutTransport(t);
  setRequestImpl(async () => jsonResponse({ accessToken: "t" }));
  const before = Date.now();
  const credentials = await authenticate("vk-abc");
  assert.ok(credentials.expires > before + 23 * 3600 * 1000);
});

test("authenticate never returns an already-expired credential", async (t) => {
  withoutTransport(t);
  setRequestImpl(async () => jsonResponse({ accessToken: "t", expiresIn: 60 }));
  const before = Date.now();
  const credentials = await authenticate("vk-abc");
  assert.ok(credentials.expires > before, `expires ${credentials.expires} <= ${before}`);
  assert.ok(credentials.expires <= Date.now() + 60_000);
});

test("authenticate reports an HTTP failure", async (t) => {
  withoutTransport(t);
  setRequestImpl(async () => ({ status: 401, text: '{"message":"Access Token required."}' }));
  await assert.rejects(() => authenticate("vk-abc"), /HTTP 401/);
});

test("authenticate rejects a response without an access token", async (t) => {
  withoutTransport(t);
  setRequestImpl(async () => jsonResponse({ expiresIn: 60 }));
  await assert.rejects(() => authenticate("vk-abc"), /no accessToken/);
});

test("authenticate rejects a non-JSON response", async (t) => {
  withoutTransport(t);
  setRequestImpl(async () => ({ status: 200, text: "<html>proxy</html>" }));
  await assert.rejects(() => authenticate("vk-abc"), /not JSON/);
});

test("login prompts for the VK and normalizes it", async (t) => {
  withoutTransport(t);
  let header: string | undefined;
  setRequestImpl(async (options) => {
    header = options.headers["x-api-vkey"];
    return jsonResponse({ accessToken: "t", expiresIn: 60 });
  });

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
  withoutTransport(t);
  let header: string | undefined;
  setRequestImpl(async (options) => {
    header = options.headers["x-api-vkey"];
    return jsonResponse({ accessToken: "fresh", expiresIn: 60 });
  });

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
