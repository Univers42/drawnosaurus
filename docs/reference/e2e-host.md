# Running the browser suite on the host

`make test-e2e` runs Playwright on the host, not in Docker. These are the ways the host can
break the suite, and none of them is the code under test.

- Locally, trace writing can fail with `ENOENT` on `test-results/.playwright-artifacts-*` because this
  checkout is on a network filesystem — it fails the test it was tracing and looks like a flake. Add
  `--trace=off` when running by hand; CI runs on a normal disk where `retain-on-failure` is worth it.
- Browsers do **not** fit in `$HOME` on the lab machines — the quota is 4.7G and a chromium install is
  ~400M, so `playwright install` dies with `ENOSPC` and, worse, leaves the cache half-deleted, which
  reads as "Executable doesn't exist" on the next run. Export
  `PLAYWRIGHT_BROWSERS_PATH=/sgoinfre/students/$USER/.cache/ms-playwright` before installing or
  running; `/sgoinfre` has terabytes. Keep it set for both, or the suite installs to one place and
  looks in another.
- Playwright 1.63 launches `chromium-headless-shell` for `headless: true`, which is **not** the same
  binary as `chromium`. Forcing the full build with `channel: "chromium"` is a valid workaround for a
  missing shell, but it is a different renderer: it failed four `bucket`/`eraser` specs that pass on
  both builds of the shell. Take a control run before believing a failure found that way.
