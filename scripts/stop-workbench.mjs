#!/usr/bin/env node
import {readFile, unlink} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';

const dataRoot = path.resolve(process.env.REVIEW_DATA_HOME || path.join(homedir(), '.workbuddy-review-workbench', 'data'));
const pidPath = path.join(dataRoot, '.workbench.pid');

try {
  const pid = Number((await readFile(pidPath, 'utf8')).trim());
  if (!Number.isInteger(pid) || pid <= 1) throw new Error('PID 文件无效');
  process.kill(pid, 'SIGTERM');
  await unlink(pidPath).catch(() => {});
  console.log(`WorkBuddy 工作复盘已停止（PID ${pid}）`);
} catch (error) {
  if (error.code === 'ENOENT' || error.code === 'ESRCH') {
    await unlink(pidPath).catch(() => {});
    console.log('WorkBuddy 工作复盘当前未运行');
  } else {
    throw error;
  }
}
