# Build Week submission checklist

Deadline: **July 21, 2026 at 5:00 PM Pacific**.

## Product — complete locally

- [x] Working web project
- [x] Judge-facing Balance Lab
- [x] Real 280-battle before/after tuning evidence
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
- [ ] Create a public GitHub repository, or share a private repository with `testing@devpost.com` and `build-week-event@openai.com`
- [ ] Deploy the Vite app to a free public URL
- [ ] Add the deployment and repository URLs to README and Devpost
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

Expected: 139 tests pass; 280-battle audit completes with no dominance flag; production build succeeds.
