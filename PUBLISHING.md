# Publishing runbook

**Nothing here has been run.** Packaging is verified by installing from local tarballs; no package has been pushed to any registry, and the names are unclaimed.

Read [docs/03 Thread 12](docs/03-decision-debate-log.md) before running any of it — the decision to hold was deliberate and the reasons have not changed.

## Names reserved for us (verified free as of 2026-09-14, **not** claimed)

| Registry | Name |
| --- | --- |
| npm | `contextkeep` · `@contextkeep/core` · `@contextkeep/hooks` |
| PyPI | `contextkeep-hooks` |

Availability is not a reservation. Anyone can take these at any time.

## Before publishing anything

- [ ] Re-read [05 §9](docs/05-product-plan.md). Both assumptions are still untested: we have **one** lost constraint across **two** real compactions, and **zero** external conversations.
- [ ] Decide whether the public code repo is separate from this one. **`docs/` must not ship publicly** — it contains the competitive analysis and the honest moat assessment.
- [ ] Confirm the version. Everything is at `0.1.0`.

## npm

```bash
npm login
npm run build
npm publish -w @contextkeep/core    --access public
npm publish -w @contextkeep/hooks   --access public
npm publish -w contextkeep          --access public
```

Order matters: `core` first, then the packages depending on it.

**`npm unpublish` only works within 72 hours, and a name is never reusable afterwards.** Treat publish as permanent.

## PyPI

```bash
cd python
python3 -m build
python3 -m twine upload dist/*
```

**PyPI has no unpublish at all.** A released version can be yanked, never removed.

## Verify what ships before you ship it

```bash
npm pack -w contextkeep --dry-run     # should list dist/ and README.md only
```

Confirm no `docs/`, no `.db`, no transcripts, and no `~/.contextkeep` contents are included.
