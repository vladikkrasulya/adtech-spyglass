# Quickstart: Verify Project Tail Reconciliation

Run from the repository root on the authorized host.

## 1. Repository scope

```bash
git status --short --branch
git diff --check
npm run ci
bash scripts/npm-pack-smoke.sh
bash scripts/ci-docker-smoke.sh
```

Expected: only the bounded sweep, gate fix, and 017 evidence files are changed before commit; every
command exits zero. Existing documented lint warnings are reported separately and must not increase.

## 2. Documentation contradictions

```bash
! grep -RIn "falls back to Ukrainian\|fallback-иться на українську" \
  docs/USER_GUIDE.md packages/core/README.md packages/cli/README.md
! grep -n "(partial)" specs/016-ext-key-alphabet/tasks.md
! grep -n "Англійська-only\|ADR-014, 015" docs/USER_GUIDE.md
npx prettier --check \
  docs/OPERATIONS.md docs/USER_GUIDE.md packages/cli/README.md packages/core/README.md \
  scripts/assemble-adjudication.js specs/009-inspector-defect-repair/tasks.md \
  specs/010-button-confirmation-fit/tasks.md specs/016-ext-key-alphabet/spec.md \
  specs/016-ext-key-alphabet/tasks.md specs/017-project-tail-reconciliation \
  specs/ROADMAP.md tests/cleanup-rollback-tags.test.js tests/immutable-image.test.js walkthrough.md
```

Expected: no search finds a stale claim or marker, and every touched repository file is formatted.

## 3. Release readback

```bash
set -euo pipefail

remote_tags="$(git ls-remote --tags origin)"
releases="$(
  gh api --paginate --method GET \
    'repos/vladikkrasulya/adtech-spyglass/releases?per_page=100' | jq -s 'add'
)"

while read -r tag expected; do
  expected_full="$(git rev-parse "${expected}^{commit}")"
  tag_object="$(git rev-parse "$tag")"
  test "$(git cat-file -t "$tag")" = tag
  test "$(git rev-parse "${tag}^{}")" = "$expected_full"
  test "$(awk -v ref="refs/tags/$tag" '$2 == ref { print $1 }' <<<"$remote_tags")" = "$tag_object"
  test "$(awk -v ref="refs/tags/${tag}^{}" '$2 == ref { print $1 }' <<<"$remote_tags")" = "$expected_full"

  release="$(jq -c --arg tag "$tag" '.[] | select(.tag_name == $tag)' <<<"$releases")"
  jq -e --arg tag "$tag" --arg target "$expected_full" '
    .tag_name == $tag and .target_commitish == $target and
    .draft == false and .prerelease == false
  ' <<<"$release" >/dev/null
  section="$(awk -v prefix="### $tag " '
    index($0, prefix) == 1 { active=1 }
    active && printed && /^### / { exit }
    active { print; printed=1 }
  ' CHANGELOG.md)"
  body="$(jq -r '.body' <<<"$release")"
  test -n "$section"
  test "${body#"$section"}" != "$body"
done <<'EOF'
v1.6.1 d6c873d
v1.7.0 77f774e
v1.8.0 d6f9c57
v1.9.0 ead30e0
v1.10.0 79a5ad0
v1.10.1 5767b6c
v1.11.0 0ea8f46
v1.11.1 52e058b
v1.11.2 278f7b4
v1.11.3 4c150d1
v1.12.0 faa2a63
v1.12.1 0e6a647
v1.13.0 774fb8c
v1.13.1 26aa95e
v1.14.0 50c5799
v1.14.1 cb5e6ff
v1.14.2 84cc6ea
v1.14.3 9d1b883
v1.14.4 bfe754a
v1.14.5 1c60c75
v1.14.6 9fdabf2
v1.15.0 1b41d5b
v1.16.0 17945d6
v1.17.0 d854ae2
v1.18.0 adde7f5
v1.19.0 b729505
v1.19.1 85e41c4
EOF

test "$(gh api repos/vladikkrasulya/adtech-spyglass/releases/latest --jq .tag_name)" = v1.19.1
```

Expected: every version in the [reconciliation contract](./contracts/reconciliation.md) is an
annotated local and remote tag that peels to its exact revision; each release targets that full
revision, is public, non-draft, non-prerelease, and begins with its exact matching CHANGELOG
section; `v1.19.1` is latest.

## 4. Host cleanup readback

```bash
set -euo pipefail

bash -n scripts/cleanup-rollback-tags.sh
bash -n /home/vk/.local/bin/cleanup-server.sh
grep -Fqx \
  'ORTBTOOLS_ROLLBACK_CLEANUP="/srv/DATA/Stacks/ortbtools/scripts/cleanup-rollback-tags.sh"' \
  /home/vk/.local/bin/cleanup-server.sh
node --test tests/cleanup-rollback-tags.test.js

actual_refs="$({
  docker image ls --filter 'reference=ortbtools:rollback-pre-*' \
    --format '{{.Repository}}:{{.Tag}}' | while read -r ref; do
      created="$(docker image inspect --format '{{.Created}}' "$ref")"
      revision="$(docker image inspect \
        --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$ref")"
      test "${ref##*-}" = "${revision:0:7}"
      printf '%s\t%s\n' "$created" "$ref"
    done
} | LC_ALL=C sort -t $'\t' -k1,1r -k2,2r)"

expected_refs=$'2026-09-02T11:22:09.035789798+02:00\tortbtools:rollback-pre-89d9ec9\n2026-09-02T10:22:09.293726541+02:00\tortbtools:rollback-pre-b729505\n2026-08-27T13:49:40.56193287+02:00\tortbtools:rollback-pre-adde7f5\n2026-08-27T09:12:08.806223939+02:00\tortbtools:rollback-pre-d854ae2\n2026-08-26T21:00:31.268593606+02:00\tortbtools:rollback-pre-17945d6\n2026-08-25T19:10:02.510821762+02:00\tortbtools:rollback-pre-1bccb56\n2026-08-25T16:14:31.130627333+02:00\tortbtools:rollback-pre-1b41d5b\n2026-08-22T08:59:56.070901577+02:00\tortbtools:rollback-pre-9fdabf2\n2026-08-20T19:04:55.923362298+02:00\tortbtools:rollback-pre-bfe754a\n2026-08-20T19:04:55.923362298+02:00\tortbtools:rollback-pre-b412778'
test "$actual_refs" = "$expected_refs"

archive=/srv/DATA/Backups/archive/ortbtools-wip-backups-2026-06-28
test "$(stat -c '%d:%i' "$archive")" = '66306:6029631'
test "$(find "$archive" -type f | wc -l)" = 16
test "$(find "$archive" -type d | wc -l)" = 5
test "$(du -sb "$archive" | awk '{print $1}')" = 6533879
manifest="$(
  cd "$archive"
  find . -type f -print0 | LC_ALL=C sort -z | xargs -0r sha256sum | sha256sum | awk '{print $1}'
)"
test "$manifest" = bcff9e6f7da070b9a11cf4777dde4aba943bfbbed4f8c82ecd0e54d9c1651487
test ! -e /srv/DATA/Backups/ortbtools/wip-backups-2026-06-28
```

Expected: shell syntax and the installed repository-helper handoff are valid; isolated regression
tests prove chronological ordering and safe unreadable/list/removal failure behavior; the retained
tags are the exact newest ten timestamped candidates and each tag suffix matches its OCI revision;
the archive reproduces its pre-move inode, full entry counts, byte count, and content manifest; the
former cron-tree path is absent.

## 5. Dependency proposal

```bash
set -euo pipefail

pull="$(gh api repos/vladikkrasulya/adtech-spyglass/pulls/4)"
checks="$(gh pr view 4 --json state,headRefOid,mergeStateStatus,statusCheckRollup)"
base_sha="$(jq -r '.base.sha' <<<"$pull")"
head_sha="$(jq -r '.headRefOid' <<<"$checks")"
test "$head_sha" = "$(jq -r '.head.sha' <<<"$pull")"
git fetch --no-tags origin "$base_sha" "$head_sha"
git merge-base --is-ancestor "$base_sha" "$head_sha"

if [ "$(jq -r '.state' <<<"$checks")" = MERGED ]; then
  jq -e 'all(.statusCheckRollup[];
    .status == "COMPLETED" and .conclusion == "SUCCESS")' <<<"$checks" >/dev/null
else
  jq -e 'any(.statusCheckRollup[];
    .status != "COMPLETED" or .conclusion != "SUCCESS")' <<<"$checks" >/dev/null
  jq -r '.statusCheckRollup[] |
    select(.status != "COMPLETED" or .conclusion != "SUCCESS") |
    [.name, .status, .conclusion, .detailsUrl] | @tsv' <<<"$checks"
fi
```

Expected: the proposal either merged after all required checks passed or remains open with the exact
non-green gate visible; its head contains the base revision recorded by GitHub for that evaluation.
