# Command Reference

Commands this skill relies on to gather data. Run scoped to a single package
directory unless noted otherwise — there is no root `package.json` to run
these against repo-wide.

## Inventory & version drift

```sh
# Direct dependencies of one package, with resolved versions
cd <pkg> && pnpm list --depth 0

# Why is <dep> installed, and by what — surfaces transitive pulls too
cd <pkg> && pnpm why <dep>

# Outdated dependencies vs. their latest published version
cd <pkg> && pnpm outdated

# Known-vulnerability scan (security, not this skill's focus — mention if run)
cd <pkg> && pnpm audit
```

To spot cross-package version drift, run `pnpm list --depth 0` in each
in-scope package and diff the dependency names that appear in more than one.

## Size

```sh
# Total installed size per package
du -sh server/node_modules client/node_modules reviewer-core/node_modules \
       e2e/node_modules evals/node_modules mcp-server/node_modules 2>/dev/null

# Top offenders within one package's node_modules
du -sh <pkg>/node_modules/* | sort -rh | head -20
```

## Usage / unused-dependency check

```sh
# Does anything under src/ actually import <dep>?
grep -rl "from ['\"]<dep>['\"]" <pkg>/src
grep -rl "require(['\"]<dep>['\"])" <pkg>/src

# CLI/build-only tools (tsx, typescript, vitest, etc.) legitimately have no
# src/ import — check package.json "scripts" instead before flagging these.
```

## Cross-package import boundary check

```sh
# Declared path aliases for a package (the sanctioned form of sharing)
grep -A6 '"paths"' <pkg>/tsconfig.json

# Ad hoc relative imports that might reach into another package's internals
grep -rn "from ['\"]\.\./\.\./" <pkg>/src | grep -v node_modules
```

Any hit whose resolved path lands inside a *different* top-level package's
`src/` (rather than staying within `<pkg>/src/` or going through a declared
alias) is the P0 pattern — see `SKILL.md` Step 2.
