# Working Preferences

Standing preferences for how work on this project should be done. Consult this before starting new
work; add to it whenever a preference is stated.

## Code quality

- **Optimize for efficiency and robustness.** Don't trade correctness or resilience away to save
  time. Handle edge cases properly rather than noting them and moving on.
- **Don't evaluate code by how much work it would be.** Judge an approach on whether it's correct
  and whether it's useful. Effort isn't a tiebreaker and doesn't belong in how options are
  described. If one approach is worse, say why on the merits.
- **Reuse functions across issues.** Logic needed in more than one place becomes a shared function,
  not a second variant.
- **Check existing code first.** Look for something that already solves the problem or can be
  extended before writing a parallel implementation.

## Communication

- **Write only what changes a decision.** If knowing something wouldn't affect a choice, skip it
  and just do the work. Rejected alternatives, intermediate steps and reasoning are part of doing
  the job, not part of reporting it.
- **Still report** constraints that will bite later, decisions made on my behalf that I might want
  to overrule, and results that came out other than expected.

## Writing style

Applies to READMEs, docs, code comments, commit messages, issue and PR text.

### Punctuation and formatting

- No em dashes. A period, comma, colon or pair of parentheses does the same job.
- No italics for emphasis. Italics are for terms being defined.
- Don't bold the opening words of consecutive paragraphs. Use real headings, or nothing.
- Don't put a colon in every heading.

### Sentence shapes to avoid

- "It isn't X, it's Y", along with "not just X but Y" and "less about X than about Y". State the
  claim and drop the foil.
- The rule of three. Three parallel items, clauses or examples, over and over.
- Balanced closing clauses. Some paragraphs should end flatly on a fact.
- Aphorisms. Anything that sounds quotable is usually doing less work than the plain version.
- Rhetorical questions, unless answering one a reader would really ask.

### Words and phrases

Avoid: delve, leverage (as a verb), robust, seamless, landscape, realm, tapestry, testament,
crucial, pivotal, underscore, foster, garner, myriad, plethora, unlock, elevate, empower, harness,
navigate (figuratively), ecosystem (unless it's literally a package ecosystem).

Cut on sight: "It's worth noting that", "It's important to remember", "At its core", "In essence",
"Ultimately", "That said", "Needless to say", "In today's world".

Prefer the ordinary word. Use, not utilize. Strong, not robust.

### Structure

- Don't open with throat-clearing context. Start with what the thing is.
- Don't close with a summary that restates the document.
- Vary sentence length. Short ones are allowed.
- Don't give every section the same shape.

### What to do instead

- Be concrete. "Recomputed every 30 minutes" beats "recomputed periodically".
- Prefer the blunt version.
- Say what something doesn't do, what broke, and what got reverted and why.
- Contractions are fine, so is addressing the reader as "you", and so is "I" in the README.

### Comments and commit messages

Comments explain why, not what. A comment restating the line under it is noise. Record the
constraint that forced the code into an odd shape.

Commit messages: subject line in the imperative, then the reasoning if the change isn't obvious.

## Git workflow

These rules are about kinds of branch, not particular names. `main` is the protected branch and
`dev` the working branch today. If either role moves, the rules follow the role.

- **Never commit directly to a protected branch.** Reach it only by merging from another branch,
  and only when explicitly asked.
- **Work on the current working branch by default.** Don't create a feature branch unless asked.
  When work is directed to some other branch, that branch becomes the working branch for the
  duration and every rule here applies to it unchanged.
- **Always push the branch you just committed to**, without being asked. After a merge, push the
  branch that was merged into as well.
- **Audit for duplicated functionality before merging into any long-lived branch**, protected or
  not. If something being merged duplicates existing logic, surface it and ask how to integrate the
  two rather than resolving it unilaterally.

## Debugging

_(No preferences recorded yet.)_
