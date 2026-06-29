# How the X Algorithm Works (for a launch)

Load at Steps 2 & 4. X's ranking is in transition (2026), so this separates **code-based facts** from
**third-party estimates** — don't present an estimate as official.

## What's published (and what isn't)

- The **2023 open-sourced "heavy ranker"** (`github.com/twitter/the-algorithm-ml`) has explicit hand-tuned
  engagement weights — still the **canonical public reference**.
- **Jan 2026:** xAI replaced it with **Phoenix**, a Grok-architecture transformer
  (`github.com/xai-org/x-algorithm`), re-published every ~4 weeks, predicting ~19 engagement actions with a
  two-tower retrieval + transformer ranker. **Phoenix uses *learned* weights — the exact 2026 numbers are
  NOT published.** So treat any specific 2026 multiplier ("velocity = 1000×", "dwell = +10") as a
  third-party estimate; the 2023 weights remain the best directional proxy.

## The 2023 weights (code-verified — the durable signal ordering)

| Action | Weight | Read |
|--------|--------|------|
| **Reply the author replies back to** | **75.0** | the single highest positive signal |
| Reply | 13.5 | ≈ **27× a like** |
| Profile click | 12.0 | — |
| Link click | 11.0 / 10.0 | — |
| Repost | 1.0 | ≈ 2× a like |
| Like | 0.5 | the baseline |
| "Show less" / mute / block | **−74.0** | cancels ~148 likes |
| Report | **−369.0** | cancels ~738 likes — near-fatal |

**The launch implications are durable even under Phoenix:** ask for **replies, not just likes**; the
**author working the thread in the golden hour** (so replies become "author-replied" at 75.0) is the top
amplifier; and a small rate of **mute/block/report** can net-negative an otherwise strong post — so avoid
spammy, baity, over-@mentioned copy.

## The external-link penalty (the most important launch fact)

X **suppresses the reach of posts with an external link in the body.** Musk's own endorsed fix: *"Just
write a description in the main post and put the link in the reply."* So the **launch URL goes in a reply,
never in the hook tweet.**

- Magnitude is a moving, third-party estimate (cited from ~30–50% up to ~80–94%). Buffer's 18.8M-post
  study: **non-Premium link posts ≈ 0% median engagement since March 2025**; Premium link posts ≈ 0.25–0.3%.
- X has been *softening* this (late-2025 "link experience" test), but every current source still recommends
  the **link-in-first-reply** workaround — use it.

## X Premium ≈ a reach multiplier (near table-stakes in 2026)

Buffer's study (18.8M posts, 71k accounts, Aug 2024–Aug 2025; third-party, not official X data) found
**Premium ≈ 10× the median reach** of regular accounts: regular < 100 median impressions (about **half at
zero**), Premium ≈ 600, Premium+ ≈ 1,550+. Regular accounts hit **~0% median engagement by March 2025.**
Practical guidance: for a launch, **being on Premium / Premium+ is close to required for any reach** —
flag it as one of the cheapest, highest-leverage levers.

## The golden hour & distribution

- The For You feed weights **early engagement velocity** heavily: a burst of replies/reposts in the first
  **~15–60 minutes** triggers broader **out-of-network** distribution; the same engagement spread over a
  day does not. (The exact window/decay/multiplier are third-party estimates; the qualitative effect is
  well-supported.)
- ~50% of the For You feed is **out-of-network** (interest/community clusters), so a launch can reach
  beyond your followers — but only if early velocity is strong.
- **Long-form** (Premium, up to ~25k chars) is treated as one unit with aggregated dwell; a single
  long-form post *may* out-distribute an equivalent multi-tweet thread (low-confidence third-party) — but a
  **thread** is the standard, safe launch format and keeps each tweet a reply-magnet.

## Realistic expectations

Reach depends heavily on account tier and existing audience. The durable wins are **replies/conversation,
profile clicks, link clicks to the product, and new followers** — not the like count. Set an honest target
for the account's size; never promise virality.
