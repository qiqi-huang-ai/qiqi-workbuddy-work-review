#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {mkdir, open, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4319);
const url = `http://127.0.0.1:${port}`;
const dataRoot = path.resolve(process.env.REVIEW_DATA_HOME || path.join(homedir(), '.workbuddy-review-workbench', 'data'));
const pidPath = path.join(dataRoot, '.workbench.pid');
const logPath = path.join(dataRoot, 'logs', 'server.log');

if (Number(process.versions.node.split('.')[0]) < 22) {
  throw new Error(`需要 Node.js 22 或更高版本，当前版本是 ${process.version}`);
}

async function status() {
  try {
    const response = await fetch(`${url}/api/status`);
    const payload = await response.json();
    return response.ok && payload.app === 'WorkBuddy 工作复盘';
  } catch {
    return false;
  }
}

function openBrowser() {
  const command = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  const child = spawn(command[0], command[1], {detached: true, stdio: 'ignore'});
  child.on('error', () => {});
  child.unref();
}

if (!await status()) {
  await mkdir(path.dirname(logPath), {recursive: true});
  const log = await open(logPath, 'a');
  const child = spawn(process.execPath, [path.join(root, 'server.mjs')], {
    cwd: root,
    detached: true,
    env: {...process.env, PORT: String(port), REVIEW_DATA_HOME: dataRoot},
    stdio: ['ignore', log.fd, log.fd],
  });
  child.unref();
  await writeFile(pidPath, `${child.pid}\n`, 'utf8');
  for (let attempt = 0; attempt < 40 && !await status(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await log.close();
  if (!await status()) throw new Error(`工作台启动失败，请查看日志：${logPath}`);
}

if (process.env.REVIEW_NO_OPEN !== '1') openBrowser();
console.log(`WorkBuddy 工作复盘已打开：${url}`);
console.log(`本地数据目录：${dataRoot}`);
