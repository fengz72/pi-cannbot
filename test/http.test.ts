import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { rootCertificates } from "node:tls";

import { requestText, setRequestImpl, trustBundle } from "../src/http.ts";

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
