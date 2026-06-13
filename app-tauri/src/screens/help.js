// Help & Tutorials hub — one discoverable home for learning the app.
// Replay the product tour, browse every screen explainer, jump into the
// product-flow playbook, and read quick tips. Reuses the why explainer
// registry (api.pageExplanationsList) and the tour engine (lib/tours.js).

import { api, esc } from '../api.js';
import { replayGettingStarted } from '../lib/tours.js';
import { whyButtonHTML } from './why.js';

export async function renderHelp(main /*, ctx */) {
  main.innerHTML = `
    <div class="screen" style="max-width:1000px;margin:0 auto;padding:20px">
      <div class="topbar" style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <h2 style="display:flex;align-items:center;gap:8px"><i data-lucide="life-buoy"></i> Help &amp; Tutorials</h2>
        <span style="margin-left:auto" id="help-why-mount"></span>
      </div>
      <p class="muted" style="font-size:13px;margin:2px 0 18px">
        New to Gap Map, or showing it to someone? Start with the tour, then dip into any
        screen explainer when you need it.
      </p>

      <div class="help-hub-grid">
        <div class="help-hub-card card">
          <h3><i data-lucide="compass"></i> Take the product tour</h3>
          <p>A 30-second guided walkthrough of the core flow: research a topic → read the
             signal → synthesize → write.</p>
          <button class="btn btn-primary btn-sm" id="help-take-tour"><i data-lucide="play"></i> Start the tour</button>
        </div>

        <div class="help-hub-card card">
          <h3><i data-lucide="git-branch"></i> The product flow</h3>
          <p>See where every screen fits in a 10-phase product-development lifecycle, and
             which artifact each step produces.</p>
          <a class="btn btn-ghost btn-bordered btn-sm" href="#/playbook"><i data-lucide="map"></i> Open the playbook</a>
        </div>

        <div class="help-hub-card card">
          <h3><i data-lucide="message-circle-question"></i> Tips for getting the most out of it</h3>
          <p style="margin-bottom:8px">A few things that make the app click:</p>
          <ul class="help-hub-list">
            <li>Every screen has an <b>eye icon</b> — click it for what the page does + the science.</li>
            <li>Turn on the <b>full source sweep</b> for depth; leave it off for a fast first pass.</li>
            <li>The <b>“next step” banner</b> always points you at the best thing to do now.</li>
            <li>Opt into <b>macro/finance sources</b> only for market/finance topics.</li>
          </ul>
        </div>
      </div>

      <h3 style="margin:24px 0 10px;font-size:16px"><i data-lucide="book-open"></i> Every screen, explained</h3>
      <div id="help-explainers" class="help-hub-card card">
        <p class="muted" style="font-size:12.5px">Loading explainers…</p>
      </div>
    </div>
  `;

  // Eye icon for this very page (meta, but consistent).
  const mount = main.querySelector('#help-why-mount');
  if (mount) mount.innerHTML = whyButtonHTML('help', { label: 'About help', size: 'xs' });

  main.querySelector('#help-take-tour')?.addEventListener('click', () => replayGettingStarted());

  // Populate the explainer index from the why registry.
  const slot = main.querySelector('#help-explainers');
  try {
    const out = await api.pageExplanationsList();
    const rows = out?.explanations || [];
    if (!rows.length) {
      slot.innerHTML = `<p class="muted" style="font-size:12.5px">No explainers available yet.</p>`;
    } else {
      slot.innerHTML = `<ul class="help-hub-list">${
        rows.map((r) => { const blurb = r.simple || r.purpose || '';
          return `<li><a href="#/why/${esc(r.slug)}"><b>${esc(r.title || r.slug)}</b></a>${
            blurb ? `<span class="muted"> — ${esc(blurb)}</span>` : ''
          }</li>`; }).join('')
      }</ul>`;
    }
  } catch (e) {
    slot.innerHTML = `<p class="muted" style="font-size:12.5px">Couldn't load explainers: ${esc(e?.message || e)}</p>`;
  }

  if (window.lucide?.createIcons) { try { window.lucide.createIcons(); } catch { /* ignore */ } }
}
