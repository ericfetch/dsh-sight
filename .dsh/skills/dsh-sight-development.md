---
name: dsh-sight-development
description: Development and release convention for the dsh-sight plugin. All work happens on a feat_<version> branch; a release merges that branch to main and tags it. Never publish or bump the version during ordinary development.
whenToUse: When making code or doc changes to the dsh-sight plugin repository, or deciding whether to create a branch, bump a version, tag, or publish to npm.
---

# dsh-sight Development & Release Convention

This convention governs how this repository is evolved and released. It exists so
that every change is developed out on a feature branch and only merged + tagged
when a release is intentionally decided.

## Branch naming

- Development branches are named `feat_<next-version>`, e.g. `feat_0.1.13`.
- The version in the branch name is the *intended next release* for that branch's
  work. It is fixed when the branch is created.

## Hard rules

1. **All development happens on a `feat_<version>` branch.** Never work directly
   on `main`; `main` is the release trunk.

2. **Never publish or bump the version during ordinary development.**
   Editing code or docs is *not* a release. Version bump, tag, and `npm publish`
   happen only when a release is explicitly decided.

3. **One branch = one release.** Keep the work scoped to what the branch's
   version will deliver. Unrelated changes belong on their own feat branch with
   their own intended version.

4. **Release flow is: merge to `main`, then tag.** There is no per-commit
   tagging; the tag names the release cut from `main`.

## Daily flow (development, no release)

```sh
git checkout -b feat_0.1.13
# ... edit, typecheck, build ...
git add -A && git commit -m "feat: ..."
```

- Verification before merge: `pnpm typecheck && pnpm build`.
- No version bump, no tag, no publish while on the branch.

## Release flow (only when decided)

```sh
# on the feat branch, all change committed and verified
pnpm typecheck && pnpm build
git checkout main
git merge feat_0.1.13                # merge the feature branch into trunk
git tag v0.1.13                      # tag the release cut from main
git push origin main --tags          # push trunk + the new tag
npm version 0.1.13                   # align package.json with the tagged version
npm publish --access public
```

- Bump intent stays with the version the branch was named for: bugfix → patch,
  feature → minor, breaking → major.
- The release commit/tag carries only the release intent; unrelated edits land
  on their own branch before the merge.

## Checklist before deciding a release

- [ ] Feature/change is verified by the user or a test (not just "it compiles").
- [ ] README reflects the new behavior, if user-facing.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm build` produces `lib/index.js` + `lib/client.js`.
- [ ] The desktop profile increment is intentional (not every publish).