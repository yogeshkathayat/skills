# How the LinkedIn Algorithm Works (for a launch)

Load at Steps 2 & 4. Separates **officially-confirmed signals** from **third-party estimates** — LinkedIn
publishes the architecture but not the weights, so most numbers are analyst estimates (largely van der
Blom's Algorithm Report + AuthoredUp studies). Treat them as directional.

## The ranking engine (2026)

LinkedIn's feed ranking is now **LLM / embedding-based** — it scores content by **semantic relevance and
demonstrated expertise**, not keyword/engagement matching (LinkedIn Engineering, *"Engineering the next
generation of LinkedIn's Feed,"* 2026). This is the technical basis for the 2024+ **"knowledge & expertise
/ niche relevance"** shift: a smaller account with **real authority in one niche** can now reach beyond its
network.

## The distribution funnel (shape confirmed; sample % is third-party)

1. **Quality filter** — every post is classified spam / low-quality / clear in seconds. Excessive
   hashtags, promotional language, and bare external links push toward suppression.
2. **The golden-hour test** — the post is shown to a small sample (~2–5% of your network, est.), and
   **engagement in the first ~30–90 minutes** decides whether it advances. *(van der Blom: 30–60 min;
   other guides: 60–90 min.)*
3. **Extended distribution** — posts that perform expand from connections/followers outward to **2nd/3rd-
   degree and interest-graph matches** (the 2026 LLM ranking leans on semantic/interest relevance, which
   can override strict connection-degree).

## The dominant signals

- **Dwell time** — *officially confirmed* by LinkedIn (its own dwell-time engineering blog + the LiRank
  paper); dwell starts counting when ≥50% of the post is visible. The point: **write for read-time** — a
  reason to stop and read. (Third-party correlation: ~1.2% engagement at 0–3s dwell vs ~15.6% at 61s+.)
- **Comments ≫ reactions.** The exact multiplier is unsettled (analyst estimates span ~2× to ~15× a like).
  **Longer, substantive comments** help; **generic "Great post!"** comments carry near-zero weight
  (devalued, not actively penalized). **Threaded replies** (the author replying back) expand reach further
  (AuthoredUp's ~622k-post study: indirect comments up to ~2.4× reach). **Saves** are a strong trust
  signal. → The core launch tactic: **ask one real question and reply to every comment in the first hour.**

## The external-link penalty (real, but smaller in 2026 — and contested)

An external link **in the post body** suppresses reach, but the magnitude has **shrunk**: van der Blom 2025
reported ~40–50%; his **2026 report (~1.3M posts) found only ~18.8% median reach reduction** for one
in-body link, and some 2026 analyses even find resource-rich / multi-link posts doing fine (AuthoredUp:
1 link performs worst, 4+ links can *out*perform — "one link looks like promotion; multiple signal value").

**The safe default still holds: keep the body a genuine value post and put the launch link in the FIRST
COMMENT** — it carries a much smaller penalty (~-5 to -10%, est.). But **don't obsess** over link placement:
a strong, native, dwell-worthy post matters more. (The claim that the LLM "detects bridge behaviour" to a
comment link is unverified.)

## Formats that win (drive dwell)

- **Document/PDF carousel** — the highest-engagement format (~6.6%, best at 8–10 slides, ~15–20s dwell).
- **Native video** — uploaded to LinkedIn (never a YouTube link); LinkedIn-cited video ~5× engagement,
  Live ~24×.
- **Text + a single image** — fine; lead with the hook.
- Reach multipliers (est., personal profiles): polls ~1.6×, documents ~1.45×, video ~1.1× vs plain text.

## Behaviour signals

- **Don't edit after momentum.** Typo fixes in the first ~10 min are harmless; major edits or adding a link
  after ~30 min can cut impressions ~30–50% by re-triggering quality assessment. *(Third-party/observational
  — LinkedIn has never confirmed an edit penalty — but proof before posting to be safe.)*
- **Engagement pods are detected and devalued** — LinkedIn's VP of Product confirmed a crackdown on
  automation tools/extensions. Drive **real** comments from relevant people, never a pod.
- **Engagement-bait** ("Comment YES if…"), recycled thought-leadership, and generic AI-template content are
  **downranked** under the LLM update.
- LinkedIn now **surfaces older relevant posts** (2–3 weeks old) — pure recency matters less than relevance.

## Realistic expectations

Average organic reach **declined materially across 2025** (van der Blom: ~50% fewer post views), so the bar
is higher. The durable wins are **substantive comments/conversation, profile visits, link clicks, and
qualified followers** — not the reaction count. Set an honest target for the account's network size.
