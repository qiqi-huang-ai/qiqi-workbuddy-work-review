# Project rules

- Keep this application independent. Do not modify WorkBuddy source data, older workbenches, or unrelated automations.
- Prefer the smallest implementation that completes the review loop.
- Treat `rules/review-rules.md` as the review-method source of truth.
- Never infer that missing records mean no work happened.
- Never count plans, discussions, or assistant completion claims as verified completion.
- User corrections take precedence and must survive regeneration.
- Keep demo data separate from real imported or collected data.
- Record actual implementation and verification status in `ROADMAP.md`.
