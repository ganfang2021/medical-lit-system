# 手机版使用说明

把原来的桌面端 Streamlit 应用改成手机能舒服使用的形态：

- **响应式界面**：窄屏自动收起侧边栏、顶部出现可横滑的页面标签条，多列布局纵向堆叠，宽表格单独横滑，按钮/输入框放大到 44px 以上（输入框 16px 防 iOS 自动缩放），适配刘海屏安全区。桌面端样式一行未改。
- **PWA**：有独立图标、启动画面主题色，可「添加到主屏幕」全屏运行。
- **单端口网关**：把 PWA 资源和 Streamlit 放到同一个源下，手机只需连一个地址。

业务逻辑（`core/` 全部 24 个模块）完全没动。

---

## 一、最快：直接用已有的在线版

把改动 push 到你 fork 的仓库 `main` 分支，Streamlit Community Cloud 会自动更新：

<https://medical-lit-system-fy.streamlit.app/>

手机浏览器打开即可，**界面适配立刻生效**。iOS Safari 点「分享 → 添加到主屏幕」会以全屏方式打开（无地址栏）；Android Chrome 可以「添加到主屏幕」，但因为是云端单页应用、没有同源 manifest，只是一个带图标的快捷方式，不会显示自定义 App 图标。

想要自定义图标和独立窗口，走下面第二节自建网关。

---

## 二、本机启动，手机连 WiFi 使用

需要 Node.js 18+（网关零依赖）和项目原有的 Python 环境。

```bash
# 第一次：装 Python 依赖（已有环境可跳过）
pip install -r requirements.txt

# Windows
mobile\start_mobile.bat

# macOS / Linux
chmod +x mobile/start_mobile.sh
./mobile/start_mobile.sh

# 或者跨平台统一入口
node mobile/start.js
```

启动后会打印两个地址：

```
本机访问：  http://localhost:8080
手机访问：  http://192.168.x.x:8080   （需与电脑同一 WiFi）
```

手机浏览器打开「手机访问」那个地址即可。首次若连不上，检查电脑防火墙是否放行 8080 端口、手机和电脑是否在同一个网段（访客网络通常会隔离设备）。

**Ctrl+C 同时关闭 Streamlit 和网关。** 若 8501 端口已有实例（比如桌面版）在跑，启动器会直接复用，不会起第二个。

### 添加到主屏幕

| 系统 | 操作 | 效果 |
|---|---|---|
| iOS Safari | 分享 → 添加到主屏幕 | 自定义图标、全屏无地址栏 |
| Android Chrome | 菜单 → 添加到主屏幕 / 安装应用 | HTTP 下是快捷方式；HTTPS 下才是完整安装 |

---

## 三、完整 PWA 安装（需要 HTTPS）

浏览器的 **Service Worker 和 PWA 安装只在安全上下文可用**：`localhost` 或 HTTPS。局域网 `http://192.168.x.x` 不算安全上下文，所以 Android 只能加快捷方式。要拿到真正的独立窗口体验，有三条路，完整步骤见 **[部署说明](deploy/README.md)**：

**A. 临时 HTTPS 隧道（最快，免域名、免云主机）**

装好 `cloudflared` 后开两个终端：

```bash
node mobile/start.js       # 终端 1：Streamlit + 网关
node mobile/tunnel.js      # 终端 2：建立 HTTPS 隧道
```

Windows 可用 `mobile\start_tunnel.bat`，macOS / Linux 用 `./mobile/start_tunnel.sh`。终端会打印 `https://xxx.trycloudflare.com`，手机走公网直接打开，**不必同 WiFi**；Android 可「安装应用」、iOS 可全屏。地址每次重启会变，适合马上用和演示。

**B. 公网域名 + Caddy（长期稳定）**

云主机上按第二节启动（用 `mobile/deploy/medlit-mobile.service` 做开机自启），再用 `mobile/deploy/Caddyfile` 反代：

```
medlit.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Caddy 自动申请证书、自动透传 WebSocket，无需改网关配置。防火墙只放行 80/443，8080 和 8501 留在本机。

**C. 网关直接开自签 HTTPS（局域网）**

```bash
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout mobile/key.pem -out mobile/cert.pem -days 365 \
  -subj "/CN=medlit" -addext "subjectAltName=IP:192.168.x.x"

HTTPS_KEY=mobile/key.pem HTTPS_CERT=mobile/cert.pem MOBILE_PORT=8443 node mobile/start.js
```

自签证书需要手机手动信任（Android 装用户证书、iOS 装描述文件并开启完全信任），步骤较繁琐，一般不如公网域名省事。

> 注意：这个应用的检索、全文抓取、摘要都在服务端跑，**离线打不开**，这是设计使然。Service Worker 只缓存图标和 manifest，不缓存任何页面、接口或会话数据，避免不同会话之间串数据。

---

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `MOBILE_PORT` | `8080` | 手机访问的对外端口 |
| `STREAMLIT_PORT` | `8501` | 上游 Streamlit 端口 |
| `STREAMLIT_HOST` | `127.0.0.1` | 上游地址，保持只监听本机 |
| `PYTHON` | 自动探测 | 指定装好依赖的 Python；优先用项目 `.venv` |
| `CLOUDFLARED` | `cloudflared` | 隧道二进制路径，装在非标准位置时用 |
| `HTTPS_KEY` / `HTTPS_CERT` | 空 | 提供后网关改用 HTTPS |

---

## 文件清单

| 文件 | 作用 |
|---|---|
| `app.py` | 移动端响应式 CSS、顶部快捷导航、侧边栏 `auto`、无网关时的 meta 兜底 |
| `mobile/gateway.js` | 单端口网关：同源提供 PWA 资源 + 反代 HTTP/WebSocket + 注入 head 标签 |
| `mobile/start.js` | 一键启动器：管理两个进程、等待端口就绪、Ctrl+C 一起收 |
| `mobile/start_mobile.bat` / `.sh` | 对应平台的启动入口 |
| `mobile/tunnel.js`、`start_tunnel.bat` / `.sh` | cloudflared 临时 HTTPS 隧道，免域名让手机走公网访问 |
| `mobile/deploy/` | Caddyfile、systemd 单元、公网部署说明与验证清单 |
| `mobile/pwa/manifest.webmanifest` | 应用名称、图标、standalone 全屏配置 |
| `mobile/pwa/sw.js` | 只缓存图标与 manifest，动态内容零缓存 |
| `mobile/pwa/pwa-init.js` | 注入页面的 SW 注册脚本（外部脚本，避开 CSP） |
| `mobile/pwa/icons/*.png` | 192 / 512 / maskable / Apple Touch 四种图标 |
| `mobile/make_icons.py` | 图标生成器（纯标准库 SDF 绘制，改配色后可重跑） |
| `mobile/selftest.js` | 网关自检，不需要 Python 和网络，用一个假上游跑完全部检查 |

---

## 自检

```bash
node mobile/selftest.js
```

用假上游验证首页标签注入、manifest、Service Worker 作用域、四张图标是否为合法 PNG、动态请求透传、Host/Origin 改写、WebSocket 握手隧道、目录穿越防护。全部通过打印 `8/8 通过`。改过网关后建议先跑一遍再部署。

---

## 常见问题

**手机打开是白屏或转圈？** 先看电脑终端里 Streamlit 是否报依赖缺失；再用电脑浏览器打开 `http://localhost:8501` 确认原始应用能跑。网关把请求原样转发，不改动任何业务逻辑。

**能点了但检索很慢？** 外网请求由服务端（电脑或云主机）发出，跟手机网络无关；PubMed / NCBI 的限速和缓存策略沿用原项目。

**窗口关了数据还在吗？** 和原项目一致：在线版默认按浏览器会话隔离，桌面版存本机。想跨刷新保留，用侧边栏的「💾 开启跨刷新保留」。

**HTTPS 下 WebSocket 连不上？** 网关在转发握手时把 `Host` / `Origin` 改写成上游的 `127.0.0.1:8501`，因此**不需要**关闭 Streamlit 的 CORS / XSRF 保护。请不要为了"能连上"去关这两个开关。
