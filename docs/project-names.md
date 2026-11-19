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
