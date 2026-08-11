# Quickstart: Validate the Spec Kit Foundation

Run from the repository root.

## 1. Verify the pinned tool and integration fleet

Spec Kit is an operator tool rather than an npm dependency. If it is absent or
does not report the pinned version, install the reviewed upstream revision
explicitly (this network/global-tool mutation requires operator approval):

```bash
uv tool install --force \
  "git+https://github.com/github/spec-kit.git@4871b485f97c7fa452ec58eba325d87536c55c34"
```

Do not use `specify self upgrade` as part of project startup. Review a new
release and regenerate adapters on a dedicated feature instead.

```bash
specify --version
specify integration status
specify extension list
specify workflow list
```

Expected:

- Spec Kit reports `0.16.2`.
- Default integration is `codex`.
- Installed integrations are Codex, Claude, Cursor, and Gemini; status is `OK` with zero managed-file
  problems.
- The only enabled extension is bundled `assess`.
- The upstream bundled workflow is present but is not executed automatically.

## 2. Verify feature resolution

Feature selection is intentionally worktree-local. In a fresh checkout, seed
the ignored `.specify/feature.json` once from the active roadmap owner:

```bash
SPECIFY_FEATURE_DIRECTORY=specs/001-spec-kit-foundation \
  .specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks
```

Subsequent phases can resolve the persisted pointer without the environment
override:

```bash
.specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks
```

Expected JSON resolves the feature directory and lists all generated design
artifacts without relying on the Git branch name. Change the explicit path
when the roadmap selects another feature; never commit `feature.json`.

## 3. Verify generated infrastructure

```bash
bash -n .specify/scripts/bash/*.sh
node --test tests/spec-kit-contract.test.js tests/docs-truth.test.js
```

Expected: all shell files parse and all canonical-tree/document-ownership checks pass.

## 4. Verify application truth and packaging boundaries

```bash
node --test tests/privacy-claims.test.js tests/model-free-contract.test.js \
  tests/immutable-image.test.js tests/npm-pack-manifest.test.js
```

Expected: canonical baseline copy matches runtime privacy/model boundaries, generated governance is
excluded from the runtime image and npm packages, and no retired architecture path is required.

## 5. Run the complete repository gate

```bash
npm run ci
git diff --check
```

Expected: formatting, lint, JSDoc type checking, the full test suite with coverage, and whitespace
checks all pass. This feature has no production smoke or deployment step because it changes no
runtime source or configuration.

## 6. Reproduce the fleet in a disposable fixture

This proves the generator independently of the current checkout. It creates no
commit and touches no real project:

```bash
fixture_dir="$(mktemp -d -t ortbtools-speckit-XXXXXX)"
cd "$fixture_dir"
git init

specify init --here --force --script sh --ignore-agent-tools \
  --integration codex --integration-options="--skills" \
  --extension assess
specify integration install claude --script sh
specify integration install cursor-agent --script sh
specify integration install gemini --script sh

# Extensions render commands into the active adapter, so synchronize each one
# and restore Codex as the default.
specify integration use claude
specify integration use cursor-agent
specify integration use gemini
specify integration use codex
chmod +x .specify/scripts/bash/*.sh

specify integration status
specify extension list
bash -n .specify/scripts/bash/*.sh
```

Expected: the same four integrations, Codex default, multi-install-safe status
`OK`, only bundled `assess`, no hooks, and parseable executable shell helpers.
The fixture can remain under the system temporary directory; it is not a
project artifact.
