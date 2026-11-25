/**
 * CANNBOT HTTP fetch with Node's bundled CA roots (plus optional extra CAs)
 * and proxy support. Shared across auth, catalog, and model inference.
 */

import { readFileSync } from "node:fs";
import { rootCertificates } from "node:tls";
import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";

export function trustBundle(): string[] {
  const extra = [process.env.NODE_EXTRA_CA_CERTS, process.env.SSL_CERT_FILE]
    .filter((path): path is string => Boolean(path))
    .flatMap((path) => {
      try {
        return [readFileSync(path, "utf8")];
      } catch {
        return [];
      }
    });
  return [...rootCertificates, ...extra];
}

let dispatcher: EnvHttpProxyAgent | undefined;

function getDispatcher(): EnvHttpProxyAgent {
  dispatcher ??= new EnvHttpProxyAgent({
    allowH2: false,
    proxyTunnel: true,
    headersTimeout: 0,
    bodyTimeout: 0,
    connect: { ca: trustBundle() },
  });
  return dispatcher;
}

export const cannbotFetch: typeof fetch = (input, init) =>
  undiciFetch(input as never, { ...init, dispatcher: getDispatcher() } as never) as unknown as Promise<Response>;
