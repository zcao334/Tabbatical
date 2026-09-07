# Instructions for agents

How to write prose in this repo: READMEs, docs, code comments, commit messages, issue and PR text.
Rules about branches, code quality and what to report are in [PREFERENCES.md](PREFERENCES.md).

## Don't write like an AI

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

## Comments and commit messages

The same rules apply, with one addition. Comments explain **why**, not what. A comment restating
the line under it is noise. A comment recording the constraint that forced the code into an odd
shape is the reason the file is readable in six months. This repo's comments carry that weight
already, so match them.

Commit messages: subject line in the imperative, then the reasoning if the change isn't obvious.
Say what was rejected and why when it's load-bearing.
