import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {PROJECT_ROOT} from './store.mjs';

const MAC_APP_CLI = '/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy';
const WORKBUDDY_BIN = process.env.WORKBUDDY_BIN || (existsSync(MAC_APP_CLI) ? MAC_APP_CLI : 'codebuddy');

function assertDomesticCli() {
  if (WORKBUDDY_BIN.includes('/WorkBuddy AI.app/')) {
    throw new Error('本项目只支持国内版 WorkBuddy，不能调用国际版 WorkBuddy AI');
  }
}

function runProcess(args, input = '', timeoutMs = 15 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const child = spawn(WORKBUDDY_BIN, args, {
      cwd: PROJECT_ROOT,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('WorkBuddy 生成超过 15 分钟，已停止本次运行'));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-200_000); });
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-20_000); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({stdout, stderr});
      else reject(new Error(`WorkBuddy 调用失败（${code}）：${stderr.trim().slice(-1200) || '没有错误详情'}`));
    });
    child.stdin.end(input);
  });
}

export async function inspectWorkBuddyCli() {
  try {
    assertDomesticCli();
    const {stdout: version} = await runProcess(['--version'], '', 10_000);
    return {status: '已接通', path: WORKBUDDY_BIN, version: version.trim(), authentication: '生成时使用当前 WorkBuddy 登录状态'};
  } catch (error) {
    return {status: '不可用', path: WORKBUDDY_BIN, error: error.message};
  }
}

export async function runWorkBuddyReview(prompt) {
  assertDomesticCli();
  const startedAt = Date.now();
  const {stdout} = await runProcess([
    '--print',
    '--output-format', 'text',
    '--permission-mode', 'dontAsk',
    '--tools', '',
    '--no-session-persistence',
    '--max-turns', '1',
  ], prompt);
  const content = stdout.trim();
  if (!content) throw new Error('WorkBuddy 没有返回复盘正文');
  return {content, durationMs: Date.now() - startedAt};
}
