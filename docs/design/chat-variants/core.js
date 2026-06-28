/* ──────────────────────────────────────────────────────────────────────────
   OpenReply — Topic-Insights + Chat prototype : SHARED CORE ENGINE
   Exposes window.GM = { DATA, KIND_COLORS, GapGraph, ChatBrain, buildInsights,
   buildLenses, SUGGESTIONS }. Every variant imports this so the graph, the
   mock dataset and the canned chat behave identically — only layout differs.
   Requires d3 v7 loaded before this file.
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  const KIND_COLORS = {
    topic:"#FF8C42", subreddit:"#8B6FD4", post:"#4A90C4", comment:"#5FA6D9",
    user:"#5FB88C", painpoint:"#E26A6A", feature_wish:"#E69447",
    product:"#D48BA6", workaround:"#7DC9A3",
  };
  const KIND_LABEL = {
    topic:"Topic", subreddit:"Subreddit", post:"Post", comment:"Comment",
    user:"User", painpoint:"Painpoint", feature_wish:"Feature wish",
    product:"Product", workaround:"DIY workaround",
  };
  // community 0 = complexity/overwhelm · 1 = choice/discovery · 2 = organization
  const N = (id, label, kind, community, val, meta) => ({ id, label, kind, community, val: val||6, meta: meta||{} });
  const nodes = [
    N("topic","note-taking app","topic",0,16,{ note:"root topic" }),
    // painpoints
    N("pp1","Overwhelmed by app complexity","painpoint",0,12,{ sev:"high", freq:8, quote:"Notion and Obsidian are amazing, but they can be too complicated." }),
    N("pp2","Choice paralysis — which app?","painpoint",1,13,{ sev:"medium", freq:18, quote:"I've tried countless tools. Notion vs Obsidian vs Evernote vs Apple Notes." }),
    N("pp3","Organizing & managing notes","painpoint",2,11,{ sev:"medium", freq:12, quote:"I've been searching for ways to replace this habit with something more productive." }),
    // products
    N("prodNotion","Notion","product",0,9,{}), N("prodObsidian","Obsidian","product",0,9,{}),
    N("prodEvernote","Evernote","product",1,7,{}), N("prodApple","Apple Notes","product",1,7,{}),
    N("prodRoam","Roam Research","product",2,6,{}),
    // subreddits
    N("subNotion","r/Notion","subreddit",0,8,{}), N("subObsidian","r/ObsidianMD","subreddit",0,8,{}),
    N("subProd","r/productivity","subreddit",1,9,{}), N("subPKM","r/PKMS","subreddit",2,7,{}),
    // posts
    N("post1","“Setup took me a weekend”","post",0,6,{ quote:"Spent a whole weekend on templates before writing a single real note." }),
    N("post2","“Too many features, paralyzed”","post",0,6,{ quote:"Every feature is a rabbit hole. I just want to type." }),
    N("post3","“Notion vs Obsidian for beginners?”","post",1,6,{ quote:"Which is less overwhelming to start with?" }),
    N("post4","“Switched 5 times this year”","post",1,6,{ quote:"App-hopping is its own productivity sink." }),
    N("post5","“My folder system collapsed”","post",2,6,{ quote:"Nested folders became unmanageable past 200 notes." }),
    N("post6","“Tags or folders?”","post",2,6,{ quote:"Can never decide on a structure and stick to it." }),
    // comments
    N("c1","“Start with plain markdown”","comment",0,4,{ quote:"Honestly just use .md files until you feel a real limit." }),
    N("c2","“MOC saved my graph”","comment",2,4,{ quote:"Maps-of-content beat folders for me." }),
    // feature wishes
    N("fw1","Simpler guided onboarding","feature_wish",0,6,{}),
    N("fw2","Reliable cross-device sync","feature_wish",1,6,{}),
    // workarounds
    N("wa1","Plain markdown files","workaround",0,6,{}),
    N("wa2","Map-of-Content index note","workaround",2,6,{}),
    // users
    N("u1","u/quietwriter","user",0,4,{}), N("u2","u/pkm_nerd","user",2,4,{}), N("u3","u/switcher99","user",1,4,{}),
  ];
  const L = (s, t, kind, conf, cross) => ({ source:s, target:t, kind:kind||"relates_to", confidence:conf||"EXTRACTED", cross:!!cross });
  const links = [
    L("topic","pp1"), L("topic","pp2"), L("topic","pp3"),
    // pp1 complexity cluster
    L("pp1","post1","evidence"), L("pp1","post2","evidence"), L("pp1","c1","evidence"),
    L("post1","subNotion"), L("post2","subObsidian"), L("c1","subObsidian"),
    L("pp1","prodNotion","complained_about"), L("pp1","prodObsidian","complained_about"),
    L("pp1","fw1","could_address"), L("pp1","wa1","worked_around"), L("post2","u1"),
    // pp2 choice cluster
    L("pp2","post3","evidence"), L("pp2","post4","evidence"),
    L("post3","subProd"), L("post4","subProd"), L("post4","u3"),
    L("pp2","prodEvernote","complained_about"), L("pp2","prodApple","complained_about"),
    L("pp2","prodNotion","complained_about"), L("pp2","fw2","could_address"),
    // pp3 organization cluster
    L("pp3","post5","evidence"), L("pp3","post6","evidence"), L("pp3","c2","evidence"),
    L("post5","subPKM"), L("post6","subPKM"), L("c2","subPKM"), L("post5","u2"),
    L("pp3","prodRoam","complained_about"), L("pp3","wa2","worked_around"),
    // cross-community "surprising" edges
    L("wa1","pp3","potentially_solves",null,true),   // plain md (cmplx) ↔ organization
    L("fw1","pp2","could_address",null,true),         // onboarding (cmplx) ↔ choice
    L("c1","pp1","co_evidenced","INFERRED",false),
    L("u3","pp1","also_active","INFERRED",true),      // a switcher also overwhelmed
  ];
  const DATA = { nodes, links };

  /* ── perf: inflate the dataset with N synthetic nodes so each variant can be
     stress-tested against a big graph via ?n=2000 in the URL. Synthetic nodes
     are label-free and the engine drops expensive forces above a threshold, so
     this mirrors how the real multi-MB export must stay interactive. */
  function inflate(extra) {
    if (!extra || extra < 1) return;
    const anchors = ["pp1","pp2","pp3","subProd","subPKM","subNotion"];
    const kinds = ["post","comment","user","product"];
    for (let i = 0; i < extra; i++) {
      const id = "syn" + i, k = kinds[i % kinds.length];
      DATA.nodes.push({ id, label: "", kind: k, community: i % 3, val: 3, meta: {}, _syn: true });
      const a = anchors[i % anchors.length];
      DATA.links.push({ source: id, target: a, kind: "relates_to", confidence: "INFERRED", cross: false });
      if (i % 5 === 0) DATA.links.push({ source: id, target: "syn" + ((i + 1) % extra || 0), confidence: "AMBIGUOUS", cross: false });
    }
  }

  // ── canned chat brain ───────────────────────────────────────────────────
  // Each intent → answer text + the node ids it "cites" (drives the graph),
  // and an ordered relationPath for variants that animate a trace.
  const INTENTS = [
    { keys:["overwhelm","complex","complicated","too many","feature","paralyz","hard to start","onboard"],
      title:"complexity overwhelm",
      text:"<b>Complexity overwhelm</b> is the highest-severity painpoint (8 posts). People love Notion and Obsidian's power but bounce off the setup — “every feature is a rabbit hole.” The graph shows it sitting between the two heavyweight products, with a feature-wish for <b>simpler guided onboarding</b> as the likely fix and <b>plain markdown</b> as the common workaround.",
      cites:["pp1","prodNotion","prodObsidian","fw1","wa1","post2"],
      path:["pp1","post2","prodObsidian","fw1"] },
    { keys:["choice","which app","best app","compare","vs","switch","decide","picking","pick"],
      title:"choice paralysis",
      text:"<b>Choice paralysis</b> is the most frequent painpoint (18 mentions). Users churn between Notion, Evernote and Apple Notes — “switched 5 times this year.” It clusters in r/productivity, and the only feature-wish that reliably ends the churn is <b>dependable cross-device sync</b>.",
      cites:["pp2","prodNotion","prodEvernote","prodApple","subProd","fw2","post4"],
      path:["pp2","post4","prodEvernote","fw2"] },
    { keys:["organiz","manage","folder","tag","structure","messy","moc","map of content"],
      title:"organizing notes",
      text:"<b>Organizing & managing notes</b> breaks down once a vault passes ~200 notes — “my folder system collapsed.” The winning DIY workaround is a <b>Map-of-Content index note</b> over rigid folders, surfaced mostly in r/PKMS.",
      cites:["pp3","post5","post6","wa2","subPKM","c2"],
      path:["pp3","post5","wa2"] },
    { keys:["surpris","unexpected","bridge","connection","hidden","insight"],
      title:"a surprising connection",
      text:"<b>Surprising bridge:</b> the <b>plain-markdown</b> workaround for complexity overwhelm also quietly solves the <b>organization</b> painpoint — a cross-community link most reports miss. Simplicity is doing double duty.",
      cites:["wa1","pp1","pp3"],
      path:["pp1","wa1","pp3"] },
  ];
  const ChatBrain = {
    suggestions: [
      "Why are users overwhelmed?",
      "What drives app-choice paralysis?",
      "How do people organize notes?",
      "Show me a surprising connection",
    ],
    respond(q) {
      const s = (q||"").toLowerCase();
      let best = null, bestScore = 0;
      for (const it of INTENTS) {
        const score = it.keys.reduce((n,k)=> n + (s.includes(k)?1:0), 0);
        if (score > bestScore) { bestScore = score; best = it; }
      }
      if (!best) best = INTENTS[0];
      return { text: best.text, cites: best.cites.slice(), path: best.path.slice(), title: best.title };
    }
  };

  // ── d3 graph view with a tidy imperative API ─────────────────────────────
  function GapGraph(svgSelector, opts) {
    opts = opts || {};
    const svg = d3.select(svgSelector);
    const svgEl = svg.node();
    let width = svgEl.clientWidth || 600, height = svgEl.clientHeight || 500;
    svg.selectAll("*").remove();
    const root = svg.append("g");
    const zoom = d3.zoom().scaleExtent([0.25, 4]).on("zoom", e => root.attr("transform", e.transform));
    svg.call(zoom).on("dblclick.zoom", null);

    const data = { nodes: DATA.nodes.map(d=>({ ...d })), links: DATA.links.map(d=>({ ...d })) };
    const byId = new Map(data.nodes.map(n=>[n.id,n]));
    const adj = new Map(data.nodes.map(n=>[n.id, new Set()]));
    data.links.forEach(l => {
      const s = typeof l.source==="object"?l.source.id:l.source;
      const t = typeof l.target==="object"?l.target.id:l.target;
      adj.get(s).add(t); adj.get(t).add(s);
    });

    const BIG = data.nodes.length > 400;   // perf threshold — mirrors export skeleton mode
    const sim = d3.forceSimulation(data.nodes)
      .force("link", d3.forceLink(data.links).id(d=>d.id).distance(l=> l.cross?160:70).strength(BIG?.25:.6))
      .force("charge", d3.forceManyBody().strength(BIG?-60:-220).theta(.9).distanceMax(BIG?260:Infinity))
      .force("center", d3.forceCenter(width/2, height/2));
    if (!BIG) sim.force("collide", d3.forceCollide().radius(d=> Math.sqrt(d.val)*3+8));
    else sim.alphaDecay(.045);   // settle faster on big graphs

    const link = root.append("g").selectAll("line").data(data.links).join("line")
      .attr("class", d=> "link confidence-"+d.confidence + (d.cross?" cross":""))
      .attr("stroke-dasharray", d=> d.confidence==="INFERRED"?"5 3":null);

    const node = root.append("g").selectAll("g").data(data.nodes).join("g")
      .attr("class","node").call(drag(sim))
      .on("click", (e,d)=> { e.stopPropagation(); opts.onNodeClick && opts.onNodeClick(d); focusNode(d.id); });
    node.append("circle")
      .attr("r", d=> Math.sqrt(d.val)*2.6 + 3)
      .attr("fill", d=> KIND_COLORS[d.kind] || "#bbb")
      .attr("stroke", "#fff").attr("stroke-width", 1.4);
    // perf: skip labels on synthetic/user nodes and entirely on big graphs (DOM text is the SVG bottleneck)
    const labels = node.append("text").text(d=> (BIG || d._syn || d.kind==="user") ? "" : trunc(d.label, 22))
      .attr("x", d=> Math.sqrt(d.val)*2.6 + 6).attr("y", 3);

    let showUsers = false, activeLens = null;
    applyUserVisibility();

    sim.on("tick", () => {
      link.attr("x1",d=>d.source.x).attr("y1",d=>d.source.y).attr("x2",d=>d.target.x).attr("y2",d=>d.target.y);
      node.attr("transform", d=> `translate(${d.x},${d.y})`);
    });

    svg.on("click", ()=> { opts.onBackground && opts.onBackground(); });

    function drag(sim){
      return d3.drag()
        .on("start",(e,d)=>{ if(!e.active) sim.alphaTarget(.3).restart(); d.fx=d.x; d.fy=d.y; })
        .on("drag",(e,d)=>{ d.fx=e.x; d.fy=e.y; })
        .on("end",(e,d)=>{ if(!e.active) sim.alphaTarget(0); d.fx=null; d.fy=null; });
    }
    function trunc(s,n){ return s.length>n ? s.slice(0,n-1)+"…" : s; }
    function applyUserVisibility(){
      node.classed("hidden", d=> d.kind==="user" && !showUsers);
      link.classed("hidden", d=> (kindOf(d.source)==="user"||kindOf(d.target)==="user") && !showUsers);
    }
    function kindOf(x){ return (typeof x==="object"?x:byId.get(x)).kind; }
    function neighborhood(ids, depth){
      const keep = new Set(ids); let frontier = new Set(ids);
      for (let i=0;i<(depth||1);i++){ const nf=new Set();
        frontier.forEach(id=> adj.get(id).forEach(n=>{ if(!keep.has(n)){ keep.add(n); nf.add(n);} }));
        frontier = nf; }
      return keep;
    }
    function zoomTo(ids, pad){
      const pts = data.nodes.filter(n=> ids.has(n.id) && n.x!=null);
      if (!pts.length) return;
      const xs=pts.map(p=>p.x), ys=pts.map(p=>p.y);
      const x0=Math.min(...xs), x1=Math.max(...xs), y0=Math.min(...ys), y1=Math.max(...ys);
      const dx=Math.max(x1-x0,80), dy=Math.max(y1-y0,80);
      const k=Math.min(2.2, (pad||0.82)*Math.min(width/dx, height/dy));
      const tx=width/2 - k*(x0+x1)/2, ty=height/2 - k*(y0+y1)/2;
      svg.transition().duration(620).call(zoom.transform, d3.zoomIdentity.translate(tx,ty).scale(k));
    }

    // ── public API ──
    const api = {
      reset(){
        activeLens=null;
        node.classed("dim",false).classed("highlighted",false).classed("gap",false).classed("bridge",false);
        link.classed("dim",false).classed("highlighted",false).classed("surprising",false);
        applyUserVisibility();
        svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
        sim.alpha(.25).restart();
      },
      /* highlight a set of nodes + the links among them, dim the rest, zoom in */
      highlight(ids, o){
        o=o||{}; const set=new Set(ids);
        node.classed("dim", d=> !set.has(d.id) && !(d.kind==="user"&&!showUsers))
            .classed("highlighted", d=> set.has(d.id));
        link.classed("dim", d=> !(set.has(d.source.id)&&set.has(d.target.id)))
            .classed("highlighted", d=> set.has(d.source.id)&&set.has(d.target.id));
        if (o.zoom!==false) zoomTo(set, .8);
      },
      /* collapse the hairball to just one finding + its evidence sub-tree */
      focusSubtree(rootId, depth){
        const keep = neighborhood([rootId], depth||2);
        node.classed("hidden", d=> !keep.has(d.id))
            .classed("highlighted", d=> d.id===rootId)
            .classed("dim", false);
        link.classed("hidden", d=> !(keep.has(d.source.id)&&keep.has(d.target.id)))
            .classed("dim",false)
            .classed("highlighted", d=> keep.has(d.source.id)&&keep.has(d.target.id));
        // re-heat so the kept subset spreads out nicely
        sim.alpha(.5).restart();
        setTimeout(()=> zoomTo(keep, .7), 260);
      },
      /* animate a path node→node→node, lighting each hop (used by conversation variant) */
      pathTrace(ids){
        api.dimAll();
        let i=0;
        const step=()=>{
          if(i>=ids.length) return;
          const cur=ids[i];
          node.filter(d=>d.id===cur).classed("dim",false).classed("highlighted",true);
          if(i>0){ const a=ids[i-1], b=cur;
            link.filter(d=> (d.source.id===a&&d.target.id===b)||(d.source.id===b&&d.target.id===a))
                .classed("dim",false).classed("highlighted",true); }
          i++; setTimeout(step, 430);
        };
        zoomTo(new Set(ids), .7); step();
      },
      dimAll(){ node.classed("dim",true).classed("highlighted",false); link.classed("dim",true).classed("highlighted",false); },
      lens(name){
        activeLens = (activeLens===name) ? null : name;
        node.classed("dim",false).classed("highlighted",false).classed("gap",false).classed("bridge",false);
        link.classed("dim",false).classed("highlighted",false).classed("surprising",false);
        if (!activeLens) { sim.alpha(.1).restart(); return null; }
        if (name==="surprising") link.classed("surprising", d=> d.cross);
        if (name==="gaps") node.classed("gap", d=> d.kind==="painpoint" && ![...adj.get(d.id)].some(n=>byId.get(n).kind==="product"));
        if (name==="bridges") node.classed("bridge", d=> adj.get(d.id).size>=4);
        if (name==="communities") node.select("circle").attr("fill", d=> ["#FF8C42","#8B6FD4","#5FB88C"][d.community]||"#bbb");
        else node.select("circle").attr("fill", d=> KIND_COLORS[d.kind]||"#bbb");
        return activeLens;
      },
      setShowUsers(v){ showUsers=!!v; applyUserVisibility(); },
      search(term){
        const t=(term||"").toLowerCase().trim();
        if(!t){ api.reset(); return; }
        const ids = data.nodes.filter(n=> n.label.toLowerCase().includes(t)).map(n=>n.id);
        if(ids.length) api.highlight(ids);
      },
      focusNodeById: focusNode,
      neighborsOf(id){ return [...adj.get(id)].map(n=>byId.get(n)); },
      get(id){ return byId.get(id); },
      resize(){ width=svgEl.clientWidth; height=svgEl.clientHeight;
        sim.force("center", d3.forceCenter(width/2,height/2)).alpha(.2).restart(); },
    };
    function focusNode(id){ api.highlight(neighborhood([id],1)); }
    return api;
  }

  // ── shared HTML builders (so variants don't duplicate insight markup) ────
  function el(html){ const t=document.createElement("template"); t.innerHTML=html.trim(); return t.content.firstElementChild; }
  function ppCard(d){
    const sev = d.meta.sev==="high"?"severity-high":"severity-medium";
    return `<div class="card" data-node="${d.id}">
      <div class="card-title">${d.label}</div>
      <div class="card-meta"><span class="badge ${sev}">${d.meta.sev} sev</span>
        <span class="badge sat-thin">thin</span><span>freq: ${d.meta.freq}</span></div>
      <div class="card-evidence">${d.meta.quote||""}</div></div>`;
  }
  function simpleCard(d){
    return `<div class="card" data-node="${d.id}"><div class="card-title">${d.label}</div>
      <div class="card-meta"><span>${KIND_LABEL[d.kind]}</span></div></div>`;
  }
  /* fills a container with the left-panel insight content; wires card→graph */
  function buildInsights(container, graph){
    const pps = DATA.nodes.filter(n=>n.kind==="painpoint");
    const prods = DATA.nodes.filter(n=>n.kind==="product");
    const was = DATA.nodes.filter(n=>n.kind==="workaround");
    const fws = DATA.nodes.filter(n=>n.kind==="feature_wish");
    container.innerHTML = `
      <div class="gm-h2">📊 Top insights by source</div>
      <div class="card" data-node="pp1"><div class="card-title">YOUTUBE · Overwhelmed by complexity</div>
        <div class="card-meta"><span>1 evidence</span></div></div>
      <div class="gm-h2">🔥 Painpoints <span class="muted">(${pps.length})</span></div>
      <div id="painpoints">${pps.map(ppCard).join("")}</div>
      <div class="gm-h2">🛠 DIY workarounds <span class="muted">· gap signal</span></div>
      <div id="workarounds">${was.map(simpleCard).join("")}</div>
      <div class="gm-h2">💡 Feature wishes</div>
      <div id="features">${fws.map(simpleCard).join("")}</div>
      <div class="gm-h2">😡 Products complained about</div>
      <div id="products">${prods.map(simpleCard).join("")}</div>`;
    container.querySelectorAll(".card[data-node]").forEach(c=>{
      c.addEventListener("click", ()=>{
        container.querySelectorAll(".card.active").forEach(a=>a.classList.remove("active"));
        c.classList.add("active");
        graph.focusNodeById(c.getAttribute("data-node"));
      });
    });
  }
  /* fills a container with the right-panel lens controls; wires to graph */
  function buildLenses(container, graph, onReset){
    container.innerHTML = `
      <div class="gm-controls">
        <button data-act="reset">⟳ Reset zoom</button>
        <label><input type="checkbox" data-act="users"> Show users</label>
      </div>
      <div class="lenses">
        <input class="lens-search" type="search" placeholder="Search findings…" data-act="search"/>
        <button class="lens-btn" data-lens="surprising">⚡ Surprising</button>
        <button class="lens-btn" data-lens="gaps">🕳 Gaps</button>
        <button class="lens-btn" data-lens="bridges">🌉 Bridges</button>
        <button class="lens-btn" data-lens="communities">🎨 Communities</button>
      </div>`;
    container.querySelector('[data-act="reset"]').addEventListener("click", ()=>{
      graph.reset(); container.querySelectorAll(".lens-btn.active").forEach(b=>b.classList.remove("active"));
      onReset && onReset();
    });
    container.querySelector('[data-act="users"]').addEventListener("change", e=> graph.setShowUsers(e.target.checked));
    container.querySelector('[data-act="search"]').addEventListener("input", e=> graph.search(e.target.value));
    container.querySelectorAll(".lens-btn").forEach(b=>{
      b.addEventListener("click", ()=>{
        const active = graph.lens(b.getAttribute("data-lens"));
        container.querySelectorAll(".lens-btn").forEach(x=>x.classList.remove("active"));
        if (active) b.classList.add("active");
      });
    });
  }

  /* read ?n=NNNN once, inflate, and return the total node count for the header badge */
  function applyStressFromURL() {
    const n = parseInt(new URLSearchParams(location.search).get("n") || "0", 10);
    if (n > 0) inflate(n);
    return DATA.nodes.length;
  }

  window.GM = { DATA, KIND_COLORS, KIND_LABEL, GapGraph, ChatBrain, buildInsights, buildLenses, inflate, applyStressFromURL };
})();
