import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { rootCertificates } from "node:tls";

import { requestHost, requestText, setRequestImpl, trustBundle } from "../src/http.ts";

test("trustBundle includes Node's roots", () => {
  const bundle = trustBundle();
  assert.ok(bundle.length >= rootCertificates.length);
});

test("trustBundle picks up NODE_EXTRA_CA_CERTS", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-cannbot-ca-"));
  const pem = join(dir, "extra.pem");
  writeFileSync(pem, "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n");
  const previous = process.env.NODE_EXTRA_CA_CERTS;
  process.env.NODE_EXTRA_CA_CERTS = pem;
  t.after(() => {
    if (previous === undefined) {
      delete process.env.NODE_EXTRA_CA_CERTS;
    } else {
      process.env.NODE_EXTRA_CA_CERTS = previous;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  assert.ok(trustBundle().some((entry) => entry.includes("TEST")));
});

test("requestText routes through the installed transport", async (t) => {
  t.after(() => setRequestImpl(undefined));
  setRequestImpl(async (options) => ({ status: 200, text: options.method }));

  const response = await requestText({
    method: "GET",
    url: "https://example.invalid",
    headers: {},
    timeoutMs: 1000,
  });

  assert.deepEqual(response, { status: 200, text: "GET" });
});

test("requestHost understands strings, URLs, and Request-like objects", () => {
  assert.equal(requestHost("https://cannbot.hicann.cn/x"), "cannbot.hicann.cn");
  assert.equal(requestHost(new URL("https://example.com/y")), "example.com");
  assert.equal(requestHost({ url: "https://cannbot.hicann.cn/z" }), "cannbot.hicann.cn");
  assert.equal(requestHost("not a url"), undefined);
  assert.equal(requestHost(undefined), undefined);
});

test("installFetchTrust does nothing when disabled", async () => {
  const previous = process.env.PI_CANNBOT_NO_FETCH_TRUST;
  process.env.PI_CANNBOT_NO_FETCH_TRUST = "1";
  try {
    const before = globalThis.fetch;
    const { installFetchTrust } = await import("../src/http.ts");
    await installFetchTrust();
    assert.equal(globalThis.fetch, before);
  } finally {
    if (previous === undefined) delete process.env.PI_CANNBOT_NO_FETCH_TRUST;
    else process.env.PI_CANNBOT_NO_FETCH_TRUST = previous;
  }
});
