/**
 * CANNBOT authentication.
 *
 * CANNBOT has no OAuth token endpoint. A Virtual Key (VK) is exchanged for a
 * short-lived access token by `POST /cannbot/api/auth/authenticate`; the VK is
 * kept as the credential's `refresh` value so Pi can repeat the exchange.
 *
 * The gateway validates both credentials on every request:
 *   - VK alone    -> 401 {"message":"Access Token required."}
 *   - Bearer alone -> 401 {"message":"Virtual Key is required."}
 */

import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai/compat";
import { networkInterfaces } from "node:os";

import { AUTH_TIMEOUT_MS, AUTH_URL, EXPIRY_MARGIN_MS } from "./constants.ts";
import { requestText } from "./http.ts";

/** Fallback lifetime when the server omits or corrupts `expiresIn`. */
const DEFAULT_EXPIRES_IN_SECONDS = 86_400;

/** Printable ASCII without spaces, the only characters a header may carry. */
const LEGAL_HEADER_VALUE = /^[\x21-\x7E]+$/;

export function primaryMac(): string {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const info of interfaces[name] ?? []) {
      if (!info.internal && info.mac && info.mac !== "00:00:00:00:00:00") {
        return info.mac;
      }
    }
  }
  return "00:00:00:00:00:00";
}

/**
 * Trim and validate a VK. Pi sends this value in an HTTP header, so anything
 * outside printable ASCII is rejected where the user can correct it.
 */
export function normalizeVk(raw: string): string {
  const vk = raw.trim();
  if (vk === "") {
    throw new Error("CANNBOT Virtual Key is required");
  }
  if (!LEGAL_HEADER_VALUE.test(vk)) {
    throw new Error("CANNBOT Virtual Key contains characters no HTTP header can carry");
  }
  return vk;
}

function snippet(text: string): string {
  const trimmed = text.trim();
  return trimmed === "" ? "" : ` ${trimmed.slice(0, 200)}`;
}

/**
 * Exchange a VK for an access token.
 *
 * `expires` is epoch **milliseconds** because Pi compares it with `Date.now()`;
 * the server's `expiresIn` is in seconds.
 */
export async function authenticate(vk: string, signal?: AbortSignal): Promise<OAuthCredentials> {
  const response = await requestText({
    method: "POST",
    url: AUTH_URL,
    headers: {
      "content-type": "application/json",
      "x-api-vkey": vk,
    },
    body: JSON.stringify({ type: "cli", mac: primaryMac() }),
    signal,
    timeoutMs: AUTH_TIMEOUT_MS,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`CANNBOT authentication failed: HTTP ${response.status}${snippet(response.text)}`);
  }

  let data: { accessToken?: unknown; expiresIn?: unknown };
  try {
    data = JSON.parse(response.text) as { accessToken?: unknown; expiresIn?: unknown };
  } catch {
    throw new Error("CANNBOT authentication failed: response is not JSON");
  }

  if (typeof data.accessToken !== "string" || data.accessToken === "") {
    throw new Error("CANNBOT authentication failed: response has no accessToken");
  }

  const expiresIn =
    typeof data.expiresIn === "number" && Number.isFinite(data.expiresIn) && data.expiresIn > 0
      ? data.expiresIn
      : DEFAULT_EXPIRES_IN_SECONDS;

  const lifetimeMs = expiresIn * 1000;
  // A margin larger than the lifetime would keep the token permanently expired.
  const margin = Math.min(EXPIRY_MARGIN_MS, Math.floor(lifetimeMs / 2));
  return {
    refresh: vk,
    access: data.accessToken,
    expires: Date.now() + lifetimeMs - margin,
  };
}

/** Pi `/login` flow: ask for the VK, then exchange it. */
export async function login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const raw = await callbacks.onPrompt({
    message: "CANNBOT Virtual Key (vkey):",
    placeholder: "vk-...",
  });
  return authenticate(normalizeVk(raw), callbacks.signal);
}

/** Pi refresh flow: the stored `refresh` value is the VK itself. */
export async function refreshToken(credentials: OAuthCredentials, signal: AbortSignal): Promise<OAuthCredentials> {
  return authenticate(normalizeVk(credentials.refresh), signal);
}

/** The access token becomes the `Authorization: Bearer` value. */
export function getApiKey(credentials: OAuthCredentials): string {
  return credentials.access;
}
