# pi-cannbot

在 [Pi](https://pi.dev/) 里原生使用 **CANNBOT 网关**的模型：`/login` 输入一次 Virtual Key（VK），
插件自动换取 access token、过期自动续期、动态拉取账号可见的模型列表，并同时注入
`Authorization: Bearer` 与 `x-api-vkey`。

> 非官方插件。使用前请确认你的账号有对应模型的访问权限。

## 安装

```bash
pi install npm:pi-cannbot
# 或从源码
git clone https://github.com/fengz72/pi-cannbot.git
pi install ./pi-cannbot
```

安装后重启（或 `/reload`）。

## 使用

1. `/login`，选择 **CANNBOT**。
2. 粘贴 CANNBOT Virtual Key（形如 `vk-...`）。
3. `/model` 选择 `cannbot/...` 开始对话。

插件通过 `POST https://cannbot.hicann.cn/cannbot/api/auth/authenticate` 用 VK 换 access token，
凭据存放在 Pi 的 `~/.pi/agent/auth.json`；token 接近过期时 Pi 会调用同一个交换自动刷新。

## 实现要点

- **原生 Provider**：通过 `pi.registerProvider(provider)` 注册，复用 `openai-completions`，
  不实现自定义 wire。
- **双凭据**：网关要求两个头同时存在——只给 VK 返回 `401 Access Token required.`，
  只给 Bearer 返回 `401 Virtual Key is required.`。插件通过 `auth.oauth.toAuth` 直接返回
  `apiKey`（Bearer）与 `headers["x-api-vkey"]`（VK）。
- **统一传输与 TLS**：网关下发交叉签名链（`DigiCert Global Root G2` 由 `DigiCert Global Root CA` 签发），
  Node 默认 `fetch` 可能拒收。插件用 `undici` 的 `fetch` + 懒初始化 `EnvHttpProxyAgent`
  （显式传入 `tls.rootCertificates` 并合并 `NODE_EXTRA_CA_CERTS` / `SSL_CERT_FILE`）统一处理认证、
  目录与推理请求，不修改 `globalThis.fetch`，同时保留 `HTTP(S)_PROXY` 支持。
- **模型目录**：网关的 `GET /gateway/.../v1/models` 不可用，因此从
  `GET /cannbot/api/models/list` 动态拉取并持久化到 Pi 的 `models-store.json`；
  按 `status` 过滤、按 id 去重，不硬编码模型列表，刷新失败时保留已有缓存。
- **图片**：仅对实测可读图的模型声明 `image`（`deepseek-v4.1-flash`、`qwen3.8-max`、
  `qwen3.8-flash`、`glm-5.3-flash`），其余保持纯文本。
- **思考强度**：
  - DeepSeek：使用 `thinkingFormat: "deepseek"`（回放 assistant 历史保留 `reasoning_content`，`off` 发 `thinking: {type:"disabled"}`），支持 `off` / `low` / `medium` / `high` / `xhigh` / `max`。
  - Qwen：`off` 发送 `reasoning_effort: "none"` 关闭思考，支持 `off` 至 `max` 全档位。
  - GLM：始终思考，仅开放网关实测支持的 `low` / `high` / `max`（其余档位由 Pi 自动 clamp）。

## 安全

- 插件只读取自身配置，不写日志中的凭据；请求只发往 CANNBOT 官方域名。
- 认证与目录请求使用 `redirect: "error"`，避免凭据被重定向到其他源。
- 扩展以你的权限在 Pi 进程内运行，仅安装可信来源。

## 开发

```bash
npm install
npm run typecheck
npm test
```

测试用 Node 内置 test runner 直接运行 TypeScript（Node >= 22.19）。

## 发布

推送 `v*` tag 触发 GitHub Actions 发布到 npm（需要仓库 secret `NPM_TOKEN`）：

```bash
npm version patch
git push --follow-tags
```

## 故障排查

### 安装后 `/login` 里没有 CANNBOT

确认扩展已加载：`pi list` 应能看到本包；`pi -e /path/to/pi-cannbot` 只对单次运行生效。

### Pi 自身下载报 `unable to get local issuer certificate`

插件内置的 TLS 配置仅作用于 CANNBOT 请求；Pi 自身下载工具（如 `fd` / `ripgrep`）仍走全局 `fetch`。
如有需要，可在启动 Pi 的 shell 里设置：

```bash
export NODE_EXTRA_CA_CERTS=/path/to/extra-ca.pem
```

## License

MIT
