/**
 * HTTP transport for the two CANNBOT endpoints.
 *
 * Node's global `fetch` rejects this gateway's certificate chain with
 * `unable to get local issuer certificate`: the server sends a cross-signed
 * `DigiCert Global Root G2` chain, and verifying it needs the roots supplied
 * explicitly. Passing `tls.rootCertificates` as `ca` is the same trust set Node
 * already ships with — it adds no new trust and keeps verification on — and it
 * also picks up any PEM named by the usual `NODE_EXTRA_CA_CERTS` /
 * `SSL_CERT_FILE` variables for corporate proxies.
 */

import { readFileSync } from "node:fs";
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

const EXTRA_CA_VARIABLES = ["NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE"] as const;

function extraCertificates(): string[] {
  const certificates: string[] = [];
  for (const name of EXTRA_CA_VARIABLES) {
    const path = process.env[name];
    if (path === undefined || path === "") continue;
    try {
      certificates.push(readFileSync(path, "utf8"));
    } catch {
      // An unreadable extra CA file is Node's problem to report, not ours.
    }
  }
  return certificates;
}

/** Node's bundled roots plus any configured extra CAs. */
export function trustBundle(): string[] {
  return [...rootCertificates, ...extraCertificates()];
}

/** The real transport: one HTTPS request, no redirect following. */
export const httpsTransport: RequestImpl = (options) =>
  new Promise<HttpResponse>((resolve, reject) => {
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
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          text += chunk;
        });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, text }));
        response.on("error", reject);
      },
    );
    call.on("error", reject);
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
