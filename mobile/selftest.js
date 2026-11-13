#!/usr/bin/env node
/**
 * 网关自检：不需要 Python / Streamlit / 网络，用一个假上游即可跑完全部检查。
 *
 *   node mobile/selftest.js
 *
 * 覆盖：首页 head 注入、PWA 静态资源、manifest 内容、动态请求透传、
 * Host/Origin 改写、WebSocket 握手隧道。全部通过会打印 PASS 清单。
 */
'use strict';

const http = require('http');
const net = require('net');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const MOCK_PORT = 18501;
const GW_PORT = 18080;
const BASE = `http://127.0.0.1:${GW_PORT}`;
const results = [];
let wsHeaders = null;

const mock = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/?')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>mock</title></head><body>mock</body></html>');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({
    path: req.url,
    host: req.headers.host,
    origin: req.headers.origin || null,
  }));
});

mock.on('upgrade', (req, socket) => {
  wsHeaders = req.headers;
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n'
  );
});

function waitPort(port) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      const s = net.connect(port, '127.0.0.1');
      s.on('connect', () => { s.destroy(); resolve(); });
      s.on('error', () => {
        s.destroy();
        if (Date.now() - t0 > 15000) reject(new Error('网关启动超时'));
        else setTimeout(tick, 150);
      });
    };
    tick();
  });
}

function wsProbe() {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: GW_PORT, path: '/_stcore/stream',
      headers: {
        Connection: 'Upgrade', Upgrade: 'websocket',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version': '13',
        Origin: `http://phone.example:${GW_PORT}`,
      },
    });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve(res.statusCode); });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('WebSocket 握手超时')); });
    req.end();
  });
}

async function check(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (err) { results.push(['FAIL', name + ' → ' + err.message]); }
}

async function main() {
  await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));

  const gw = spawn(process.execPath, [path.join(__dirname, 'gateway.js')], {
    env: Object.assign({}, process.env, {
      MOBILE_PORT: String(GW_PORT),
      STREAMLIT_PORT: String(MOCK_PORT),
      STREAMLIT_HOST: '127.0.0.1',
      HTTPS_KEY: '', HTTPS_CERT: '',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let gwErr = '';
  gw.stderr.on('data', (b) => { gwErr += b.toString(); });

  try {
    await waitPort(GW_PORT);

    await check('首页注入了 PWA 标签与 viewport-fit', async () => {
      const r = await fetch(BASE + '/');
      assert.strictEqual(r.status, 200);
      const html = await r.text();
      ['rel="manifest"', '/pwa-init.js', 'viewport-fit=cover', 'theme-color',
        'apple-mobile-web-app-capable', '/apple-touch-icon.png'].forEach((s) => {
        assert.ok(html.includes(s), '缺少 ' + s);
      });
      assert.ok(html.indexOf('<meta name="viewport"') < html.indexOf('rel="manifest"'));
    });

    await check('manifest 同源可访问且配置完整', async () => {
      const r = await fetch(BASE + '/manifest.webmanifest');
      assert.strictEqual(r.status, 200);
      assert.ok(r.headers.get('content-type').includes('manifest+json'));
      const m = await r.json();
      assert.strictEqual(m.display, 'standalone');
      assert.strictEqual(m.start_url, '/');
      assert.strictEqual(m.icons.length, 3);
      assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
    });

    await check('sw.js 与 pwa-init.js 可访问，SW 作用域为根', async () => {
      const sw = await fetch(BASE + '/sw.js');
      assert.strictEqual(sw.status, 200);
      assert.strictEqual(sw.headers.get('service-worker-allowed'), '/');
      assert.ok((await sw.text()).includes("addEventListener('fetch'"));
      const init = await fetch(BASE + '/pwa-init.js');
      assert.strictEqual(init.status, 200);
    });

    await check('四张图标均为合法 PNG', async () => {
      for (const name of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) {
        const r = await fetch(BASE + '/icons/' + name);
        assert.strictEqual(r.status, 200, name);
        assert.ok(r.headers.get('content-type').includes('image/png'), name);
        const buf = Buffer.from(await r.arrayBuffer());
        assert.ok(buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), name + ' 不是 PNG');
      }
    });

    await check('动态请求原样透传，Host/Origin 已改写为上游', async () => {
      const r = await fetch(BASE + '/_stcore/api?x=1', { headers: { Origin: 'http://phone.example' } });
      assert.strictEqual(r.status, 200);
      const j = await r.json();
      assert.strictEqual(j.path, '/_stcore/api?x=1');
      assert.strictEqual(j.host, `127.0.0.1:${MOCK_PORT}`);
      assert.strictEqual(j.origin, `http://127.0.0.1:${MOCK_PORT}`);
    });

    await check('网关健康检查', async () => {
      const r = await fetch(BASE + '/__mobile_health');
      assert.strictEqual((await r.json()).ok, true);
    });

    await check('WebSocket 握手经 TCP 隧道到达上游', async () => {
      const code = await wsProbe();
      assert.strictEqual(code, 101);
      assert.ok(wsHeaders, '上游没收到 upgrade');
      assert.strictEqual(wsHeaders.host, `127.0.0.1:${MOCK_PORT}`);
      assert.strictEqual(wsHeaders.origin, `http://127.0.0.1:${MOCK_PORT}`);
    });

    await check('目录穿越不会读到 PWA 目录外的文件', async () => {
      const r = await fetch(BASE + '/icons/%2e%2e/gateway.js');
      const body = await r.text();
      assert.ok(!body.includes('手机端单端口网关'), '泄露了网关源码');
    });
  } finally {
    if (!gw.killed) {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(gw.pid), '/t', '/f'], { stdio: 'ignore' });
      else gw.kill('SIGTERM');
    }
    mock.close();
  }

  console.log('\n  网关自检结果');
  console.log('  --------------------------------------------');
  results.forEach(([s, n]) => console.log(`  ${s === 'PASS' ? '✓' : '✗'} ${n}`));
  const failed = results.filter(([s]) => s === 'FAIL').length;
  console.log('  --------------------------------------------');
  console.log(`  ${results.length - failed}/${results.length} 通过`);
  if (gwErr.trim()) console.log('\n  网关 stderr:\n' + gwErr.trim());
  console.log('');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error('自检异常：', err); process.exit(1); });
