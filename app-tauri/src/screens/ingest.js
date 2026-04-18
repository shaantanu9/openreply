export async function renderIngest(root) {
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Workspace / <strong>Ingest</strong></div>
      <div class="topbar-spacer"></div>
    </header>
    <div class="section-head"><div><h2>Ingest local files</h2><p>Drop CSV, JSON, TXT, VTT, SRT, or MD into a topic.</p></div></div>
    <div class="empty-big">
      <h3>Coming in v1.1</h3>
      <p>For now, use the CLI: <code>reddit-cli ingest file --path X.csv --topic "your topic" --source-type interviews</code></p>
    </div>
  `;
}
