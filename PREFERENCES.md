# Working Preferences

Standing preferences for how work on this project should be done. Consult this
before starting new work; add to it whenever a preference is stated.

## Code quality

- **Optimize for efficiency and robustness.** Don't trade correctness or
  resilience away to save time or effort. Handle edge cases properly rather
  than noting them and moving on.
- **Don't evaluate code in terms of how much work it would be.** Judge an
  approach only on whether it's correct and whether it's useful. Effort isn't a
  tiebreaker, and it doesn't belong in how options are described either — an
  option labelled "most work" is being argued against on a basis that doesn't
  matter here. If one approach is genuinely worse, say why it's worse on the
  merits; if it's better but larger, that's simply the better approach.
- **Reuse functions across issues.** If a piece of logic is needed in more than
  one place, factor it into a shared function instead of writing a second
  variant of it.
- **Check existing code first.** Before writing something new, look for
  existing code that already solves the problem or can be extended. Prefer
  extending what's there over adding a parallel implementation.

## Communication

- **Write only what changes a decision.** Before writing something up, ask
  whether knowing it would actually affect a choice — what to build, what to
  fix, what to accept or reject. If it would, say it. If it wouldn't, just do
  the work. Rejected alternatives, intermediate steps, and the reasoning that
  led somewhere are all part of doing the job, not part of reporting it.
  Constraints that will bite later, decisions made on the reader's behalf, and
  results that came out other than expected do change decisions, so those still
  get said.

## Git workflow

These rules are about *kinds* of branch, not particular names. `main` is the
protected branch and `dev` the working branch today; if either role moves to a
different branch, or new branches are added, the rules follow the role rather
than staying with the name.

- **Never commit directly to a protected branch** — `main` is one. Reach it
  only by merging from another branch, and only when explicitly asked.
- **Work on the current working branch by default** — `dev` unless told
  otherwise. Don't create a feature branch for new work unless asked. When work
  is directed to some other branch, that branch becomes the working branch for
  the duration, and every rule here applies to it unchanged.
- **Don't keep code local — always push the branch you just committed to.**
  Whatever the branch and whoever created it, push it to its remote counterpart
  after committing; after a merge, push the branch that was merged into as
  well. Work that exists only on this machine isn't backed up, isn't visible on
  the repo, and accumulates silently until a push becomes a big one. Push
  without being asked — the branch rules above still decide *what* lands where,
  and this only says that wherever it lands, it doesn't stay local.
- **Audit for duplicated functionality before merging into any long-lived
  branch**, protected or not. A merge is the point where parallel work
  converges, so recheck whether anything being merged duplicates logic that
  already exists. If it does, don't resolve it unilaterally — surface it and ask
  how to integrate the two. This is the "check existing code first" rule above
  applied deliberately at the merge boundary, where near-duplicates are easiest
  to miss and most expensive to leave in.

## Debugging

_(No preferences recorded yet.)_
