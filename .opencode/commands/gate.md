---
description: "Run the full gate (BUNNY.md §7.1) on a task's worktree. Usage: /gate <task> <slot>"
agent: verifier
subtask: true
---

Run the full gate, BUNNY.md §7.1, on worktree `~/bunny/wt/bunny-$1` in slot `$2`. Save the logs in
`~/bunny/evidence/$1/`, and report one line per step with its exit code and counts.
