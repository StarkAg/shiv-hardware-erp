# Project names

The owner wants one name per project, the same on GitHub and on disk. Keep these
names; do not rename the repos or the folders to something else.

| Project | GitHub repo | Folder |
|---|---|---|
| Panel / ERP (this repo) | `StarkAg/shiv-hardware-erp` | `Ramgarh/shiv-hardware-erp` |
| Shop website | `StarkAg/shivhardware` | `Ramgarh/shivhardware` |

Until 2026-11-20 the folders on the Mac were `Shiv_Panel` and
`ShivHardware_Site_V1`. Older notes and code comments may still say `Shiv_Panel`;
it means this repo. The shop PC's folders should carry the same names.

When the Mac folders were renamed, two things that held the old path were fixed:
the print-server launch agent (`~/Library/LaunchAgents/in.shivhardware.printserver.plist`)
and the git worktrees under `.claude/worktrees/` (`git worktree repair`).

## Old repos, kept on purpose

Checked on 2026-11-20. The owner chose to leave these as they are: not archived, not deleted.

- `StarkAg/ShivLedger`: the old standalone ledger. Its books moved into this panel
  (`scripts/migrate-ledger.mjs`). Its Vercel app `shiv-ledger` and Convex prod
  `calm-ibex-59` are still up, but the newest voucher there is from 2026-09-17.
  The clone at `separate-apps/ShivLedger` has one unpushed commit ("Advance vouchers", 2026-10-29).
- `StarkAg/shiv-hardware-site` (folder `ShivHardware_Site_V2`): the July 2026 shop-site redesign
  with the door-making video. It was never deployed and isn't in `shivhardware`.
- `StarkAg/Hardware-Shop`: the first shop-site prototype (Nov 2025). It is public and not deployed;
  `shivhardware` was started fresh and doesn't share its history.
