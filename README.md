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

- **接入方式**：一个 Pi provider extension（`pi.registerProvider`），复用 `openai-completions`，
  不实现自定义 wire。
- **双凭据**：网关要求两个头同时存在——只给 VK 返回 `401 Access Token required.`，
  只给 Bearer 返回 `401 Virtual Key is required.`。插件把 `access` 作为 Bearer、把 VK
  作为 `x-api-vkey`，两者都来自同一份 Pi 凭据。
- **模型目录**：网关的 `GET /gateway/.../v1/models` 不可用，因此从
  `GET /cannbot/api/models/list` 拉取；按 `status === 1` 过滤、按 id 去重，失败时保留内置兜底列表。
- **图片**：仅对实测可读图的模型声明 `image`（`deepseek-v4.1-flash`、`qwen3.8-max`、
  `qwen3.8-flash`、`glm-5.3-flash`），其余保持纯文本。
- **推理**：DeepSeek 模型使用 `thinkingFormat: "deepseek"`，并在回放 assistant 历史时保留
  `reasoning_content`。`off` 会发送 `thinking: {type:"disabled"}`（网关接受）。

## 安全

- 插件只读取自身配置，不写日志中的凭据；请求只发往 CANNBOT 官方域名。
- 认证与目录请求都设置 `redirect: "error"`，避免凭据被重定向到其他源。
- 扩展以你的权限在 Pi 进程内运行，仅安装可信来源。

## 开发

```bash
npm install
npm run typecheck
npm test
```

测试用 Node 内置 test runner 直接运行 TypeScript（Node >= 22.6）。

## 发布

推送 `v*` tag 触发 GitHub Actions 发布到 npm（需要仓库 secret `NPM_TOKEN`）：

```bash
npm version patch
git push --follow-tags
```

## 故障排查

### `/login` 报 `Failed to login to CANNBOT: fetch failed` 或 `unable to get local issuer certificate`

这是 Node 的 TLS 信任链问题，不是插件逻辑问题：网关下发的是交叉签名链
（`DigiCert Global Root G2` 由 `DigiCert Global Root CA` 签发），Node 的全局
`fetch` 默认拒收。

插件已内置修复：认证与目录请求走 `node:https`，并显式传入 Node 自带的
`tls.rootCertificates`（不新增信任、不关闭校验），同时合并 `NODE_EXTRA_CA_CERTS`
与 `SSL_CERT_FILE` 中的证书。正常情况下**无需任何环境变量**。

Pi 自身的下载（如启动时安装 `fd` / `ripgrep`）仍使用 Pi 内置的 fetch，可能仍报同样
错误。需要的话在启动 Pi 的 shell 里设置：

```bash
export NODE_EXTRA_CA_CERTS=/path/to/extra-ca.pem
```

### 安装后 `/login` 里没有 CANNBOT

确认扩展已加载：`pi list` 应能看到本包；`pi -e /path/to/pi-cannbot` 只对单次运行生效。

## License

MIT
