#!/usr/bin/env node
/**
 * 一键启动手机版（Windows / macOS / Linux 通用）
 *
 * 同时管理两个进程：
 *   Streamlit（只听 127.0.0.1:8501）→ 手机网关（听 0.0.0.0:8080）
 * 等上游端口真的就绪再起网关，Ctrl+C 一起收掉。
 * 若 8501 已有实例在跑（比如桌面版），就复用它，不再重复启动。
 *
 *   MOBILE_PORT=8080 node mobile/start.js
 *   PYTHON=/path/to/python MOBILE_PORT=8443 node mobile/start.js
 */
'use strict';

const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ST_PORT = Number(process.env.STREAMLIT_PORT || 8501);
const ST_HOST = process.env.STREAMLIT_HOST || '127.0.0.1';

function findPython() {
  if (process.env.PYTHON) return process.env.PYTHON;
  const candidates = process.platform === 'win32'
    ? [path.join(ROOT, '.venv', 'Scripts', 'python.exe')]
    : [path.join(ROOT, '.venv', 'bin', 'python')];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function portOpen(port, host) {
  return new Promise((resolve) => {
    const s = net.connect(port, host);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => { s.destroy(); resolve(false); });
  });
}

function waitPort(port, host, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = async () => {
      if (await portOpen(port, host)) return resolve();
      if (Date.now() - t0 > timeoutMs) return reject(new Error('等待上游超时'));
      setTimeout(tick, 400);
    };
    tick();
  });
}

function forward(stream, tag) {
  stream.on('data', (buf) => {
    String(buf).split(/\r?\n/).forEach((line) => {
      if (line.trim()) console.log(`[${tag}] ${line}`);
    });
  });
}

let streamlit = null;
let gateway = null;
let stopping = false;

function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log('\n正在关闭服务…');
  [streamlit, gateway].forEach((p) => {
    if (!p || p.exitCode !== null) return;
    if (process.platform === 'win32') {
      // Windows 下 spawn 的不是 shell，kill 只作用于直接子进程；/T 连同子进程树
      spawn('taskkill', ['/pid', String(p.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      p.kill('SIGTERM');
    }
  });
  setTimeout(() => process.exit(0), 400);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

(async function main() {
  const py = findPython();
  console.log(`Python：${py}`);

  if (await portOpen(ST_PORT, ST_HOST)) {
    console.log(`检测到 ${ST_HOST}:${ST_PORT} 已有服务在跑，直接复用，不再启动第二个 Streamlit。`);
  } else {
    const args = [
      '-m', 'streamlit', 'run', 'app.py',
      `--server.port=${ST_PORT}`,
      `--server.address=${ST_HOST}`,
      '--server.headless=true',
      '--browser.gatherUsageStats=false',
    ];
    streamlit = spawn(py, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    forward(streamlit.stdout, 'streamlit');
    forward(streamlit.stderr, 'streamlit');
    streamlit.on('error', (err) => {
      console.error('[streamlit] 启动失败：', err.message);
      console.error('请先执行 pip install -r requirements.txt，或用 PYTHON 指定装好依赖的解释器。');
    });
    streamlit.on('exit', (code) => {
      if (!stopping && code !== 0) console.error(`[streamlit] 意外退出（code ${code}）`);
    });

    try {
      console.log('等待 Streamlit 就绪…');
      await waitPort(ST_PORT, ST_HOST, 90000);
      console.log('Streamlit 已就绪。');
    } catch (err) {
      console.error('启动中止：', err.message);
      shutdown();
      return;
    }
  }

  gateway = spawn(process.execPath, [path.join(__dirname, 'gateway.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  forward(gateway.stdout, 'gateway');
  forward(gateway.stderr, 'gateway');
  gateway.on('exit', (code) => {
    if (!stopping) { console.error(`[gateway] 退出（code ${code}）`); shutdown(); }
  });
})();
