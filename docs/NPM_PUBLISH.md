# npm publish — @ortbtools/core + @ortbtools/cli

First-time setup and release procedure for the planned public npm packages that
wrap the engine used by [ortbtools.com](https://ortbtools.com).

**Current registry status:** neither package has been published. Both names are
available only as workspaces in this repository until the first release is
completed and verified.

## Packages

| Package           | Version source               | Registry status |
| ----------------- | ---------------------------- | --------------- |
| `@ortbtools/core` | `packages/core/package.json` | Unpublished     |
| `@ortbtools/cli`  | `packages/cli/package.json`  | Unpublished     |

**Publish order:** core first, then CLI (CLI depends on core).

## Prerequisites (one-time)

1. **npm scope** — create or claim `@ortbtools` on
   [npmjs.com](https://www.npmjs.com) and ensure the publishing account can
   create both `@ortbtools/core` and `@ortbtools/cli`.

2. **Automation token** — npm → Access Tokens → **Granular Access Token**:
   - Permissions: Read and Write for both packages (or the `@ortbtools` scope)
   - Bypass 2FA if your account requires it for CI publishes

3. **GitHub secret** — repo `vladikkrasulya/adtech-spyglass` → Settings →
   Secrets → Actions:
   - Name: `NPM_TOKEN`
   - Value: the granular token

## CI gates (before every publish)

- `npm run ci` — full test suite
- `bash scripts/npm-pack-smoke.sh` — pack both tarballs, clean install, run `ortbtools validate`

The main CI workflow runs pack smoke on every PR. The publish workflow reruns both
`npm run ci` and pack smoke before upload.

## Publish via GitHub Actions (recommended)

1. Merge changes to `main` with bumped versions in `packages/*/package.json`.
2. Actions → **Publish npm packages** → Run workflow.
3. For the first real release, run with **Publish core** on and **Publish CLI** off.
4. Verify the Core version on npm, then run again with **Publish core** off and
   **Publish CLI** on. Re-publishing the same Core version would fail before the CLI step.
5. The workflow defaults to **dry_run=true**. Leave it enabled on the first run
   to inspect the publish commands and packed contents without uploading. A dry
   run does not prove registry permissions; verify token access separately in
   npm before the real publish.

The workflow rejects a non-dry-run dispatch from any ref other than `main`.

## Publish manually (fallback)

```bash
cd packages/core
npm publish --access public

cd ../cli
npm publish --access public
```

Requires `npm login` on the maintainer machine with publish rights to both scopes.

## Version bumps

- **Core:** bump `packages/core/package.json` when validator rules/messages change.
- **CLI:** bump `packages/cli/package.json` when CLI flags/output change; update
  `dependencies.@ortbtools/core` range to match.
- App (`package.json` at repo root) version is independent — ortbtools.com deploy
  does not auto-publish npm packages.

## Verify after publish

Run these commands only after the registry pages show the expected versions.

```bash
npm install -g @ortbtools/cli
ortbtools --help
ortbtools validate path/to/bidrequest.json
```

From a clean directory (no monorepo checkout):

```bash
mkdir /tmp/ortbtools-smoke && cd /tmp/ortbtools-smoke
npm init -y
npm install @ortbtools/core
node -e "const c=require('@ortbtools/core'); console.log(typeof c.validate)"
```
