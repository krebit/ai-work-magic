# Task 9 Report: Authoritative Live Browser Spec

Date: 2026-08-17

## Outcome

Implemented and committed `evals/specs/kdp-research-live.slow.test.ts` as commit `8a0963d55` (`test: prove live KDP research end to end`). The commit contains only the required spec file.

The spec uses `test` from `@openwork/testkit`; direct machine assertions and the ambient testkit tape are the verdict. Four `screenshot()`/`validate()` checkpoints are diagnostic witnesses only.

Evidence lane status: **Incomplete**. The live command was not run because the full stack was not genuinely available: AMM and Den readiness endpoints were unreachable and all four required AMM/provider credentials were absent. The non-live run skipped through explicit `needs()` gates. Per `AGENTS.md`, that skip is not a pass.

## Implemented coverage

- Exact test title, live opt-ins, required secrets, tool-capable model requirement, exact prompt, hard limits, and 180-second Den/AMM terminal wait.
- Unique active/alternate workspaces, seeded signed-in Den organization, explicit AMM entitlement and bounded usage bucket, healthy `openwork-cloud`, Portfolio initialization, installed skill selection, and browser chat submission.
- Direct Den MCP discovery plus Den MySQL assertions for exactly one operation, one completion ledger event, and reconciled reservation.
- A forwarding witness that observes the actual Den-to-AMM headers/body while forwarding to the real AMM API; the service key is compared without printing it.
- Direct AMM PostgreSQL assertions for one managed run, allowed terminal state/warnings, exact downstream request limits, real DataForSEO/SerpApi usage events, cost/accounting, and global corpus scope.
- Local Portfolio API/filesystem/SQLite assertions for exactly one Amazon KDP research project, terminal run, sealed snapshot and digest, typed observations, immutable evaluation digests, registered brief artifact/version/evidence link, and empty decision log.
- Identical `execute_capability` retry with assertions that Den operation/AMM run identity, managed-run count, provider event count/quantity/cost, and collection POST count do not change.
- Negative assertions for service-key absence across browser DOM/storage/response bodies, chat, Portfolio YAML/SQLite/canonical history, observations/evaluations, brief, logs, screenshots, AMM responses, and the finalized tape.
- Negative identity assertions across captured Den-to-AMM headers/body and AMM corpus rows, including no Den/customer/workspace/Portfolio identifiers and no Den operation linkage in corpus rows.
- Alternate-workspace equality and no decision, book, manuscript, publication, campaign, lifecycle, or non-research project creation.
- Direct UI assertions for the canonical history details in addition to diagnostic visual validation.

## Files

Created and committed:

- `evals/specs/kdp-research-live.slow.test.ts`

Created for handoff and intentionally ignored/uncommitted:

- `.superpowers/sdd/KDP_RESEARCH_LIVE_E2E_IMPLEMENTATION_PLAN/task-9-report.md`

Preserved without staging or modification by this task:

- `.opencode/package-lock.json`
- `.amm/portfolio.sqlite`
- `portfolio.yaml`

## Verification commands and exact output

### Eval package typecheck entry point

Command:

```bash
pnpm --dir evals typecheck
```

Exit: 1

```text
/home/alerios/.bash_profile: line 6: /home/alerios/.cargo/env: No such file or directory
$ tsc -p .
sh: 1: tsc: not found
[ELIFECYCLE] Command failed.
```

The eval package install does not expose its own `tsc` binary. No dependency or lockfile change was made because Task 9 is spec-only and the existing `.opencode/package-lock.json` change belongs to another task/user.

### Repository TypeScript baseline

Command:

```bash
./node_modules/.bin/tsc -p evals --pretty false
```

Exit: 2

```text
/home/alerios/.bash_profile: line 6: /home/alerios/.cargo/env: No such file or directory
evals/specs/authenticated-install.test.ts(5,55): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../../ee/apps/den-web/app/(den)/_lib/install-download.js'?
evals/specs/desktop-blank-slate-profile.test.ts(9,8): error TS7016: Could not find a declaration file for module '../../apps/desktop/electron/blank-slate-profile.mjs'. '/home/alerios/Tech/ai-agents/ai-work-magic/apps/desktop/electron/blank-slate-profile.mjs' implicitly has an 'any' type.
evals/specs/desktop-blank-slate-profile.test.ts(35,71): error TS7006: Parameter 'key' implicitly has an 'any' type.
evals/specs/enterprise-invite-install-connect.slow.test.ts(13,36): error TS7016: Could not find a declaration file for module '../../apps/desktop/electron/runtime.mjs'. '/home/alerios/Tech/ai-agents/ai-work-magic/apps/desktop/electron/runtime.mjs' implicitly has an 'any' type.
evals/specs/enterprise-signin-gate.test.ts(8,8): error TS7016: Could not find a declaration file for module '../../apps/desktop/electron/desktop-distribution.mjs'. '/home/alerios/Tech/ai-agents/ai-work-magic/apps/desktop/electron/desktop-distribution.mjs' implicitly has an 'any' type.
evals/specs/enterprise-signin-gate.test.ts(55,5): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../../apps/app/src/app/lib/organization-server-input.js'?
evals/specs/enterprise-tls-chain-repair.test.ts(9,36): error TS7016: Could not find a declaration file for module '../../apps/desktop/electron/runtime.mjs'. '/home/alerios/Tech/ai-agents/ai-work-magic/apps/desktop/electron/runtime.mjs' implicitly has an 'any' type.
evals/specs/enterprise-tls-chain-repair.test.ts(135,5): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../../apps/app/src/app/lib/organization-server-input.js'?
evals/specs/headless-web-source-server.test.ts(5,43): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../../scripts/dev-headless-web-lib.js'?
evals/specs/install-confirm-app-running.test.ts(9,8): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../../ee/apps/den-web/app/(den)/_lib/install-guide.js'?
evals/specs/join-success-os-download.test.ts(7,8): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../../ee/apps/den-web/app/(den)/_lib/install-download.js'?
evals/specs/mcp-app-inline-host.slow.test.ts(595,24): error TS2769: No overload matches this call.
  Overload 1 of 2, '(actual: boolean, message?: string | undefined): Assertion<boolean>', gave the following error.
    Argument of type 'unknown' is not assignable to parameter of type 'string | undefined'.
  Overload 2 of 2, '(val: any, message?: string | undefined): Assertion', gave the following error.
    Argument of type 'unknown' is not assignable to parameter of type 'string | undefined'.
evals/specs/three-desktop-builds.test.ts(10,8): error TS7016: Could not find a declaration file for module '../../apps/desktop/electron/desktop-distribution.mjs'. '/home/alerios/Tech/ai-agents/ai-work-magic/apps/desktop/electron/desktop-distribution.mjs' implicitly has an 'any' type.
evals/specs/welcome-one-field.test.ts(8,8): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../../apps/app/src/react-app/domains/cloud/join-organization-input.js'?
evals/specs/windows-artifact-signing.test.ts(61,9): error TS18048: 'artifactPattern' is possibly 'undefined'.
```

All reported errors are in pre-existing unrelated specs; none references `kdp-research-live.slow.test.ts`.

### Isolated strict typecheck for the new spec

Command:

```bash
./node_modules/.bin/tsc --noEmit --strict --module nodenext --moduleResolution nodenext --target es2023 --lib es2023,esnext.disposable --allowImportingTsExtensions --erasableSyntaxOnly --verbatimModuleSyntax --skipLibCheck --types node evals/specs/kdp-research-live.slow.test.ts
```

Exit: 0

```text
/home/alerios/.bash_profile: line 6: /home/alerios/.cargo/env: No such file or directory
```

### AMM PostgreSQL subprocess argument check

Command:

```bash
node --input-type=module --eval 'console.log(JSON.stringify(process.argv))' 'SELECT 1' '[]'
```

Working directory: `/home/alerios/Tech/ai-agents/ai-api-magic`

Exit: 0

```text
/home/alerios/.bash_profile: line 6: /home/alerios/.cargo/env: No such file or directory
["/home/alerios/.nvm/versions/node/v23.11.0/bin/node","SELECT 1","[]"]
```

This verifies the spec's child-process query program reads SQL from `process.argv[1]` and parameters from `process.argv[2]`.

### Live stack preflight

Command:

```bash
pnpm amm:kdp:preflight
```

Exit: 1

```text
/home/alerios/.bash_profile: line 6: /home/alerios/.cargo/env: No such file or directory
$ node scripts/amm-kdp-live-preflight.mjs
{
  "status": "incomplete",
  "endpoints": [
    {
      "endpoint": "http://127.0.0.1:3000/api/v1/health",
      "statusCode": null
    },
    {
      "endpoint": "http://127.0.0.1:3000/api/v1/ready",
      "statusCode": null
    },
    {
      "endpoint": "http://127.0.0.1:8790/health",
      "statusCode": null
    },
    {
      "endpoint": "http://127.0.0.1:8790/ready",
      "statusCode": null
    }
  ],
  "secrets": [
    {
      "name": "DEN_TO_AMM_SERVICE_KEY",
      "status": "missing"
    },
    {
      "name": "DATAFORSEO_LOGIN",
      "status": "missing"
    },
    {
      "name": "DATAFORSEO_PASSWORD",
      "status": "missing"
    },
    {
      "name": "SERPAPI_API_KEY",
      "status": "missing"
    }
  ]
}
[ELIFECYCLE] Command failed with exit code 1.
```

Because preflight was incomplete, the opted-in live command was intentionally not run.

### Non-live spec collection and gate validation

Command:

```bash
pnpm --dir evals exec vitest run --config vitest.config.ts --project stack specs/kdp-research-live.slow.test.ts
```

Exit: 0

```text
/home/alerios/.bash_profile: line 6: /home/alerios/.cargo/env: No such file or directory

 RUN  v3.2.7 /home/alerios/Tech/ai-agents/ai-work-magic/evals

 ✓ |stack| specs/kdp-research-live.slow.test.ts (1 test | 1 skipped) 15ms
   ↓ KDP research flows through Den and real AMM providers into the local Portfolio [needs: set DEN_TO_AMM_SERVICE_KEY, set DATAFORSEO_LOGIN, set DATAFORSEO_PASSWORD, set SERPAPI_API_KEY, set OPENWORK_EVAL_APP_SPECS=1, set OPENWORK_EVAL_KDP_LIVE=1, set OPENWORK_EVAL_MODEL, set OPENAI_API_KEY or ANTHROPIC_API_KEY]

 Test Files  1 passed (1)
      Tests  1 skipped (1)
   Start at  11:23:48
   Duration  926ms (transform 544ms, setup 0ms, collect 747ms, tests 15ms, environment 0ms, prepare 64ms)
```

This proves module collection and gate reporting only. Evidence verdict remains **Incomplete** because the one test skipped.

### Staged scope and whitespace

Command:

```bash
git add evals/specs/kdp-research-live.slow.test.ts && git diff --cached --check && git diff --cached --name-only && git diff --cached --stat
```

Exit: 0

```text
/home/alerios/.bash_profile: line 6: /home/alerios/.cargo/env: No such file or directory
evals/specs/kdp-research-live.slow.test.ts
 evals/specs/kdp-research-live.slow.test.ts | 1168 ++++++++++++++++++++++++++++
 1 file changed, 1168 insertions(+)
```

### Commit

Command:

```bash
git commit -m "test: prove live KDP research end to end"
```

Exit: 0

```text
/home/alerios/.bash_profile: line 6: /home/alerios/.cargo/env: No such file or directory
[amm-dev 8a0963d55] test: prove live KDP research end to end
 1 file changed, 1168 insertions(+)
 create mode 100644 evals/specs/kdp-research-live.slow.test.ts
```

### Post-commit scope verification

Command:

```bash
git show --check --stat --oneline --decorate --no-renames HEAD && git diff HEAD^ HEAD --name-only && git status --short --branch && test -f .superpowers/sdd/KDP_RESEARCH_LIVE_E2E_IMPLEMENTATION_PLAN/task-9-report.md && echo task-9-report-present
```

Exit: 0

```text
/home/alerios/.bash_profile: line 6: /home/alerios/.cargo/env: No such file or directory
8a0963d55 (HEAD -> amm-dev) test: prove live KDP research end to end
evals/specs/kdp-research-live.slow.test.ts
## amm-dev...origin/amm-dev [ahead 46]
 M .opencode/package-lock.json
?? .amm/
?? portfolio.yaml
task-9-report-present
```

## Exact live repro when the stack is available

```bash
pnpm amm:kdp:preflight

OPENWORK_EVAL_APP_SPECS=1 \
OPENWORK_EVAL_KDP_LIVE=1 \
pnpm --dir evals exec vitest run \
  --config vitest.config.ts \
  --project stack \
  specs/kdp-research-live.slow.test.ts
```

Required result for `Passed`: one test passed, zero skipped, with the ambient `@openwork/testkit` tape finalized and free of the raw service key.

## Concerns / expected live failures to investigate

1. Static inspection of `apps/app/src/react-app/domains/portfolio/research-history.tsx` shows the current history UI renders counts, observation rows, evidence version IDs, and the decision log, but does not render run status, snapshot digest, evaluation policy identity, or evaluation result digest. The Task 9 spec intentionally retains direct assertions for those required visible details; it does not weaken them for the current UI.
2. Static inspection of the sibling AMM worker shows SerpApi calls invoke the provider usage wrapper without a `costFor` callback. That normalizes settled `costUsd` to `null`, while AMM aggregate finalization rejects unresolved provider costs. A real KDP collection may therefore fail before reaching an allowed terminal state until AMM provides a concrete SerpApi cost. The spec intentionally requires reconciled real-provider cost and does not relax this boundary.
3. No live tape or screenshots were produced because credentials/services were unavailable. The only authoritative verdict possible in this environment is **Incomplete**.

## Review fix round

- Den now treats a completed same-key/same-digest POST as a terminal idempotent
  replay: it fetches the existing downstream result, reconciles at most once,
  and returns the same public operation without starting another run. Route
  coverage is green (44 tests, 220 assertions).
- Portfolio Research history now renders terminal run status, snapshot digest,
  evaluation policy, and evaluation result digest in the existing fork-owned
  surface.
- The live tape installs its browser response witness before cloud sign-in and
  defers visual capture until non-visual secret surfaces have passed scanning;
  captured images are scanned immediately afterward.
- Focused Den typecheck and app typecheck pass. The live tape still reports
  **Incomplete** here because the required services/credentials are absent.

Remaining deployment caveat: the Electron host inherits the parent process
environment by design, so operators must run the live tape from a scrubbed
environment containing only the explicitly documented credentials. The tape
never prints those values and records this requirement rather than claiming a
secret-isolation guarantee that the host cannot provide.
