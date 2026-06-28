# OpenReply methodology

Every design decision in the viewer traces to established research.
This page exists because users told us they distrust AI-generated
insights without transparent methodology (CHRONIC pain #5, 5 posts).

---

## Information visualization principles

### Shneiderman's Visual Information-Seeking Mantra (1996)

> **"Overview first, zoom and filter, details on demand."**

— Ben Shneiderman, *The Eyes Have It: A Task by Data Type Taxonomy for Information Visualizations*, IEEE Visual Languages, 1996.

We implement this exactly:
- **Overview**: Top banner shows total painpoints / products / DIY counts
- **Zoom**: Filter by kind or era (right sidebar toggles)
- **Filter**: Click a finding card → graph dims non-related nodes
- **Details on demand**: Evidence posts only shown when a node is selected

### Munzner's What/Why/How framework

> Every visualization answers: *What data? Why is the user looking? How is the encoding?*

— Tamara Munzner, *Visualization Analysis and Design*, CRC Press, 2014.

Our answers:
- **What**: Graph of {topic, source, painpoint, product, workaround} nodes + their evidence-edge relationships
- **Why**: Find validated product gaps in a market
- **How**: Node-link diagram + ranked card list + citation panel

### Tufte's data-ink ratio

> "Maximize the data-ink ratio" — remove every pixel that isn't data.

— Edward Tufte, *The Visual Display of Quantitative Information*, 1983.

Our viewer has:
- No chrome-heavy borders on cards
- Minimal toolbar chrome
- Badges that are informative not decorative
- Gridlines removed from graph

### Gestalt principles (proximity, similarity, closure)

Grouping emerges from spatial and visual cues. We use:
- **Proximity** via radial layout: similar-kind nodes cluster in concentric rings
- **Similarity** via color: each kind has a single hue; severity badges share hue
- **Closure** via bounded cards: each finding is a discrete rectangle, not a flowing list

---

## Qualitative research & voice-of-customer methodology

### Triangulation (Denzin, 1978)

> *"Combining data sources is a validity check: if a claim appears in independent sources, it is more likely true."*

— Norman K. Denzin, *The Research Act*, 1978.

We triangulate across up to 9 free sources:
- Reddit, Hacker News, App Store reviews, Play Store reviews
- arXiv, OpenAlex (academic)
- Google News, DEV.to, Stack Overflow, etc.

Each painpoint card displays its **cross-source tally** — users see which sources confirm the signal.

### Jobs-to-be-Done (JTBD)

> *"Customers don't buy products, they 'hire' them to do a job."*

— Clayton Christensen, *The Innovator's Dilemma* (1997); JTBD framework formalized in
Ulwick, *What Customers Want*, 2005.

Our **DIY workaround** extraction follows this directly: when users describe building their own solution, they are articulating the "job" existing tools fail at. These are the highest-conviction gap signals.

### Aspect-Based Sentiment Analysis (ABSA)

> *"Opinions target specific aspects of an entity, not the entity as a whole."*

— Bing Liu, *Sentiment Analysis and Opinion Mining*, 2012.

Our product-complaint extraction is ABSA in practice: we pull "Dovetail → Slack-ingest → missing" rather than "Dovetail → bad". Specificity enables actionability.

### Saturation principle

> *"In qualitative research, new interviews stop yielding new themes after ~12–20."*

— Guest, Bunce, & Johnson, *How Many Interviews Are Enough?*, 2006.

Our target is ~10 evidence posts per painpoint. Below that, extraction risks noise; above ~20, marginal return drops. Report card "frequency" shows how well this threshold was met.

### Kano Model (temporal classification)

> *"Features fall into basic / performance / delight tiers; tier membership shifts over time as expectations evolve."*

— Noriaki Kano et al., *Attractive Quality and Must-be Quality*, 1984.

Our **CHRONIC / EMERGING / FADING** tagging reflects Kano over time:
- CHRONIC = has been a basic expectation for years → must-have
- EMERGING = recent signal → likely moving from delight to performance
- FADING = was a pain, no longer surfaces → solved or obsolete

This is enabled by the pullpush historical archive + live Reddit JSON split at May 19, 2025.

---

## Graph-theoretic analysis

### PageRank on the evidence graph

> *"Importance is eigenvalue centrality — a node matters if other important nodes connect to it."*

— Brin & Page, *The Anatomy of a Large-Scale Hypertextual Web Search Engine*, 1998.

The `openreply_graph_pagerank` MCP tool ranks painpoints not just by frequency but by how central they are in the evidence graph. A painpoint connected to many DIY workarounds + products + other painpoints will outrank a painpoint with just 8 same-sub Reddit threads.

### Louvain community detection

> *"Modularity maximization identifies tightly-connected subgraphs."*

— Blondel et al., *Fast unfolding of communities in large networks*, J. Stat. Mech., 2008.

Surfaces hidden clusters — e.g., several painpoints that share evidence posts form a "theme cluster" even if we didn't label them with a common tag.

---

## What we deliberately DON'T do (and why)

### Why not sentiment models (VADER, distilBERT-SST2)?

Standalone sentiment models give a number without aspect. For gap-finding we need *why* + *about what*, not just polarity. LLMs do ABSA natively (Bing Liu 2012 standard); a VADER score would be worse than the corpus quotes we already surface.

### Why not pure topic modeling (LDA, BERTopic)?

Topic modeling finds statistical clusters but not *gaps*. A topic can be a discussion with no unmet need. Our extractor prompts are JTBD-structured: "what workaround did the user mention?" → that's the signal. LDA would miss this.

### Why not automate interview scheduling / calendar?

Out of scope — we surface who-to-DM, not coordinate the outreach. Adding this would duplicate Calendly and blur the product focus.

---

## Sources referenced above

- Shneiderman, B. (1996). *The Eyes Have It: A Task by Data Type Taxonomy for Information Visualizations*. IEEE Visual Languages.
- Munzner, T. (2014). *Visualization Analysis and Design*. CRC Press.
- Tufte, E. R. (1983). *The Visual Display of Quantitative Information*. Graphics Press.
- Denzin, N. K. (1978). *The Research Act*. McGraw-Hill.
- Christensen, C. M. (1997). *The Innovator's Dilemma*. Harvard Business Review Press.
- Ulwick, A. W. (2005). *What Customers Want*. McGraw-Hill.
- Liu, B. (2012). *Sentiment Analysis and Opinion Mining*. Morgan & Claypool.
- Guest, G., Bunce, A., & Johnson, L. (2006). *How Many Interviews Are Enough? An Experiment with Data Saturation and Variability*. Field Methods 18(1).
- Kano, N. et al. (1984). *Attractive Quality and Must-be Quality*. Journal of the Japanese Society for Quality Control.
- Brin, S., & Page, L. (1998). *The Anatomy of a Large-Scale Hypertextual Web Search Engine*. Stanford.
- Blondel, V. D. et al. (2008). *Fast unfolding of communities in large networks*. Journal of Statistical Mechanics.
