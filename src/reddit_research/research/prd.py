"""PRD generator — Phase 6.2 of the discovery framework.

Aggregates every discovery artefact attached to a Product into a single
markdown PRD: problem, JTBD, opportunities (painpoints + interventions
+ Kano + MoSCoW + RICE), Four Risks, Value Curve, TAM/SAM/SOM,
Porter's Five Forces, positioning map, PERT estimates, cost model,
PMF score, NPS, and out-of-scope list.

The PRD is intentionally markdown — easy to copy into Notion, Linear,
GitHub, or a Google Doc; trivial to diff in version control. Every
section degrades gracefully when the underlying artefact is missing
(emits "(not yet captured)" rather than crashing).

Written so it can run in either: (a) the CLI (`research prd-export`)
or (b) directly from Python; both produce the same string.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

from . import pert as pert_mod
from . import pmf as pmf_mod
from . import pricing as pricing_mod
from .ost import build_tree
from ..core.db import get_db


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _line(s: str = "") -> str:
    return s + "\n"


def _h(level: int, text: str) -> str:
    return "#" * level + " " + text + "\n\n"


def _mny(amount: float, units: str = "USD") -> str:
    if not amount:
        return "(unset)"
    if amount >= 1_000_000_000:
        return f"{units} {amount / 1_000_000_000:,.2f}B"
    if amount >= 1_000_000:
        return f"{units} {amount / 1_000_000:,.2f}M"
    if amount >= 1_000:
        return f"{units} {amount / 1_000:,.1f}K"
    return f"{units} {amount:,.0f}"


def _safe(v: Any, dflt: str = "—") -> str:
    s = str(v or "").strip()
    return s if s else dflt


def generate(product_id: str) -> dict[str, Any]:
    """Build the full PRD as markdown."""
    from . import product as product_mod
    from . import interviews as interviews_mod

    prod = product_mod.get_product(product_id)
    if not prod or "id" not in prod:
        return {"ok": False, "error": f"product '{product_id}' not found"}

    topic = prod.get("topic") or product_id
    name = prod.get("name") or product_id
    out: list[str] = []

    out.append(_h(1, f"Product Requirements — {name}"))
    out.append(_line(f"_Generated {_utc_now()} from Gap Map discovery artefacts._"))
    out.append(_line(""))
    if prod.get("one_liner"):
        out.append(_line(f"**One-liner:** {prod['one_liner']}"))
    out.append(_line(f"**Linked topic:** `{topic}`"))
    out.append(_line(f"**Product ID:** `{product_id}`"))
    out.append(_line(""))

    # Outcome (OST root)
    outcome = prod.get("outcome") or ""
    out.append(_h(2, "1. Desired outcome"))
    out.append(_line(outcome or "_(set the OST root outcome from the OST screen)_"))

    # Stage-Gate verdict
    gate = product_mod.gate_get(product_id) if hasattr(product_mod, "gate_get") else {}
    if gate.get("ok"):
        gs = gate.get("gate_status") or ""
        if gs:
            out.append(_line(f"**Stage-Gate verdict:** {gs.upper()} — {_safe(gate.get('gate_notes'))}"))

    # Four Risks
    fr = product_mod.four_risks_get(product_id)
    out.append(_h(2, "2. Cagan's Four Risks (Inspired, 2017)"))
    if fr.get("ok") and fr.get("risks"):
        for k, v in fr["risks"].items():
            status = (v or {}).get("status", "unknown").upper()
            notes = (v or {}).get("notes") or ""
            out.append(_line(f"- **{k.title()}** — {status}{(' — ' + notes) if notes else ''}"))
    else:
        out.append(_line("_(four risks not yet evaluated)_"))
    out.append(_line(""))

    # JTBD + opportunities (from OST)
    out.append(_h(2, "3. Jobs to be done & opportunities"))
    try:
        tree = build_tree(topic, product_id=product_id)
    except Exception as e:
        tree = {"opportunities": [], "_error": str(e)}
    opps = tree.get("opportunities") or []
    if not opps:
        out.append(_line("_(no opportunities yet — run the Solutions pipeline on this topic)_"))
    for o in opps:
        out.append(_h(3, o.get("label") or "Opportunity"))
        if o.get("jtbd_statement"):
            out.append(_line(f"**JTBD:** _{o['jtbd_statement']}_"))
        if o.get("desired_outcome"):
            out.append(_line(f"**Desired outcome:** {o['desired_outcome']}"))
        sols = o.get("solutions") or []
        if sols:
            out.append(_line(""))
            out.append(_line("**Solutions (sorted by RICE):**"))
            for s in sols:
                rice = s.get("rice") or {}
                kano = s.get("kano") or "—"
                moscow = s.get("moscow") or "—"
                score = rice.get("score") if isinstance(rice, dict) else None
                tag = []
                if score is not None:
                    tag.append(f"RICE {score:.1f}")
                if kano and kano != "—":
                    tag.append(f"Kano: {kano}")
                if moscow and moscow != "—":
                    tag.append(f"MoSCoW: {moscow}")
                tagstr = f" _{' · '.join(tag)}_" if tag else ""
                out.append(_line(f"- {s.get('label') or 'Solution'}{tagstr}"))
                if s.get("rationale"):
                    out.append(_line(f"  - {s['rationale']}"))
        exps = []
        for s in sols:
            for e in (s.get("experiments") or []):
                exps.append(e)
        if exps:
            out.append(_line(""))
            out.append(_line("**Experiments:**"))
            for e in exps:
                out.append(_line(f"- _{e.get('method', 'custom')}_ — {e.get('hypothesis') or '(no hypothesis)'} (status: {e.get('status') or 'planned'})"))
        out.append(_line(""))

    # Empathy maps
    if "empathy_maps" in get_db().table_names():
        em_rows = list(get_db().query(
            "SELECT * FROM empathy_maps WHERE topic = ? ORDER BY persona",
            [topic],
        ))
        if em_rows:
            out.append(_h(2, "4. Empathy maps (Gray, 2010)"))
            for em in em_rows:
                out.append(_h(3, f"Persona: {em.get('persona') or 'primary'}"))
                for k, label in (("says", "Says"), ("thinks", "Thinks"), ("does", "Does"), ("feels", "Feels")):
                    try:
                        items = json.loads(em.get(f"{k}_json") or "[]")
                    except Exception:
                        items = []
                    out.append(_line(f"**{label}:**"))
                    if items:
                        for it in items:
                            out.append(_line(f"  - {it}"))
                    else:
                        out.append(_line("  _(none)_"))
                gap = (em.get("gap_notes") or "").strip()
                if gap:
                    out.append(_line(f"\n**Says-vs-Does gap:** {gap}"))
                out.append(_line(""))

    # Market sizing
    tss = product_mod.tam_sam_som_get(product_id)
    out.append(_h(2, "5. Market sizing (TAM / SAM / SOM)"))
    if tss.get("ok"):
        for k in ("tam", "sam", "som"):
            v = tss.get(k) or {}
            label = k.upper()
            if v.get("value"):
                out.append(_line(
                    f"- **{label}** — {_mny(v.get('value', 0), v.get('units', 'USD'))} "
                    f"_(method: {_safe(v.get('method'))}; source: {_safe(v.get('source'))})_"
                ))
            else:
                out.append(_line(f"- **{label}** — _(not set)_"))
    out.append(_line(""))

    # Porter's Five Forces
    porter = product_mod.porter_get(product_id)
    out.append(_h(2, "6. Porter's Five Forces (1979)"))
    if porter.get("ok") and porter.get("forces"):
        labels = {
            "new_entrants": "Threat of new entrants",
            "supplier_power": "Bargaining power of suppliers",
            "buyer_power": "Bargaining power of buyers",
            "substitutes": "Threat of substitutes",
            "rivalry": "Competitive rivalry",
        }
        for k, v in (porter.get("forces") or {}).items():
            score = v.get("score", 0)
            notes = v.get("notes") or ""
            out.append(_line(f"- **{labels.get(k, k)}** — {score}/5{(' — ' + notes) if notes else ''}"))
    out.append(_line(""))

    # Positioning map
    pos = product_mod.positioning_get(product_id)
    if pos.get("ok") and (pos.get("points") or []):
        out.append(_h(2, "7. 2×2 Positioning map"))
        out.append(_line(f"_Axes: {pos.get('x_axis')} (X) × {pos.get('y_axis')} (Y)_"))
        for pt in pos.get("points") or []:
            tag = " — **(self)**" if pt.get("is_self") else ""
            out.append(_line(f"- **{pt.get('name')}** at ({pt.get('x'):.1f}, {pt.get('y'):.1f}){tag}"))
        out.append(_line(""))

    # Value curve
    vc = product_mod.value_curve_get(product_id)
    if vc.get("ok") and vc.get("factors"):
        out.append(_h(2, "8. Blue Ocean Value Curve (Kim & Mauborgne, 2005)"))
        for f, s in zip(vc["factors"], vc.get("self") or []):
            out.append(_line(f"- {f}: {s:.0f}/10"))
        fa = vc.get("four_actions") or {}
        if any(fa.values()):
            out.append(_line("\n**Four actions:**"))
            for k in ("eliminate", "reduce", "raise", "create"):
                if fa.get(k):
                    out.append(_line(f"- **{k.title()}:** {fa[k]}"))
        out.append(_line(""))

    # PMF + NPS
    pmf = pmf_mod.score(topic, product_id=product_id)
    nps = pricing_mod.nps_score(topic, product_id=product_id)
    if (pmf.get("n_total") or 0) or (nps.get("n") or 0):
        out.append(_h(2, "9. Demand validation"))
        if pmf.get("n_total"):
            verdict = "✅ PMF threshold met" if pmf.get("threshold_met") else "❌ Below 40% threshold"
            out.append(_line(f"**Sean Ellis PMF:** {pmf.get('pct_very_disappointed')}% very disappointed (n={pmf.get('n_scored')}). {verdict}"))
        if nps.get("n"):
            out.append(_line(f"**NPS:** {nps.get('nps')} (promoters {nps.get('promoters')}, passives {nps.get('passives')}, detractors {nps.get('detractors')}, n={nps.get('n')})"))
        # Van Westendorp
        vw = pricing_mod.vw_aggregate(topic, product_id=product_id)
        if vw.get("n"):
            out.append(_line(
                f"**Van Westendorp:** OPP {vw.get('opp')}, IPP {vw.get('ipp')}, "
                f"acceptable range {vw.get('pmc')}–{vw.get('pme')} (n={vw.get('n')})"
            ))
        # MaxDiff
        md = pricing_mod.maxdiff_ranking(topic, product_id=product_id)
        if md.get("n"):
            out.append(_line(f"**MaxDiff feature ranking** (top 5 of {md.get('n')} responses):"))
            for it in (md.get("ranking") or [])[:5]:
                out.append(_line(f"  {it.get('option')} — BW score {it.get('bw_score'):+.2f}"))
        out.append(_line(""))

    # Customer interviews
    ints = interviews_mod.list_interviews(topic, product_id=product_id)
    if ints:
        out.append(_h(2, "10. Customer discovery interviews"))
        out.append(_line(f"{len(ints)} interview(s) on file. Average rigour: {interviews_mod.summarize(topic, product_id).get('rigour_avg')}/5."))
        out.append(_line(""))
        for i in ints[:20]:
            line = f"- **{i.get('interviewee_name')}** ({i.get('persona') or 'unknown'}) — {i.get('summary') or '(no summary)'}"
            if i.get("jtbd_quote"):
                line += f"\n  > _{i['jtbd_quote']}_"
            out.append(_line(line))
        out.append(_line(""))

    # PERT estimates + cost
    pe = pert_mod.rollup(product_id)
    if pe.get("n"):
        out.append(_h(2, "11. Estimation & cost"))
        out.append(_line(f"**PERT total:** {pe.get('expected_days_with_contingency')} days expected (raw {pe.get('expected_days_raw')}d × {pe.get('multiplier')}× overhead × {pe.get('contingency_pct')}% contingency)"))
        if pe.get("by_role"):
            roles = ", ".join(f"{k}: {v}d" for k, v in (pe.get("by_role") or {}).items())
            out.append(_line(f"**By role:** {roles}"))
        out.append(_line(""))
    cm = product_mod.cost_model_get(product_id)
    if cm.get("ok") and (cm.get("blended_rate") or cm.get("infra_monthly")):
        out.append(_line(f"**Blended hourly rate:** {_mny(cm.get('blended_rate', 0), cm.get('currency', 'USD'))}/hr"))
        out.append(_line(f"**Infrastructure:** {_mny(cm.get('infra_monthly', 0), cm.get('currency', 'USD'))}/mo"))
        out.append(_line(f"**Maintenance:** {cm.get('maintenance_pct', 18)}% of build/year"))
        if cm.get("ltv") and cm.get("cac"):
            ratio = cm["ltv"] / cm["cac"] if cm["cac"] else 0
            verdict = "✅ healthy" if ratio >= 3 else "⚠️ unhealthy"
            out.append(_line(f"**LTV / CAC:** {cm['ltv']:.0f} / {cm['cac']:.0f} = {ratio:.2f}× {verdict}"))
        if cm.get("tiers"):
            out.append(_line("\n**Pricing tiers:**"))
            for t in cm.get("tiers"):
                out.append(_line(f"- **{t.get('name')}**: {_safe(t.get('scope'))} — {t.get('weeks_lo')}–{t.get('weeks_hi')} wk · {_mny(t.get('price_lo', 0))}–{_mny(t.get('price_hi', 0))}"))
        out.append(_line(""))

    # Out-of-scope (MoSCoW Won't)
    db = get_db()
    if "graph_nodes" in db.table_names():
        wont_rows = list(db.query(
            """
            SELECT label FROM graph_nodes
            WHERE topic = ? AND kind = 'intervention'
              AND metadata_json LIKE '%"moscow":"wont"%'
            LIMIT 50
            """,
            [topic],
        ))
        if wont_rows:
            out.append(_h(2, "12. Out of scope (MoSCoW Won't-have)"))
            for r in wont_rows:
                out.append(_line(f"- {r.get('label')}"))
            out.append(_line(""))

    md_text = "".join(out)
    return {"ok": True, "product_id": product_id, "markdown": md_text, "char_count": len(md_text)}


__all__ = ["generate"]
