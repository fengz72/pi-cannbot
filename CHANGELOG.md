# Changelog

## [0.1.5]

- Register through Pi's native provider API: `auth.oauth.toAuth` returns the
  access token as the Bearer key and the Virtual Key as `x-api-vkey`, so both
  headers the gateway requires come from a single Pi credential.
- Route authentication, catalog, and inference through one undici `fetch` with a
  lazily created `EnvHttpProxyAgent` that is given Node's `tls.rootCertificates`
  merged with `NODE_EXTRA_CA_CERTS` / `SSL_CERT_FILE`. The global `fetch` is no
  longer patched, and `HTTP(S)_PROXY` keeps working.
- Persist the model catalog in Pi's `models-store.json` and drop the hardcoded
  fallback list; a failed refresh keeps the models already cached.
- Map thinking levels per model family: DeepSeek keeps `thinkingFormat`
  (`off` sends `thinking: {type:"disabled"}`), Qwen sends
  `reasoning_effort: "none"` for `off`, and GLM always thinks so only
  `low`/`high`/`max` are offered and Pi clamps the rest.
- Use `redirect: "error"` on the auth and catalog requests so credentials cannot
  be carried to another origin.
- Collapse `auth.ts`, `catalog.ts`, `constants.ts`, and `models.ts` into
  `cannbot.ts`, and require Node >= 22.19.
- Publish from CI with npm trusted publishing (OIDC) instead of an `NPM_TOKEN`
  secret; provenance is generated automatically.

## [0.1.3]

- Keep Pi's proxy dispatcher: the CANNBOT-only fetch wrapper now uses
  `EnvHttpProxyAgent` and no longer replaces the global dispatcher, so proxied
  traffic keeps working. The wrapper is installed even when extra CA
  environment variables are set, because the AI SDK uses its own dispatcher.
- Clamp the refresh margin to half the token lifetime so a short-lived token
  cannot be stored already expired.
- Cache the CA bundle per environment and cap response bodies at 1 MiB.
- Accept `"1"`/numeric-string catalog fields, give each model its own compat
  object, and mark the OAuth method as an account instead of a subscription.
- Add opt-in `PI_CANNBOT_DEBUG=1` diagnostics for catalog and trust failures.
- Run `npm ci` in CI, check that the release tag matches the package version,
  and let Node expand the test glob on every platform.

## [0.1.2]

- Also cover model inference. The AI SDK attaches its own undici dispatcher to
  every request and ignores the global one, so the extension now wraps `fetch`
  and swaps in a CA-aware Agent **only for `cannbot.hicann.cn`**. It reuses the
  undici copy Pi loaded, and every other request keeps its own dispatcher.
  `/login`, model discovery, and chat all work without `NODE_EXTRA_CA_CERTS`.

## [0.1.1]

- Send the auth and catalog requests over `node:https` with Node's bundled CA
  roots supplied explicitly. Node's `fetch` rejects the gateway's cross-signed
  chain on some platforms; this makes `/login` and model discovery work without
  setting `NODE_EXTRA_CA_CERTS`. Extra CAs from `NODE_EXTRA_CA_CERTS` and
  `SSL_CERT_FILE` are merged in, and certificate verification stays enabled.

## [0.1.0]

- Initial release.
- Register the `cannbot` provider with native `/login` (CANNBOT Virtual Key).
- Exchange the VK for an access token through `POST /cannbot/api/auth/authenticate`
  and refresh it automatically when it expires.
- Inject `Authorization: Bearer` and `x-api-vkey` on every request.
- Discover the account's model catalog from `/cannbot/api/models/list`, with a
  static fallback when the endpoint is unreachable.
- Disable thinking (`thinking.type = disabled`) for DeepSeek models and keep
  reasoning content on replayed assistant messages.
