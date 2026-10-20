# WorkBuddy Review Workbench

一个只面向国内版 WorkBuddy 的本地工作复盘台。它只读读取本机 WorkBuddy 对话，让你按任意时间段和关键词筛选记录，再由 WorkBuddy 手动生成一份时间段复盘。本项目不读取国际版 WorkBuddy AI 的数据。

数据默认保存在本机；只有你点击“生成复盘”时，应用才会调用已经登录的 WorkBuddy CLI。项目与 WorkBuddy 官方无隶属关系。

## 安装为 WorkBuddy Skill

```bash
npx skills add qiqi-huang-ai/qiqi-workbuddy-work-review -g -y
```

安装后对 WorkBuddy 说：

> 打开 WorkBuddy 工作复盘台

WorkBuddy 会运行 Skill 自带的启动脚本并打开本地工作台。安装包不包含作者的对话、复盘或其他私人数据。

## 能做什么

- 只读浏览指定日期范围内有消息活动的 WorkBuddy 对话；
- 用关键词搜索范围内的完整用户消息与 WorkBuddy 回复；
- 使用全部匹配会话，或手动勾选要纳入复盘的会话；
- 使用内置、可审查的原创复盘规则；
- 通过 WorkBuddy CLI 的非持久会话，禁用工具后手动生成；
- 保存多次 AI 版本，并把用户修正独立保存；
- 将真实本地数据与脱敏演示数据分开。

## 要求

- Node.js 22 或更高版本；
- 已安装并登录 WorkBuddy 桌面应用；
- 本机存在国内版 WorkBuddy 会话记录（默认读取 `~/.workbuddy`，并拒绝国际版 `~/.workbuddy-ai`）。

## 从源码启动

```bash
git clone https://github.com/qiqi-huang-ai/qiqi-workbuddy-work-review.git
cd qiqi-workbuddy-work-review
npm start
```

打开 <http://127.0.0.1:4319>。应用仅监听本机回环地址。

## 使用

1. 在“复盘工作台”选择日期范围。日期按 `Asia/Shanghai` 的消息发生时间计算。
2. 关键词留空时读取范围内全部未删除会话；填写关键词后会显示命中位置和上下文。
3. 选择“使用全部匹配结果”，或者取消勾选无关会话后选择“仅使用已勾选对话”。
4. 补充原计划、验收标准等资料后，手动生成这个时间段的复盘。
5. 结果会保存在本地；在详情中保存的个人修正不会被重新生成覆盖。

生成时调用 WorkBuddy 应用内的 `codebuddy --print`，同时使用 `--tools ""`、`--no-session-persistence` 和单轮限制。它不会修改原始会话，也不会创建新的历史会话。

## 配置

| 环境变量 | 用途 | 默认值 |
| --- | --- | --- |
| `PORT` | 本地服务端口 | `4319` |
| `WORKBUDDY_HOME` | 国内版 WorkBuddy 数据目录 | `~/.workbuddy` |
| `WORKBUDDY_BIN` | WorkBuddy CLI 可执行文件 | macOS 应用内 CLI，找不到时使用 `codebuddy` |
| `REVIEW_RULES_PATH` | 自定义复盘规则文件 | `rules/review-rules.md` |
| `REVIEW_DATA_HOME` | 派生数据目录 | Skill 启动时为 `~/.workbuddy-review-workbench/data` |

## 本地数据

通过 Skill 启动时，应用只会向 `~/.workbuddy-review-workbench/data/` 写入派生数据；从源码运行 `npm start` 时使用项目内的 `data/`：

- `sources/workbuddy/`：采集批次元数据；
- `normalized/`：用于复盘的完整证据包；
- `reviews/`：WorkBuddy 生成的复盘版本；
- `corrections/`：用户个人修正；
- `rules/`：每次生成所用规则的版本信息；
- `logs/`：本地操作日志；
- `demo/`：可提交的脱敏演示数据。

真实数据目录已由 `.gitignore` 排除。备份时复制实际数据目录；恢复时停止应用后复制回原位置。应用不会修改 `~/.workbuddy` 中的原始会话。

## 兼容性边界

本项目读取 WorkBuddy 当前使用的 `workbuddy.db` 与 `projects/**/*.jsonl`。WorkBuddy 后续版本若调整本地数据格式，连接状态会明确显示为不可用，需要更新适配器后再使用。

## 验证

```bash
npm run check
```

项目采用 [MIT License](LICENSE)。安全与隐私问题请参阅 [SECURITY.md](SECURITY.md)。
