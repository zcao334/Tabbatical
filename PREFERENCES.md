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
## Writing style

Applies to anything written to be read: READMEs, docs, code comments, commit messages, issue and
PR text.

The point isn't to hide that a model wrote it. It's that the house style of most LLM prose is
padded, evenly rhythmic and vague, and those are bad qualities in documentation regardless of who
typed it. Nearly every example below was pulled from an earlier draft of this repo's README.

### Punctuation and formatting

- **No em dashes.** This is the single loudest tell, and the old README averaged more than one per
  paragraph. A period, comma, colon, or pair of parentheses does the same job. If a sentence needs
  an em dash to hold together, it's usually two sentences.
- **No italics for emphasis.** Rhetorical asides in italics (*this tab, five days untouched: keep
  it?*) read as performance. Italics are for terms being defined and nothing else.
- **Don't bold the opening words of every paragraph.** A run of paragraphs each starting with a
  bolded lead-in is a slide deck, not a document. Use real headings, or nothing.
- **Don't put a colon in every heading.** "Snooze: keeping tabs you closed" should just be
  "Snooze".

### Sentence shapes to avoid

- **"It isn't X, it's Y."** Negation followed by correction. The old README used it six times:
  "Tab clutter isn't a storage problem, it's an attention problem", "The defaults are a starting
  point, not an assertion", "The hard part isn't noticing stale tabs, it's earning the right to
  interrupt". Variants to watch for: "not just X but Y", "less about X than about Y", "X is only
  half the story". Say the thing you mean and drop the foil.
- **The rule of three.** Three parallel items, three clauses, three examples, over and over. Real
  lists are two things or five things as often as three.
- **Balanced closing clauses.** Every paragraph landing on a tidy summarizing beat with the same
  cadence. Let some paragraphs end flatly on a fact.
- **Aphorisms.** "A prompt you've learned to dismiss is worse than none." Pronouncements that
  sound quotable are almost always doing less work than the plain version.
- **Rhetorical questions**, unless you actually answer one that a reader would really ask.

### Words and phrases

Avoid: delve, leverage (as a verb), robust, seamless, landscape, realm, tapestry, testament,
crucial, pivotal, underscore, foster, garner, myriad, plethora, unlock, elevate, empower, harness,
navigate (figuratively), ecosystem (unless it's literally a package ecosystem).

Cut on sight: "It's worth noting that", "It's important to remember", "At its core", "In essence",
"Ultimately", "That said", "Needless to say", "In today's world".

Prefer the ordinary word. Use, not utilize. Strong, not robust. Fits together, not seamless.

### Structure

- **Don't open with throat-clearing.** Skip the paragraph explaining that tab clutter is a common
  problem in modern browsing. Start with what the thing is.
- **Don't close with a summary that restates the document.** Stop when you're done.
- **Vary sentence length.** Uniform medium-length sentences are what the style sounds like. Short
  ones are allowed.
- **Don't make every section the same shape.** If each one is a bolded term, two sentences of
  explanation and a caveat, it reads as generated regardless of content.

### Positive rules

- Be concrete and specific. "Recomputed every 30 minutes" beats "recomputed periodically".
- Prefer the blunt version. "Pin it. Don't skip this one." beats "This matters more than it
  sounds."
- Say what something doesn't do, and what broke, and what got reverted and why. Documentation that
  admits limits reads as written by someone who used the thing.
- Contractions are fine. So is addressing the reader as "you".
- It's fine to write "I" in the README. It's a personal project.

### Comments and commit messages

The same rules apply, with one addition. Comments explain **why**, not what. A comment restating
the line under it is noise. A comment recording the constraint that forced the code into an odd
shape is the reason the file is readable in six months. This repo's comments carry that weight
already, so match them.

Commit messages: subject line in the imperative, then the reasoning if the change isn't obvious.
Say what was rejected and why when it's load-bearing.

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
