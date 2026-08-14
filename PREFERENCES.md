# Working Preferences

Standing preferences for how work on this project should be done. Consult this
before starting new work; add to it whenever a preference is stated.

## Code quality

- **Optimize for efficiency and robustness.** Don't trade correctness or
  resilience away to save time or effort. Handle edge cases properly rather
  than noting them and moving on.
- **Reuse functions across issues.** If a piece of logic is needed in more than
  one place, factor it into a shared function instead of writing a second
  variant of it.
- **Check existing code first.** Before writing something new, look for
  existing code that already solves the problem or can be extended. Prefer
  extending what's there over adding a parallel implementation.

## Git workflow

- Never commit directly to `main` — it's treated as protected. Reach it by
  merging from `dev`, and only when explicitly asked.
- **Work on `dev` by default.** Don't create a feature branch for new work
  unless asked; commit straight to `dev` and leave merging to `main` for an
  explicit request.
- **Audit for duplicated functionality before merging into `main`.** A merge is
  the point where parallel work converges, so recheck whether anything being
  merged duplicates logic that already exists. If it does, don't resolve it
  unilaterally — surface it and ask how to integrate the two. This is the
  "check existing code first" rule above applied deliberately at the merge
  boundary, where near-duplicates are easiest to miss and most expensive to
  leave in.

## Debugging

_(No preferences recorded yet.)_
