# npm publish — @ortbtools/core + @ortbtools/cli

First-time setup and release procedure for the public npm packages that power
[ortbtools.com](https://ortbtools.com).

## Packages

| Package           | Version source               | Install                         |
| ----------------- | ---------------------------- | ------------------------------- |
| `@ortbtools/core` | `packages/core/package.json` | `npm install @ortbtools/core`   |
| `@ortbtools/cli`  | `packages/cli/package.json`  | `npm install -g @ortbtools/cli` |

**Publish order:** core first, then CLI (CLI depends on core).

## Prerequisites (one-time)

1. **npm organizations** — create or claim scopes on [npmjs.com](https://www.npmjs.com):
   - `@kyivtech` (core package)
   - `@ortbtools` (CLI package)

2. **Automation token** — npm → Access Tokens → **Granular Access Token**:
   - Permissions: Read and Write for both packages (or the whole orgs)
   - Bypass 2FA if your account requires it for CI publishes

3. **GitHub secret** — repo `ortbtools` → Settings → Secrets → Actions:
   - Name: `NPM_TOKEN`
   - Value: the granular token

## CI gates (before every publish)

- `npm run ci` — full test suite
- `bash scripts/npm-pack-smoke.sh` — pack both tarballs, clean install, run `ortbtools validate`

The main CI workflow runs pack smoke on every PR. The publish workflow runs it again
before upload.

## Publish via GitHub Actions (recommended)

1. Merge changes to `main` with bumped versions in `packages/*/package.json`.
2. Actions → **Publish npm packages** → Run workflow.
3. Leave **Publish core** on; enable **Publish CLI** only after core succeeded once.
4. First run: try **dry_run=true** to verify token scope without uploading.

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
