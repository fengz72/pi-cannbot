/**
 * HTTP transport for CANNBOT.
 *
 * Node's `fetch` rejects this gateway's cross-signed certificate chain. Passing
 * `tls.rootCertificates` as `ca` verifies the same chain Node already trusts,
 * with verification still on, and additional CAs from the environment are
 * merged in for corporate proxies.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { request } from "node:https";
import { rootCertificates } from "node:tls";

export interface HttpRequestOptions {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  timeoutMs: number;
}

export interface HttpResponse {
  status: number;
  text: string;
}

export type RequestImpl = (options: HttpRequestOptions) => Promise<HttpResponse>;

const MAX_RESPONSE_BYTES = 1 << 20;
const EXTRA_CA_VARIABLES = ["NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE"] as const;

function extraCertificates(): string[] {
  const certificates: string[] = [];
  for (const name of EXTRA_CA_VARIABLES) {
    const path = process.env[name];
    if (path === undefined || path === "") continue;
    try {
      certificates.push(readFileSync(path, "utf8"));
    } catch {
      // An unreadable file is Node's to report; the built-in roots still apply.
    }
  }
  return certificates;
}

let cachedBundleKey: string | undefined;
let cachedBundle: string[] | undefined;

/** Node's bundled roots plus any configured extra CAs, cached per environment. */
export function trustBundle(): string[] {
  const key = EXTRA_CA_VARIABLES.map((name) => process.env[name] ?? "").join("\u0000");
  if (cachedBundle === undefined || cachedBundleKey !== key) {
    cachedBundleKey = key;
    cachedBundle = [...rootCertificates, ...extraCertificates()];
  }
  return cachedBundle;
}

/** Opt-in diagnostics; the TUI owns stdout, so only warn when asked. */
export function debugLog(message: string): void {
  if (process.env.PI_CANNBOT_DEBUG === "1") {
    console.warn(`[pi-cannbot] ${message}`);
  }
}

/** One HTTPS request. Redirects are not followed so credentials cannot leak. */
export const httpsTransport: RequestImpl = (options) =>
  new Promise<HttpResponse>((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const target = new URL(options.url);
    const timeout = AbortSignal.timeout(options.timeoutMs);
    const signal = options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout]);
    const headers: Record<string, string> = { "accept-encoding": "identity", ...options.headers };
    if (options.body !== undefined && !hasHeader(headers, "content-length")) {
      headers["content-length"] = String(Buffer.byteLength(options.body));
    }

    const call = request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port === "" ? undefined : target.port,
        path: `${target.pathname}${target.search}`,
        method: options.method,
        headers,
        ca: trustBundle(),
        signal,
      },
      (response) => {
        let text = "";
        let size = 0;
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          size += Buffer.byteLength(chunk);
          if (size > MAX_RESPONSE_BYTES) {
            response.destroy(new Error(`CANNBOT response exceeds ${MAX_RESPONSE_BYTES} bytes`));
            return;
          }
          text += chunk;
        });
        response.on("aborted", () => fail(new Error("CANNBOT response aborted")));
        response.on("error", fail);
        response.on("end", () => {
          if (settled) return;
          settled = true;
          resolve({ status: response.statusCode ?? 0, text });
        });
      },
    );
    call.on("error", fail);
    if (options.body !== undefined) call.write(options.body);
    call.end();
  });

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name);
}

let active: RequestImpl = httpsTransport;

/** Replace the transport. Exists for tests; pass `undefined` to restore. */
export function setRequestImpl(impl: RequestImpl | undefined): void {
  active = impl ?? httpsTransport;
}

export function requestText(options: HttpRequestOptions): Promise<HttpResponse> {
  return active(options);
}

let trustInstalled = false;

let ownRequire: NodeJS.Require | undefined;
function requireFromExtension(): NodeJS.Require {
  if (ownRequire === undefined) {
    ownRequire = createRequire(import.meta.url);
  }
  return ownRequire;
}

type UndiciModule = typeof import("undici");

/** Prefer Pi's undici so the dispatcher and the running fetch share one copy. */
function loadUndici(): UndiciModule | undefined {
  const entry = process.argv[1];
  if (entry !== undefined) {
    try {
      const requireFromPi = createRequire(entry);
      return requireFromPi(requireFromPi.resolve("undici")) as UndiciModule;
    } catch {
      // Fall through to this package's dependency.
    }
  }
  try {
    return requireFromExtension()("undici") as UndiciModule;
  } catch {
    return undefined;
  }
}

const CANNBOT_HOST = "cannbot.hicann.cn";

export function requestHost(input: unknown): string | undefined {
  try {
    if (typeof input === "string" || input instanceof URL) {
      return new URL(String(input)).hostname;
    }
    if (typeof input === "object" && input !== null && "url" in input) {
      return new URL(String((input as { url: unknown }).url)).hostname;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Make inference trust the gateway chain.
 *
 * The AI SDK attaches its own dispatcher to every request and ignores the
 * global one, so `fetch` is wrapped and the dispatcher replaced only for the
 * CANNBOT host. Other hosts keep their dispatcher, including any proxy setup.
 */
export async function installFetchTrust(): Promise<void> {
  if (trustInstalled) return;
  trustInstalled = true;
  if (process.env.PI_CANNBOT_NO_FETCH_TRUST === "1") return;

  const undici = loadUndici();
  if (undici === undefined) {
    debugLog("undici unavailable; inference may reject the TLS chain");
    return;
  }

  try {
    const dispatcher = new undici.EnvHttpProxyAgent({
      allowH2: false,
      proxyTunnel: true,
      headersTimeout: 0,
      bodyTimeout: 0,
      connect: { ca: trustBundle() },
    });
    const original = globalThis.fetch;
    globalThis.fetch = ((input: unknown, init?: RequestInit) => {
      if (requestHost(input) !== CANNBOT_HOST) return original(input as never, init);
      return original(input as never, { ...(init ?? {}), dispatcher } as RequestInit);
    }) as typeof fetch;
  } catch (error) {
    debugLog(`fetch trust setup failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}
