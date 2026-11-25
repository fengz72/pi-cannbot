# Changelog

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
