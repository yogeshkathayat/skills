# LinkedIn Launch Copy (the LinkedIn asset profile)

This is the **LinkedIn asset profile** the orchestrator hands to the `launch-copy` skill — assets, voice,
and the post skeleton — **and the inline fallback** if `launch-copy` isn't installed. Load at Step 3. Bind
every line to `.ulpi/launch/positioning.md`; honor the limits in `li-format-rules.md`.

**Profile to pass to `launch-copy`:** `channel` = linkedin; `voice` = professional but human, story-led,
specific, no hype/no "thrilled to announce"; `compliance` = no rich link-preview card in the body (link in
the first comment), ~3 niche hashtags, no engagement-bait ("comment YES"); `assets` = hook (≤~140 chars for
mobile, 3–4 options), post body (the problem-first arc below), the first-comment link line. The skeleton
below is the fallback.

## The hook (≤ ~140 chars — the mobile see-more budget; 3–4 options)

**Problem-first — name the product later.** Personal-story hooks reportedly drive ~4× engagement. The hook
must stop the scroll and earn the "…see more" click on its own. Patterns (a hook-line bank):

- **Problem-confession:** "For [N years] we [did the painful manual thing]. It cost us [specific cost]. So
  we built the fix."
- **Sharp number:** "[Surprising stat] of [audience] still [do the painful thing] by hand. We thought that
  was insane — so we changed it."
- **Contrarian:** "Everyone says you need [common belief]. We launched [Product] proving the opposite."
- **Personal story:** "18 months ago I almost killed this project. Today we're launching it."
- **Before/after:** "This used to take our team [X hours]. Now it takes [Y seconds]. Here's what we shipped."
- **Milestone:** "We just hit [milestone]. Here's the thing we built to get there — and you can use it today."

## Paste-ready launch-post skeleton (problem-first)

```
[HOOK — line 1, ≤ ~140 chars so it survives the mobile fold. A felt problem, a sharp number, or a
personal-story opener. NO product name yet.]
[Line 2 — optional second hook line that adds intrigue and earns the "…see more" click.]

— — — (everything below is past the fold) — — —

[STORY / PROBLEM — 2–4 short lines, one idea per line. The pain the reader already feels. First person
and specific: "For 3 years we…" not "Teams often struggle…".]

[TURN — 1–2 lines: the moment you decided to build it / the insight.]

[WHAT WE BUILT — 3–4 short lines. NOW name the product. One plain sentence on what it is, then 2–3
concrete things it does. Plain words, short lines.]
So today we're launching [Product] — [one-line positioning: who it's for + the outcome].

[PROOF — 1–3 lines. ONE specific, credible thing: a beta metric, an early-customer result, a notable
backer/partner, or a short testimonial. Numbers > adjectives.]

[CTA — 1–2 lines, ONE soft ask that drives a comment or a free action:
• "Try the beta — link in the first comment."
• "What would you want it to do next? Tell me below."
(Avoid "comment YES" — that's engagement-bait and is demoted.)]

[Tag 1–3 genuinely relevant people + your company Page.]
#NicheTag1 #NicheTag2 #BroaderTag
```

```
FIRST COMMENT (post immediately after publishing):
Here's the link 👉 [PRODUCT_URL]   ← UTM-tagged. Happy to answer anything in the thread.
```

## What good looks like (real examples)

- **Icon (Kennan Davison)** — launched from his **personal** profile, problem-first, product name held to
  the end, one stacked proof point; the CTA drove a massive comment thread (which fuels dwell + reach).
- **Simon Sinek "Leaderful"** — hook is the reader's felt problem; the product is named only in the final
  sentence.
- **Milestone hook** (e.g. Hormozi) — credit the audience first, then reframe as progress toward the
  mission — a launch can ride a milestone, not just a feature list.

## Voice & slop bans

Professional but human; story-led; specific. Ban "We're thrilled/excited to announce…", "revolutionary",
"game-changing", "synergy", buzzword soup, and fake precision. The post must **earn dwell** — give the
reader a reason to stop and read, not an announcement. (See `launch-copy`'s `copy-craft.md` for the
general craft.)
