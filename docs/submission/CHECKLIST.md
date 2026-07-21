# Build Week submission checklist

Deadline: **July 21, 2026 at 5:00 PM Pacific**.

## Product — complete locally

- [x] Working web project
- [x] Judge-facing Balance Lab
- [x] Real 280-battle before/after tuning evidence
- [x] Final pass: 8 / 28 healthy, 37-point spread, Mule Skirmisher 50%
- [x] JSON evidence export
- [x] Reproducible CLI workflow
- [x] 139 simulation tests passing
- [x] Simulation and production web builds passing
- [x] Setup and testing instructions
- [x] Codex/GPT-5.6 collaboration documented
- [x] Pre-existing vs. Build Week work evidenced by dated Git history
- [x] MIT license for a public repository

## External actions — required before submission

- [ ] Register/join the hackathon on Devpost
- [x] Create a public GitHub repository: https://github.com/nykwil/MechBattler
- [x] Deploy the Vite app: https://nykwil.github.io/MechBattler/
- [x] Add the deployment and repository URLs to README and Devpost
- [ ] Capture 3–5 clean screenshots, including Balance Lab results and Workshop
- [ ] Record the demo using `DEMO-SCRIPT.md`
- [ ] Upload the under-3-minute video publicly to YouTube
- [ ] Run `/feedback` in the primary Codex task and copy the session ID
- [ ] Paste and tailor `DEVPOST.md` into the submission form
- [ ] Select **Developer Tools**
- [ ] Verify the project is free and accessible without login through August 5
- [ ] Submit well before 5:00 PM Pacific and confirm the submitted state

## Final smoke test

```bash
npm install
npm run sim:test
npm run sim:balance -- 10
npm run web:build
```

Expected: 139 tests pass; 280-battle audit completes with no dominance flag, 8 / 28 healthy matchups, 37-point spread, and Mule Skirmisher at 50%; production build succeeds.
