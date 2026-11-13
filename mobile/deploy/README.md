# 公网 HTTPS 部署

PWA 的完整安装（Android 独立窗口、自定义图标）只在 **HTTPS 安全上下文**可用。局域网 `http://192.168.x.x` 不算，所以要把服务放到 HTTPS 后面。两条路：

| | A. 临时隧道 | B. 固定域名 |
|---|---|---|
| 需要域名 / 云主机 | 不需要 | 需要 |
| 地址 | 每次重启都变 | 固定 |
| 拿到链接的人 | 都能访问 | 都能访问（可自行加鉴权） |
| 适合 | 马上给手机用、演示 | 长期稳定使用 |

---

## 方案 A：cloudflared 临时隧道（最快）

先装 `cloudflared`（Windows `winget install --id Cloudflare.cloudflared`；macOS `brew install cloudflared`；Linux 从 [Releases](https://github.com/cloudflare/cloudflared/releases) 下载 deb/rpm），然后开两个终端：

```bash
node mobile/start.js        # 终端 1：Streamlit + 网关，保持运行
node mobile/tunnel.js       # 终端 2：建立 HTTPS 隧道
```

Windows 可用 `mobile\start_tunnel.bat`，macOS / Linux 用 `./mobile/start_tunnel.sh`。

隧道建立后终端会打印 `https://xxx.trycloudflare.com`，手机直接打开这个地址，**不必和电脑同一个 WiFi**。Android Chrome 菜单里会出现「安装应用」，iOS Safari「添加到主屏幕」会全屏启动。

> 临时隧道不需要 Cloudflare 账号，但地址每次重启都会变，也不设访问控制。别在上面处理敏感数据，长期用请走方案 B。

---

## 方案 B：云主机 + Caddy + 固定域名

### 1. 准备主机

Python 3.10+、Node.js 18+，克隆仓库并装依赖：

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
sudo useradd -r -s /bin/false medlit        # 可选：专用低权限用户
```

### 2. 注册为系统服务

把 `medlit-mobile.service` 里的 `User` / `WorkingDirectory` / `ExecStart` 改成实际路径：

```bash
sudo cp mobile/deploy/medlit-mobile.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now medlit-mobile
sudo journalctl -u medlit-mobile -f
```

服务只监听 `127.0.0.1:8080`，不直接对外。

### 3. Caddy 提供 HTTPS

DNS 把域名 A 记录指向主机公网 IP，改好 `Caddyfile` 里的域名：

```bash
sudo caddy validate --config mobile/deploy/Caddyfile
sudo systemctl restart caddy          # 或 caddy run --config ... 前台试跑
```

Caddy 自动申请并续期 Let's Encrypt 证书，也会自动透传 WebSocket 升级请求，Streamlit 实时交互无需额外配置。

### 4. 防火墙

**只放行 80 / 443。** 8080（网关）和 8501（Streamlit）必须留在本机，直接暴露会绕过 HTTPS，也会让未加保护的会话数据暴露在公网。

---

## 部署后验证清单

- `https://域名/manifest.webmanifest` 返回 200 且 `Content-Type` 含 `manifest+json`
- 浏览器 DevTools → Application → Manifest：名称、图标、standalone 都能识别
- Application → Service Workers：已激活且作用域为 `/`
- Network → WS：`/_stcore/stream` 状态 101（WebSocket 没被反代掐断）
- 手机 Chrome「安装应用」/ Safari「添加到主屏幕」后，打开是全屏独立窗口
- 检索一次真实关键词，确认云主机能访问 PubMed / NCBI 接口

改过网关后，先在本地跑 `node mobile/selftest.js`（8 项全过）再部署。

---

## 安全与运维提醒

- **不要**为了「连得上」去关 Streamlit 的 CORS / XSRF。网关转发时已把 `Host` / `Origin` 改写成上游 `127.0.0.1:8501`，默认安全配置就能正常工作。
- 在线版默认按浏览器会话隔离收藏与历史。开启「跨刷新保留」后网址会带 `?sid=…`，**带该参数的链接不要分享给别人**。
- 大模型 / 翻译 / NCBI 的 Key 用环境变量或 `st.secrets` 注入，不要写进仓库、也不要放进 Caddyfile。
- 需要长期保留数据时，定期备份数据目录（桌面版在 `%APPDATA%\MedLitSummary`，云端按会话分片）；云端容器重启会重置会话数据。
- PubMed 有速率限制，项目自带缓存与配额；公网多人使用时建议在侧边栏配置 NCBI API Key（3 → 10 req/s）。
