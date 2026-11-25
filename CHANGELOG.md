# Changelog

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
