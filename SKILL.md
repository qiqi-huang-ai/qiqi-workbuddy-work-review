---
name: qiqi-workbuddy-work-review
description: Start and use a local review workbench for the mainland China WorkBuddy app when the user wants to review work from WorkBuddy history by date range or keyword. It does not read the international WorkBuddy AI app.
---

# WorkBuddy Work Review

Use the bundled local workbench for mainland China WorkBuddy conversation reviews. Do not substitute the international WorkBuddy AI app or its `~/.workbuddy-ai` data directory.

## Start the workbench

From this skill directory, run:

```bash
node scripts/start-workbench.mjs
```

Then give the user the printed local URL. Do not click “生成复盘” or generate a review unless the user explicitly asks; opening and filtering the workbench is read-only.

The workbench requires Node.js 22+, a readable WorkBuddy history directory, and an authenticated WorkBuddy desktop app. If startup reports a missing prerequisite, explain that exact requirement instead of substituting another AI service.

## Data boundaries

- Read WorkBuddy source history without modifying it.
- Store derived evidence, reviews, corrections, and logs under `~/.workbuddy-review-workbench/data` by default.
- Keep user corrections separate from AI-generated versions.
- Missing records mean insufficient evidence, not that no work happened.
- Never include private local data in repository commits, screenshots, or issue reports.

## Stop the workbench

When the user asks to stop it, run:

```bash
node scripts/stop-workbench.mjs
```

For setup, backup, configuration, and development details, read [README.md](README.md).
