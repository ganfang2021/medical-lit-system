#!/usr/bin/env node
/**
 * 手机端单端口网关（Node 内置模块，零第三方依赖）
 *
 * Streamlit 是 Python 服务端渲染应用，它不会把项目目录里的文件当成静态资源发出来，
 * 而 PWA 的 manifest / sw.js 必须与页面「同源、且在根 scope 下」才能被安装。
 * 这个网关只做三件事：
 *   1. 在同源根路径提供 PWA 静态资源（/manifest.webmanifest、/sw.js、/icons/*）；
 *   2. 把其余 HTTP 请求透明反代给本机 Streamlit，并只在首页 HTML 的 <head> 里
 *      注入 PWA 标签和注册脚本（不动任何业务代码、不缓存任何动态内容）；
 *   3. 在 TCP 层隧道转发 WebSocket，让 Streamlit 的实时交互照常工作。
 *
 * 对外只暴露一个端口，手机连这一个地址即可；Streamlit 本身仍只监听 127.0.0.1。
 *
 * 环境变量：
 *   MOBILE_PORT      对外端口，默认 8080
 *   STREAMLIT_HOST   上游地址，默认 127.0.0.1
 *   STREAMLIT_PORT   上游端口，默认 8501
 *   HTTPS_KEY/HTTPS_CERT  可选，提供证书时启用 HTTPS（PWA 完整安装需要安全上下文）
 */
'use strict';

const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PWA_DIR = path.join(__dirname, 'pwa');
const PORT = Number(process.env.MOBILE_PORT || 8080);
const ST_HOST = process.env.STREAMLIT_HOST || '127.0.0.1';
const ST_PORT = Number(process.env.STREAMLIT_PORT || 8501);
const UPSTREAM_ORIGIN = `http://${ST_HOST}:${ST_PORT}`;

const STATIC_FILES = {
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
  '/sw.js': ['sw.js', 'application/javascript; charset=utf-8'],
  '/pwa-init.js': ['pwa-init.js', 'application/javascript; charset=utf-8'],
  '/apple-touch-icon.png': ['icons/apple-touch-icon.png', 'image/png'],
  '/favicon.ico': ['icons/icon-192.png', 'image/png'],
};

const INJECT_TAGS = [
  '<link rel="manifest" href="/manifest.webmanifest">',
  '<meta name="theme-color" content="#2e9e8f">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
  '<meta name="apple-mobile-web-app-title" content="医学文献">',
  '<meta name="format-detection" content="telephone=no">',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
  '<link rel="icon" type="image/png" href="/icons/icon-192.png">',
  '<script src="/pwa-init.js" defer></script>',
].join('\n');

const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">';

function injectPwa(html) {
  let out = html;
  // viewport-fit=cover 让 CSS 的 env(safe-area-inset-*) 在刘海屏上生效
  if (/<meta\s+name=["']viewport["'][^>]*>/i.test(out)) {
    out = out.replace(/<meta\s+name=["']viewport["'][^>]*>/i, VIEWPORT);
  } else {
    out = out.replace(/<head[^>]*>/i, (m) => m + VIEWPORT);
  }
  if (out.includes('rel="manifest"')) return out;             // 幂等
  if (out.includes('</head>')) return out.replace('</head>', INJECT_TAGS + '\n</head>');
  return INJECT_TAGS + out;
}

function serveStatic(req, res, pathname) {
  let rel, type;
  if (STATIC_FILES[pathname]) {
    [rel, type] = STATIC_FILES[pathname];
  } else if (pathname.startsWith('/icons/')) {
    const name = pathname.slice('/icons/'.length);
    if (!/^[A-Za-z0-9_.-]+\.png$/.test(name)) return false;
    rel = path.join('icons', name);
    type = 'image/png';
  } else {
    return false;
  }

  const file = path.resolve(PWA_DIR, rel);
  if (!file.startsWith(path.resolve(PWA_DIR) + path.sep)) {   // 目录穿越防护
    res.writeHead(403); res.end('Forbidden'); return true;
  }
  let buf;
  try { buf = fs.readFileSync(file); }
  catch { res.writeHead(404); res.end('Not found'); return true; }

  const headers = {
    'Content-Type': type,
    'Content-Length': buf.length,
    'Cache-Control': pathname === '/sw.js' ? 'no-cache' : 'public, max-age=3600',
  };
  if (pathname === '/sw.js') headers['Service-Worker-Allowed'] = '/';
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : buf);
  return true;
}

function proxyHttp(req, res) {
  const headers = Object.assign({}, req.headers);
  headers.host = `${ST_HOST}:${ST_PORT}`;
  headers['accept-encoding'] = 'identity';   // 便于改写首页 HTML；局域网不在乎压缩
  if (headers.origin) headers.origin = UPSTREAM_ORIGIN;
  if (headers.referer) {
    try {
      const u = new URL(headers.referer);
      headers.referer = UPSTREAM_ORIGIN + u.pathname + u.search;
    } catch (_) { /* 原样保留 */ }
  }

  const upstream = http.request(
    { host: ST_HOST, port: ST_PORT, method: req.method, path: req.url, headers },
    (up) => {
      const ct = String(up.headers['content-type'] || '').toLowerCase();
      const isIndex = ct.includes('text/html') &&
        (req.url === '/' || req.url.startsWith('/?') || req.url.startsWith('/index.html'));
      if (!isIndex) {
        res.writeHead(up.statusCode, up.headers);
        up.pipe(res);
        return;
      }

      const chunks = [];
      up.on('data', (c) => chunks.push(c));
      up.on('end', () => {
        const body = Buffer.from(injectPwa(Buffer.concat(chunks).toString('utf8')), 'utf8');
        const h = Object.assign({}, up.headers);
        delete h['content-length'];
        delete h['content-encoding'];
        delete h['transfer-encoding'];
        delete h['etag'];
        h['content-length'] = body.length;
        h['cache-control'] = 'no-store';       // 首页永远取最新的注入版本
        res.writeHead(up.statusCode, h);
        res.end(req.method === 'HEAD' ? undefined : body);
      });
    }
  );
  upstream.setTimeout(120000);
  upstream.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    res.end('Streamlit 还没就绪或连接断开：' + err.message);
  });
  req.pipe(upstream);
}

// WebSocket：不解析帧，握手改写后直接 TCP 双向透传，Streamlit 的实时通道零改动
function proxyUpgrade(req, client, head) {
  const upstream = net.connect(ST_PORT, ST_HOST);
  upstream.on('connect', () => {
    let handshake = `${req.method} ${req.url} HTTP/1.1\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const key = req.rawHeaders[i];
      const val = req.rawHeaders[i + 1];
      const lower = key.toLowerCase();
      if (lower === 'host') handshake += `Host: ${ST_HOST}:${ST_PORT}\r\n`;
      else if (lower === 'origin') handshake += `Origin: ${UPSTREAM_ORIGIN}\r\n`;
      else handshake += `${key}: ${val}\r\n`;
    }
    handshake += '\r\n';
    upstream.write(handshake);
    if (head && head.length) upstream.write(head);
  });
  upstream.pipe(client);
  client.pipe(upstream);
  upstream.on('error', () => client.destroy());
  client.on('error', () => upstream.destroy());
}

function handler(req, res) {
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; }
  catch { pathname = req.url; }

  if (pathname === '/__mobile_health') {
    const body = JSON.stringify({ ok: true, upstream: UPSTREAM_ORIGIN, pwa: true });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
    return;
  }
  if (serveStatic(req, res, pathname)) return;
  proxyHttp(req, res);
}

const tlsKey = process.env.HTTPS_KEY || '';
const tlsCert = process.env.HTTPS_CERT || '';
const useHttps = Boolean(tlsKey && tlsCert && fs.existsSync(tlsKey) && fs.existsSync(tlsCert));

const server = useHttps
  ? https.createServer({ key: fs.readFileSync(tlsKey), cert: fs.readFileSync(tlsCert) }, handler)
  : http.createServer(handler);

server.on('upgrade', proxyUpgrade);
server.on('error', (err) => {
  console.error('[网关] 启动失败：', err.message);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  const scheme = useHttps ? 'https' : 'http';
  const ips = [];
  const ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach((name) => {
    (ifaces[name] || []).forEach((a) => {
      if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
    });
  });
  console.log('');
  console.log('  医学文献系统 · 手机网关已启动');
  console.log('  --------------------------------------------');
  console.log(`  本机访问：  ${scheme}://localhost:${PORT}`);
  ips.forEach((ip) => console.log(`  手机访问：  ${scheme}://${ip}:${PORT}   （需与电脑同一 WiFi）`));
  console.log(`  上游服务：  ${UPSTREAM_ORIGIN}`);
  console.log(`  PWA：       /manifest.webmanifest · /sw.js · /icons/*`);
  if (!useHttps) {
    console.log('');
    console.log('  提示：HTTP 下 iOS 可「添加到主屏幕」，Android 只能加快捷方式。');
    console.log('        要完整安装 PWA，请用 HTTPS（HTTPS_KEY/HTTPS_CERT 或公网反代）。');
  }
  console.log('  --------------------------------------------');
  console.log('');
});
