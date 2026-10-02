# Working in this repo

This repo is worked on from two computers (a Mac and the shop PC), often by AI
sessions on both at once. Each computer copies its uncommitted work to its own
GitHub branch, `wip/<computer>`, every 15 minutes (`scripts/sync.mjs`).

- Start of work: `npm run sync`. It pulls `main` and lists anything the other
  computer has not committed.
- Deploy Convex only with `npm run deploy:convex`, never a bare `npx convex deploy`.
  A Convex deploy replaces the whole function set, so deploying from a tree that
  lacks the other computer's files deletes those functions in production. The
  script refuses while anything is uncommitted, unpushed or behind here, or
  while the other computer has uncommitted work.
- Commit and push each finished piece of work. Do not commit `wip/*` branches into
  `main`; take single files from them with `git checkout origin/wip/<computer> -- <file>`.
