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

- Never commit directly to `main` — it's treated as protected. Work on `dev` or
  a feature branch, and only merge when explicitly asked.

## Debugging

_(No preferences recorded yet.)_
