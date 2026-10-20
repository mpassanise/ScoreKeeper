# Scorekeeper iteration workflow

- After every implementation iteration, run relevant checks and perform a software-architect code review of the complete final PR diff before reporting readiness for merge. Passing CI is not a substitute for this review.
- Review account/lifecycle isolation and races, local durability, original operation/entry IDs and receipts, unknown outcomes, duplicate prevention, recovery/archive preservation, deletion suppression, error paths, performance, and web/iPhone parity.
- Reproduce suspected defects where practical. Within an authorized implementation iteration, fix verified issues, rerun affected checks and review the final fix diff. Report unresolved findings by severity and disclose unverified browser/physical-device acceptance.
- For a standalone review request, report verified findings; do not make unrelated implementation changes.
- Update `docs/OFFLINE_FIRST_SYNC_PLAN.md` with the iteration outcome and next step.
- Do not merge, deploy, activate rollout flags or spend paid Expo builds without applicable user authorization.
