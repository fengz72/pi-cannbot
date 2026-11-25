/** Provider route and display name registered with Pi. */
export const PROVIDER_ID = "cannbot";
export const PROVIDER_NAME = "CANNBOT";

/** OpenAI-compatible gateway and the CANNBOT account endpoints. */
export const GATEWAY_BASE_URL = "https://cannbot.hicann.cn/gateway/compatible-mode/v1";
export const AUTH_URL = "https://cannbot.hicann.cn/cannbot/api/auth/authenticate";
export const CATALOG_URL = "https://cannbot.hicann.cn/cannbot/api/models/list?page=1&size=100";

/** Sizing fallbacks for models the catalog did not describe. */
export const DEFAULT_CONTEXT_WINDOW = 1_048_576;
export const DEFAULT_MAX_TOKENS = 131_072;

/** Refresh a token this long before it actually expires. */
export const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

export const AUTH_TIMEOUT_MS = 8_000;
export const CATALOG_TIMEOUT_MS = 15_000;

/** Models measured to accept image input through the gateway. */
export const VISION_MODELS: ReadonlySet<string> = new Set([
  "deepseek-v4.1-flash",
  "qwen3.8-max",
  "qwen3.8-flash",
  "glm-5.3-flash",
]);

/** Static roster used before the first catalog fetch and when it fails. */
export const FALLBACK_MODELS: readonly { id: string; name: string }[] = [
  { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
  { id: "qwen3.8-max", name: "Qwen3.8 Max" },
  { id: "qwen3.8-flash", name: "Qwen3.8 Flash" },
  { id: "glm-5.3", name: "GLM-5.3" },
  { id: "glm-5.3-flash", name: "GLM-5.3 Flash" },
];
