# Repository instructions

## Commits and pushes

- All commits must follow Conventional Commits.
- Commit and push changes autonomously as appropriate, without asking for confirmation.
- Group changes into meaningful, cohesive commits.
- Push only when GitHub Actions should run; avoid unnecessary pushes that waste compute resources.

## OpenSpec completion

- When an OpenSpec change is fully implemented and the user has verified the implementation, automatically sync that change's delta specs to the main specs without asking for additional confirmation.
- After syncing, archive the matching change automatically if no implementation tasks, verification, or other required work remain. Otherwise, keep the change active and report the remaining work.
