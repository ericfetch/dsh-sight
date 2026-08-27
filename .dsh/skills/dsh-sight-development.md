---
name: dsh-sight-development
description: Development and release convention for the dsh-sight plugin. Follow branch-based work, only tag/version/publish on an intentional release, and keep the in-flight version untouched during normal edits.
whenToUse: When making code changes to the dsh-sight plugin repository, or deciding whether to create a branch, bump a version, tag, or publish to npm.
---

# dsh-sight Development & Release Convention

This convention governs how this repository is evolved and released. It exists to
stop "every change bumps a version" churn and to make releases deliberate.

## Hard rules

1. **Do not bump the version / tag / publish on every change.**
   Editing code or docs is *not* a release. A version bump, git tag, and npm
   publish happen **only** when a release is explicitly decided.

2. **Work on branches, merge when ready.**
   Branches: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`. Keep the working copy
   on a branch for non-trivial changes; commit early, commit often.

3. **One release = one version atom.**
   When a release is decided, in order: bump version in `package.json` →
   commit with a release message → push branch → merge to `main` → push tags →
   `npm publish`. Do not interleave unrelated edits into the release commit.

4. **`main` stays releasable.** It is the trunk, not a scratch space.

## Daily flow (no release)

```sh
git checkout -b feat/figma-oauth
# ... edit, typecheck, build ...
git add -A && git commit -m "feat: ..."
```

- Verification before a PR: `pnpm typecheck && pnpm build`.
- No version change, no tag, no publish.

## Release flow (only when decided)

```sh
# on branch, all change committed
pnpm typecheck && pnpm build
npm version <patch|minor|major>     # bumps package.json + creates a git tag
git push origin <branch>
git checkout main && git merge <branch>
git push origin main --tags
npm publish --access public
```

- Choose the bump by intent: bugfix → patch, feature → minor, breaking → major.
- The release commit carries only the release intent. Anything else lands in its
  own commit before or after.

## Checklist before deciding a release

- [ ] Feature/change is verified by the user or a test (not just "it compiles").
- [ ] README reflects the new behavior, if user-facing.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm build` produces `lib/index.js` + `lib/client.js`.
- [ ] The desktop profile increment is intentional (not every publish).