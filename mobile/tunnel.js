#!/usr/bin/env node
/**
 * 临时公网 HTTPS 隧道（免域名、免 Cloudflare 账号）
 *
 * 先跑 `node mobile/start.js`，再跑本脚本。cloudflared 会分配一个
 * https://xxx.trycloudflare.com 地址，手机走公网即可访问，且因为是 HTTPS
 * 安全上下文，Android 可以真正「安装应用」、iOS 可以全屏添加到主屏幕。
 *
 *   node mobile/tunnel.js
 *   CLOUDFLARED=/path/to/cloudflared MOBILE_PORT=8080 node mobile/tunnel.js
 *
 * 临时地址每次重启都会变，且任何拿到链接的人都能访问；长期用请改用
 * mobile/deploy/Caddyfile 配固定域名。
 */
'use strict';

const { spawn } = require('child_process');
const net = require('net');

const PORT = Number(process.env.MOBILE_PORT || 8080);
const LOCAL = `http://127.0.0.1:${PORT}`;
const BIN = process.env.CLOUDFLARED || 'cloudflared';

const INSTALL = {
  win32: 'winget install --id Cloudflare.cloudflared，或从 github.com/cloudflare/cloudflared/releases 下载 exe',
  darwin: 'brew install cloudflared',
  linux: '从 github.com/cloudflare/cloudflared/releases 下载 deb/rpm 或二进制放进 PATH',
};

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => { s.destroy(); resolve(false); });
  });
}

(async function main() {
  if (!(await portOpen(PORT))) {
    console.error(`\n[ERROR] 本机 ${LOCAL} 没有服务在跑。`);
    console.error('请先在另一个终端执行：node mobile/start.js\n');
    process.exit(1);
  }
  console.log(`已检测到本机服务 ${LOCAL}，正在建立 HTTPS 隧道…\n`);

  const child = spawn(BIN, ['tunnel', '--url', LOCAL], { stdio: ['ignore', 'pipe', 'pipe'] });
  let announced = false;

  function onData(buf) {
    const text = buf.toString();
    process.stderr.write(text);
    const match = text.match(/https:\/\/[-a-z0-9]+\.trycloudflare\.com/i);
    if (match && !announced) {
      announced = true;
      console.log('');
      console.log('  ----------------------------------------------------------');
      console.log(`  手机访问（公网 HTTPS）： ${match[0]}`);
      console.log('  ----------------------------------------------------------');
      console.log('  这是 HTTPS 安全上下文：Android Chrome 可「安装应用」，');
      console.log('  iOS Safari 可「添加到主屏幕」全屏运行。手机不必同 WiFi。');
      console.log('');
      console.log('  注意：临时地址每次重启都会变，拿到链接的人都能访问。');
      console.log('  长期使用请改用 mobile/deploy/Caddyfile + 固定域名。');
      console.log('');
    }
  }

  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', (err) => {
    console.error(`\n[ERROR] 启动 cloudflared 失败：${err.message}`);
    console.error(`安装方式：${INSTALL[process.platform] || INSTALL.linux}`);
    console.error('装好后重跑，或用 CLOUDFLARED=/path/to/cloudflared 指定路径。\n');
    process.exit(1);
  });
  child.on('exit', (code) => {
    if (!announced && code !== 0) console.error('\n隧道未能建立，请看上方 cloudflared 日志。');
    process.exit(code || 0);
  });

  const stop = () => { try { child.kill(); } catch (_) { /* 已退出 */ } };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
})();
