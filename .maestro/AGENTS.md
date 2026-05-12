# Maestro Project Bootstrap

This project uses Maestro for local bootstrap and runtime orchestration.

## Layout

- `.maestro/bootstrap/` contains committed project bootstrap assets
- `.maestro/skills/` contains project-local agent skills
- `.maestro/missions/` and `.maestro/sessions/` contain runtime state (handoff packets live globally at `~/.maestro/handoff/`)
- `.maestro/tasks/contracts/` stores one task contract JSON per task plus an append-only index
- `.maestro/tasks/contract-templates/` stores reusable contract draft YAML templates such as `default.md`
- `skills/built-in/` contains shipped built-in fallback skills

## Task Contracts

- Create and lock a task contract before non-trivial work:
  - `maestro task contract new <id>`
  - `maestro task contract lock <id>`
- Reusable drafts live under `.maestro/tasks/contract-templates/`; `maestro task contract new <id> --from default` loads `.maestro/tasks/contract-templates/default.md`.
- Inspect or clean up contract drafts:
  - `maestro task contract edit <id>`
  - `maestro task contract show <id>`
  - `maestro task contract verdict <id>`
  - `maestro task contract list`
  - `maestro task contract discard <id>`
  - `maestro task contract reopen <id>`
- Amend a locked contract with a recorded reason:
  - `maestro task contract amend <id> --reason "..." `
- Manage criteria directly while the contract is active:
  - `maestro task contract criteria mark <id> <criterionId> --met`
  - `maestro task contract criteria add <id> "..." `
  - `maestro task contract criteria remove <id> <criterionId>`
- Use `--session <id>` on new/edit/lock/discard/amend/criteria commands when the owning task is already claimed outside the current shell.
- Completion can enforce contracts with `maestro task update <id> --status completed --strict`.
- Claiming can remind or require contract setup with `maestro task claim <id> --contract-required`; use `--no-contract` to suppress the note for a single claim.
- Use `--no-contract` only when config requires a contract but the task intentionally has none.
- After completion, `task contract show` includes the stored verdict.
- Set `contracts.overlapPolicy: annotate` to allow overlapping active contracts while still recording the overlap in verdicts.
- Reopening a completed task reactivates its contract, clears the stored verdict, and preserves amendment history. Previously amended contracts reopen as amended.
- Deleting a task removes its linked contract file and appends a `task_deleted` discard record to the contract index.
- `.maestro/tasks/NOW.md` adds a one-line contract status summary for active contracted work.
- Stale reclaim inherits active contract ownership by default; set `contracts.staleReclaimContractPolicy: block` to refuse it.
- Handoff pickup transfers active contract ownership with the linked task.

## Shared Task Loop

- Inspect active work with:
  - `maestro status --json`
  - `maestro task ready --json --compact --limit 5`
  - `maestro task show <id>`
- Claim and start work with:
  - `maestro task claim <id>`
  - `maestro task update <id> --status in_progress`
  - `maestro task claim <id> --contract-required`
  - `maestro task claim <id> --no-contract`
- Keep resume state fresh while working:
  - `maestro task update <id> --current-state "..." --next-action "..."`
  - `maestro task update <id> --add-decision "keep api stable"`
  - `maestro task update <id> --remove-decision "old constraint"`
- Complete with a receipt when useful:
  - `maestro task update <id> --status completed --reason "<one-line outcome>"`
  - `maestro task update <id> --status completed --reason "<one-line outcome>" --summary "<receipt summary>" --surprise "<gotcha>" --verified-by <name>`
  - add `--strict` to block completion on a broken contract verdict
- Discover context and stalled work with:
  - `maestro task similar <id>`
  - `maestro task mine`
  - `maestro task stuck [--older-than 4h]`
- Keep claims alive or recover stale ownership with:
  - `maestro task heartbeat <id>`
  - `maestro task claim <id> [--stale-after 4h]`
  - `maestro task update <id> ... --silent` or `MAESTRO_TASK_SILENT=1`
- Bound local-only task artifacts with:
  - `maestro task prune --dry-run`
  - `maestro task prune [--keep N] [--candidates-only|--continuations-only] [--all]`
- `.maestro/tasks/NOW.md` is refreshed after task mutations; `cat` it for a short in-progress/ready/stuck view.

## Agent Skill Lookup

1. `.maestro/skills/{agentType}/SKILL.md`
2. `skills/built-in/{agentType}/SKILL.md`

## Bootstrap Assets

- `.maestro/bootstrap/init.sh` is the local setup script
- `.maestro/bootstrap/services.yaml` defines commands and service helpers
- `.maestro/bootstrap/library/` stores reusable local guidance
- `.maestro/bootstrap/validation/` stores local validation/reference artifacts

## Project Conventions

For repo-level code conventions, build commands, and feature boundaries, see the project root `AGENTS.md` (and `CLAUDE.md`). This file holds Maestro-specific bootstrap notes only.
