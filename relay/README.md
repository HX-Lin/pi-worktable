# pi-relay

公网中继，把飞书网页应用（H5）和桌面 pi-desktop 连起来。它是**纯管道**：会话、文件、git、记忆全部留在桌面，relay 只做设备注册、飞书身份校验和消息路由，因此常驻内存约 10MB，且与会话量无关。

```
飞书 H5  ──HTTPS/WSS──►  nginx  ──/api /ws──►  pi-relay (127.0.0.1:8787)
桌面 pi-desktop ──出站 WSS──────────►  nginx  ──►  pi-relay
```

## 环境变量

| 变量                      | 必填 | 说明                                                                               |
| ------------------------- | ---- | ---------------------------------------------------------------------------------- |
| `FEISHU_APP_ID`           | 是   | 复用现有自建应用（机器人 + 网页应用共用）                                          |
| `FEISHU_APP_SECRET`       | 是   | 只在服务器端使用，**不要进仓库**                                                   |
| `PI_RELAY_PAIRING_SECRET` | 是   | 桌面出站连接注册用的预共享密钥，随机生成                                           |
| `PI_RELAY_OPEN_IDS`       | 建议 | 允许的飞书 `open_id`，逗号分隔；为空则放行并打印日志（首次用于发现自己的 open_id） |
| `PI_RELAY_DEV_TOKEN`      | 否   | 本地联调用：设置后可直接用它作为客户端 token，跳过飞书登录。**生产不要设**         |
| `PI_RELAY_ADDR`           | 否   | 默认 `127.0.0.1:8787`；也支持 `unix:/run/pi-relay.sock`                            |
| `FEISHU_BASE_URL`         | 否   | 默认 `https://open.feishu.cn`（国际版 Lark 用 `https://open.larksuite.com`）       |

`/etc/pi-relay.env` 示例（权限 `600`，属主 root）：

```sh
FEISHU_APP_ID=cli_xxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxx
PI_RELAY_PAIRING_SECRET=用 openssl rand -hex 32 生成
# 首次可留空，登录一次后在日志里看到 open_id 再填上
PI_RELAY_OPEN_IDS=
```

## 构建

```sh
./build.sh              # 交叉编译出 dist/pi-relay（linux/amd64，静态）
```

## 部署（假设 nginx 已在运行）

```sh
sudo useradd --system --no-create-home --shell /usr/sbin/nologin pi-relay
sudo install -m 0755 dist/pi-relay /usr/local/bin/pi-relay
sudo install -m 0600 /dev/null /etc/pi-relay.env    # 然后填入上面的变量
sudo install -m 0644 deploy/pi-relay.service /etc/systemd/system/pi-relay.service
sudo systemctl daemon-reload && sudo systemctl enable --now pi-relay

sudo mkdir -p /var/www/pi-h5
# 把 web/dist 的内容放到 /var/www/pi-h5
sudo install -m 0644 deploy/nginx-pi-relay.conf /etc/nginx/conf.d/pi-relay.conf
sudo certbot --nginx -d pi.hxlin.fun
sudo nginx -t && sudo systemctl reload nginx
```

飞书开发者后台（复用现有应用）：添加能力 **网页应用** → 桌面/移动端主页 `https://pi.hxlin.fun/` → 安全设置里把该域名加入 **JSAPI 域名 / 重定向 URL** → 补「获取用户身份」权限 → 可用范围「仅自己」→ 发布版本。

## HTTP 接口

- `GET /api/health` → `{"ok":true,"desktopOnline":false}`
- `GET /api/config` → `{"appId":"cli_..."}`（只下发公开的 app_id，app_secret 不出服务器）
- `POST /api/login` `{"code":"<tt.requestAuthCode 返回的 code>"}` → `{"token":"...","openId":"ou_...","name":"..."}`

## WebSocket 协议

H5：`wss://pi.hxlin.fun/ws?token=<token>`；桌面：`wss://pi.hxlin.fun/ws?role=desktop`（随后发送 `register`）。

消息类型（与 `src/shared/relay-protocol.ts` 一一对应）：

| 方向              | 类型                 | 作用                          |
| ----------------- | -------------------- | ----------------------------- |
| 桌面→relay        | `register`           | 用 `pairingSecret` 认证本连接 |
| relay→桌面        | `registered`         | 注册结果                      |
| 客户端→relay      | `subscribe`          | 订阅某会话的事件流            |
| 客户端→relay→桌面 | `prompt` / `abort`   | 发送指令 / 中止当前回合       |
| 客户端→relay→桌面 | `history`            | 请求会话历史                  |
| 客户端→relay→桌面 | `sessions`           | 请求桌面上的会话列表          |
| 桌面→relay→客户端 | `event`              | 转发一个 `AgentEvent`         |
| 桌面→relay→客户端 | `history` / `result` | 历史结果 / 请求确认           |
| 桌面→relay→客户端 | `sessions`           | 会话列表结果                  |
| relay→客户端      | `presence`           | 桌面是否在线                  |
| 双向              | `error`              | 协议或鉴权错误                |

## 安全

- 桌面连接必须提供正确的 `pairingSecret`（常数时间比较）。
- 客户端必须持有由飞书登录签发的 token；登录本身要求 `open_id` 在白名单内。
- relay 不落盘任何会话内容；token 只在内存，重启后客户端重新登录即可。
- 工具执行权限仍由桌面侧的 Jev 闸门兜底，relay 不参与授权决策。

## H5 前端与本地联调

H5 在 `web/`，由 nginx 托管其构建产物：

```sh
npm run build:web          # 输出到 web/dist
```

本地联调（不经过飞书）：

```sh
PI_RELAY_DEV_TOKEN=devtok ./relay/dist/pi-relay        # 启动 relay
npm run build:web                                      # 构建 H5
# 用静态服务器托管 web/dist，并在构建时设 VITE_RELAY_TOKEN=devtok 跳过飞书登录
```

桌面端让桥连上本地 relay：在 `~/.pi/agent/pi-desktop-relay.json` 里把 `url` 指向 `ws://127.0.0.1:8787/ws`，`pairingSecret` 与 relay 一致，然后重启桌面应用。
