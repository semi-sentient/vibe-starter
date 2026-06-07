# Communicating With Non-Technical Users

The adaptive principle lives in the root `AGENTS.md`; this is the how-to for when the user reads as non-technical. Detection isn't reliable on its own — models skew to expert-level replies by default — so when someone describes _what_ they want in plain terms but can't answer architecture questions, treat that as the signal and apply the patterns below. They matter most inside the interview skills (`grill-me`, `grill-with-docs`, `write-a-prd`, `prd-to-plan`, `prototype`), which ask hard design questions in an engineer's language — keep their rigor, change their delivery.

This is delivery, not dumbing-down: the _decision_ is still made at full precision. You translate the question and the trade-off; you never skip them.

## Frame decisions as outcomes, not internals

Lead with what the user will see or experience; name the technology only if it helps them choose.

- ❌ "Should we persist this in Postgres or keep it in memory?"
- ✅ "Should your data still be there after you close the app? (Yes = we save it to a database — costs nothing extra.)"

## Pair every question with a recommended default

Never hand a non-technical user an open-ended architecture question — they can't answer "what's your auth strategy?". Offer 2–3 concrete, plain-language options, mark one recommended, and say why.

- ❌ "How do you want users to log in?"
- ✅ "Most apps use **email + password** — simplest, works everywhere (recommended). Or a **magic link** — no password, but they check email each time. Which fits?"

When you genuinely have no preference, still bound the choice rather than asking them to invent one.

## Probe edge cases as everyday scenarios, never jargon

"Concurrency", "race condition", "null", "validation" earn a nod of false understanding. Reframe as a human situation.

- ❌ "How should we handle concurrent edits?" → ✅ "What if two people edit the same thing at the same time?"
- ❌ "What's the empty-state behavior?" → ✅ "What should they see before they've added anything?"

## Get specifics from a real instance, not an abstract rule

Non-experts answer "what's your policy?" with a guess. Anchor in a concrete, named example: "Think of the last time an order failed — what did you do, and what did you wish had happened?" The example flushes out the real requirement; the abstract question hides it.

## Name a term once, then keep it

When a technical term is unavoidable, use it and gloss it in half a sentence the _first_ time — don't strip it (the user needs words they can search later), and don't re-explain it every time after.

- ✅ "I'll add an **ADR** — a short note recording _why_ we chose this, so future-you isn't left guessing."

Never say "just" or "simply" ("just deploy it", "simply add a webhook"); it implies the thing is easy and the user is slow.

## Cautions

- **Don't condescend to engineers.** This file applies _only_ when the user reads as non-technical, and the audience here is mixed. Responding _below_ someone's level frustrates as much as above it — recalibrate every turn, and drop the scaffolding the moment they start using precise terms.
- **Don't over-question trivial asks.** Defaulted choices are for genuine forks (auth, payments, data storage, edge cases). For a typo or an obvious change, just make it.
- **Still surface assumptions** (root `AGENTS.md` non-negotiable #1) — but as a plain-language default they can veto: "I'm assuming anyone can submit the form without an account — tell me if not."
