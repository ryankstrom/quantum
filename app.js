/* Quantum Referee Summary — Killarney Swim Club
 * Reads Swiss Timing Quantum heat result files (.qaq) entirely in the browser
 * and builds printable, grayscale referee summaries. Nothing is uploaded or modified.
 *
 * .qaq layout (one file per heat, CRLF, ';' separated):
 *   header:  event;heat;splitCount;round;?;QuantumAQ;version
 *   rows:    one per lane in pool order (row 1 = first lane)
 *            place; code; split1 … splitN (last split = PAD time); backupA; backupB; code; reaction;
 *            an empty lane is "0;;;;;;;;;;;"
 * quantum.sch (optional): event;name;splitCount;gender;…
 * quantum.slx (optional): event;heat;round;name;…  then  ;id;lane;leg;Last,;First;club;clubName;flag
 */
(() => {
  'use strict';

  const CLUB = 'Killarney Swim Club';
  const ROUND = { P: 'Prelims', F: 'Finals', T: 'Timed Final', S: 'Semi-Finals', Q: 'Swim-off' };

  const state = {
    heats: new Map(),       // key -> heat
    events: new Map(),      // event number -> name (from .sch)
    startList: new Map(),   // "event|heat|round" and "event|heat" -> Map(lane -> entry)
    startHeats: new Map(),  // event number -> Set(heat numbers) from .slx
    files: [],              // {name, kind, ok, msg}
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    drop: $('dropZone'), input: $('fileInput'), status: $('fileStatus'), report: $('report'),
    print: $('printBtn'), clear: $('clearBtn'),
    meetName: $('meetName'), meetSession: $('meetSession'), threshold: $('threshold'), laneBase: $('laneBase'),
    optOverview: $('optOverview'), optExceptions: $('optExceptions'), optEvents: $('optEvents'),
    optSplits: $('optSplits'), optSignoff: $('optSignoff'),
  };
  const emptyStateHTML = els.report.innerHTML;

  /* ---------------- settings (per-browser convenience only) ---------------- */
  const SETTINGS = ['meetName', 'meetSession', 'threshold', 'laneBase', 'optOverview', 'optExceptions', 'optEvents', 'optSplits', 'optSignoff'];
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('ksc-quantum-settings') || '{}');
      for (const k of SETTINGS) {
        if (!(k in s)) continue;
        if (els[k].type === 'checkbox') els[k].checked = !!s[k]; else els[k].value = s[k];
      }
    } catch (_) { /* storage unavailable */ }
  }
  function saveSettings() {
    try {
      const s = {};
      for (const k of SETTINGS) s[k] = els[k].type === 'checkbox' ? els[k].checked : els[k].value;
      localStorage.setItem('ksc-quantum-settings', JSON.stringify(s));
    } catch (_) { /* ignore */ }
  }

  /* ---------------- helpers ---------------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lines = (text) => text.replace(/^﻿/, '').split(/\r\n|\n|\r/).filter((l) => l.trim() !== '');
  const int = (s) => { const n = parseInt(String(s).trim(), 10); return Number.isFinite(n) ? n : null; };

  function parseTime(s) {
    s = String(s ?? '').trim();
    if (!s) return null;
    let m = s.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
    if (m) return +m[1] * 60 + +m[2];
    m = s.match(/^\d+(?:\.\d+)?$/);
    return m ? +s : null;
  }
  function fmtTime(t) {
    if (t == null) return '';
    const cs = Math.round(t * 100);
    const min = Math.floor(cs / 6000);
    const sec = (cs % 6000) / 100;
    return min ? `${min}:${sec.toFixed(2).padStart(5, '0')}` : sec.toFixed(2);
  }
  const delta = (b, pad) => (b == null || pad == null ? null : Math.round((b - pad) * 100) / 100);
  function fmtDelta(d) {
    if (d == null) return '';
    if (d === 0) return '0.00';
    return (d > 0 ? '+' : '−') + Math.abs(d).toFixed(2);
  }
  const threshold = () => { const v = parseFloat(els.threshold.value); return Number.isFinite(v) && v >= 0 ? v : 0.3; };

  /* ---------------- parsers ---------------- */
  function parseQAQ(name, text) {
    const ls = lines(text);
    if (!ls.length) throw new Error('empty file');
    const h = ls[0].split(';');
    if (!/quantum/i.test(h[5] || '') && h.length < 5) throw new Error('not a Quantum heat file');
    const fm = name.match(/^(\d+)-(\d+)-(\d+)([A-Z])(\d+)/i);
    const event = int(h[0]) ?? (fm && int(fm[2]));
    const heat = int(h[1]) ?? (fm && int(fm[3]));
    if (event == null || heat == null) throw new Error('could not read event/heat from header');
    const splitCount = int(h[2]);
    const round = (h[3] || (fm && fm[4]) || '').trim().toUpperCase();

    const rows = ls.slice(1).map((line, idx) => {
      const f = line.split(';');
      // Drop the trailing empty field produced by the final ';'
      if (f.length && f[f.length - 1].trim() === '') f.pop();
      const place = int(f[0]);
      // Work from the end so the parser doesn't depend on split count:
      // … pad; backupA; backupB; code; reaction
      const n = f.length;
      const reaction = parseTime(f[n - 1]);
      const code2 = (f[n - 2] || '').trim();
      const backupB = parseTime(f[n - 3]);
      const backupA = parseTime(f[n - 4]);
      const pad = parseTime(f[n - 5]);
      const splits = f.slice(2, Math.max(2, n - 5)).map(parseTime);
      const code = [(f[1] || '').trim(), code2].filter(Boolean).join(' ');
      const hasData = [pad, backupA, backupB].some((t) => t != null) || !!code || (place != null && place > 0);
      return { index: idx, place, pad, backupA, backupB, reaction, splits, code, hasData };
    });

    return {
      key: `${fm ? fm[1] : '0'}|${event}|${round}|${heat}`,
      file: name, session: fm ? int(fm[1]) : null, race: fm ? int(fm[5]) : null,
      event, heat, round, splitCount, rows,
    };
  }

  function parseSCH(text) {
    let n = 0;
    for (const l of lines(text)) {
      const f = l.split(';');
      const ev = int(f[0]);
      if (ev != null && f[1]) { state.events.set(ev, f[1].trim()); n++; }
    }
    return n;
  }

  function parseSLX(text) {
    let cur = null, swimmers = 0;
    for (const l of lines(text)) {
      const f = l.split(';');
      if (f[0].trim() !== '') {
        const ev = int(f[0]), heat = int(f[1]);
        if (ev == null || heat == null) { cur = null; continue; }
        const round = (f[2] || '').trim().toUpperCase();
        cur = new Map();
        state.startList.set(`${ev}|${heat}|${round}`, cur);
        if (!state.startList.has(`${ev}|${heat}`)) state.startList.set(`${ev}|${heat}`, cur);
        if (!state.startHeats.has(ev)) state.startHeats.set(ev, new Set());
        state.startHeats.get(ev).add(heat);
        if (f[3] && !state.events.has(ev)) state.events.set(ev, f[3].trim());
        continue;
      }
      if (!cur) continue;
      const lane = int(f[2]), leg = int(f[3]) || 0;
      const last = (f[4] || '').trim().replace(/,$/, ''), first = (f[5] || '').trim();
      if (lane == null || (!last && !first && !(f[6] || '').trim())) continue;
      const club = (f[6] || '').trim(), clubName = (f[7] || '').trim();
      const flag = (f[8] || '').trim();
      const name = [first, last].filter(Boolean).join(' ');
      if (!cur.has(lane)) cur.set(lane, { lane, name: '', club, clubName, flag, legs: [] });
      const e = cur.get(lane);
      if (leg === 0) { e.name = name; e.club = club; e.clubName = clubName; e.flag = flag; }
      else { e.legs.push(name); if (!e.club) e.club = club; }
      swimmers++;
    }
    return swimmers;
  }

  /* ---------------- file intake ---------------- */
  async function readEntries(items) {
    const out = [];
    const walk = async (entry) => {
      if (!entry) return;
      if (entry.isFile) {
        out.push(await new Promise((res, rej) => entry.file(res, rej)));
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        let batch;
        do {
          batch = await new Promise((res, rej) => reader.readEntries(res, rej));
          for (const e of batch) await walk(e);
        } while (batch.length);
      }
    };
    for (const it of items) await walk(it.webkitGetAsEntry ? it.webkitGetAsEntry() : null);
    return out;
  }

  async function addFiles(fileList) {
    const files = [...fileList].sort((a, b) => a.name.localeCompare(b.name));
    // Read reference files first so heats can use them.
    const rank = (f) => (/\.sch$/i.test(f.name) ? 0 : /\.slx$/i.test(f.name) ? 1 : 2);
    files.sort((a, b) => rank(a) - rank(b));
    for (const file of files) {
      const name = file.name;
      if (name.startsWith('.')) continue;
      try {
        const text = await file.text();
        if (/\.sch$/i.test(name)) {
          state.files.push({ name, ok: true, msg: `${parseSCH(text)} event names` });
        } else if (/\.slx$/i.test(name)) {
          state.files.push({ name, ok: true, msg: `${parseSLX(text)} start-list entries` });
        } else if (/\.qaq$/i.test(name)) {
          const heat = parseQAQ(name, text);
          const replaced = state.heats.has(heat.key);
          state.heats.set(heat.key, heat);
          state.files.push({ name, ok: true, msg: `Event ${heat.event} · Heat ${heat.heat}${replaced ? ' (replaced earlier copy)' : ''}` });
        } else {
          state.files.push({ name, ok: false, msg: 'skipped — not .qaq / .sch / .slx' });
        }
      } catch (err) {
        state.files.push({ name, ok: false, msg: `could not read — ${err.message}` });
      }
    }
    render();
  }

  /* ---------------- analysis ---------------- */
  function startEntries(heat) {
    return state.startList.get(`${heat.event}|${heat.heat}|${heat.round}`) || state.startList.get(`${heat.event}|${heat.heat}`) || null;
  }

  function laneBase() {
    const v = els.laneBase.value;
    if (v === '0' || v === '1') return +v;
    // Auto: pick the numbering where result rows line up best with the start list.
    let score0 = 0, score1 = 0;
    for (const heat of state.heats.values()) {
      const sl = startEntries(heat);
      if (!sl) continue;
      for (const r of heat.rows) {
        if (!r.hasData) continue;
        if (sl.has(r.index)) score0++;
        if (sl.has(r.index + 1)) score1++;
      }
    }
    return score0 > score1 ? 0 : 1;
  }

  function analyse() {
    const thr = threshold() - 1e-9;
    const base = laneBase();
    const events = new Map();
    for (const heat of state.heats.values()) {
      const sl = startEntries(heat);
      const rows = [];
      const seen = new Set();
      for (const r of heat.rows) {
        const lane = r.index + base;
        const entry = sl ? sl.get(lane) : null;
        if (!r.hasData) continue;
        seen.add(lane);
        const dA = delta(r.backupA, r.pad), dB = delta(r.backupB, r.pad);
        const backups = [r.backupA, r.backupB].filter((t) => t != null).length;
        const flags = [];
        if (r.pad == null) flags.push('NO PAD');
        if (backups === 0) flags.push('NO BACKUP');
        else if (backups === 1) flags.push('1 BACKUP');
        if ((dA != null && Math.abs(dA) >= thr) || (dB != null && Math.abs(dB) >= thr)) flags.push('PAD vs BACKUP');
        if (r.backupA != null && r.backupB != null && Math.abs(r.backupA - r.backupB) >= thr) flags.push('BACKUPS DIFFER');
        const notes = [];
        if (r.code) notes.push(r.code);
        if (sl && !entry) notes.push('Not on start list');
        const maxAbs = Math.max(dA == null ? 0 : Math.abs(dA), dB == null ? 0 : Math.abs(dB));
        rows.push({ ...r, lane, entry, dA, dB, maxAbs, flags, notes });
      }
      if (sl) {
        for (const [lane, entry] of sl) {
          if (seen.has(lane)) continue;
          rows.push({ lane, entry, empty: true, flags: [], notes: [entry.flag === 'X' ? 'Scratched on start list · no result' : 'No result recorded'], splits: [] });
        }
      }
      rows.sort((a, b) => a.lane - b.lane);
      const evKey = `${heat.session ?? 0}|${heat.event}|${heat.round}`;
      if (!events.has(evKey)) {
        events.set(evKey, { key: evKey, event: heat.event, round: heat.round, session: heat.session, heats: [] });
      }
      events.get(evKey).heats.push({ ...heat, rows, hasStartList: !!sl });
    }
    const list = [...events.values()].sort((a, b) => (a.session ?? 0) - (b.session ?? 0) || a.event - b.event || a.round.localeCompare(b.round));
    for (const ev of list) {
      ev.heats.sort((a, b) => a.heat - b.heat);
      ev.name = state.events.get(ev.event) || '';
      const swum = ev.heats.flatMap((h) => h.rows.filter((r) => !r.empty));
      ev.swimmers = swum.length;
      ev.flagged = swum.filter((r) => r.flags.length).length;
      ev.maxAbs = swum.reduce((m, r) => Math.max(m, r.maxAbs || 0), 0);
      const planned = state.startHeats.get(ev.event);
      const loaded = new Set(ev.heats.map((h) => h.heat));
      ev.missing = planned ? [...planned].filter((h) => !loaded.has(h)).sort((a, b) => a - b) : [];
    }
    return { events: list, base };
  }

  /* ---------------- rendering ---------------- */
  const eventTitle = (ev) => `Event ${ev.event}${ev.name ? ` · ${ev.name}` : ''}`;
  const roundLabel = (r) => ROUND[r] || (r ? `Round ${r}` : '');

  function pageHead(title, sub) {
    const meet = els.meetName.value.trim();
    const session = els.meetSession.value.trim();
    const printed = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    return `<div class="page-head">
      <div><div class="club">${esc(CLUB)}</div><h1>${esc(title)}</h1>${sub ? `<div>${esc(sub)}</div>` : ''}</div>
      <div class="meta">${meet ? `<div><strong>${esc(meet)}</strong></div>` : ''}${session ? `<div>${esc(session)}</div>` : ''}<div>Printed ${esc(printed)}</div></div>
    </div>`;
  }

  function swimmerCell(r) {
    if (!r.entry) return '<td>—</td>';
    const e = r.entry;
    const who = e.name || (e.legs.length ? e.club : '');
    const legs = e.legs.length ? `<div class="club">${esc(e.legs.join(' · '))}</div>` : '';
    return `<td>${esc(who)} <span class="club">${esc(e.club)}</span>${legs}</td>`;
  }

  function deltaCell(d) {
    const big = d != null && Math.abs(d) >= threshold() - 1e-9;
    return `<td class="num${big ? ' big' : ''}">${fmtDelta(d)}</td>`;
  }

  function heatTable(ev, heat, { showSplits, showNames, showEvent = false }) {
    const head = `<tr>
      ${showEvent ? '<th>Event / Heat</th>' : ''}
      <th class="c">Lane</th><th class="c">Pl</th>
      ${showNames ? '<th>Swimmer</th>' : ''}
      <th class="num">Pad (official)</th><th class="num">Backup A</th><th class="num">Δ A</th>
      <th class="num">Backup B</th><th class="num">Δ B</th><th>Review</th>
    </tr>`;
    const body = heat.rows.map((r) => {
      const evCell = showEvent ? `<td>E${ev.event} H${heat.heat}</td>` : '';
      if (r.empty) {
        return `<tr class="empty">${evCell}<td class="c">${r.lane}</td><td class="c"></td>${showNames ? swimmerCell(r) : ''}
          <td colspan="5">—</td><td>${esc(r.notes.join('; '))}</td></tr>`;
      }
      const split = showSplits && r.splits.length > 1
        ? `<div class="splits">${r.splits.slice(0, -1).map(fmtTime).join(' · ')}</div>` : '';
      const review = [...r.flags, ...r.notes].join('; ');
      return `<tr class="${r.flags.length ? 'flag' : ''}">${evCell}
        <td class="c">${r.lane}</td><td class="c">${r.place ? r.place : ''}</td>
        ${showNames ? swimmerCell(r) : ''}
        <td class="num official">${r.pad == null ? '—' : fmtTime(r.pad)}${split}</td>
        <td class="num">${fmtTime(r.backupA)}</td>${deltaCell(r.dA)}
        <td class="num">${fmtTime(r.backupB)}</td>${deltaCell(r.dB)}
        <td class="flagcell">${r.flags.length ? '▲ ' : ''}${esc(review)}</td>
      </tr>`;
    }).join('');
    return `<table class="rs"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  function legend() {
    return `<p class="legend">Δ = backup − pad, in seconds (+ means the backup is slower than the pad). ▲ shaded rows need the referee's attention:
      a backup differs from the pad by ≥ ${threshold().toFixed(2)} s, the two backups disagree by that much, or a time is missing.</p>`;
  }

  function overviewPage(data) {
    const all = data.events.flatMap((e) => e.heats.flatMap((h) => h.rows.filter((r) => !r.empty)));
    const flagged = all.filter((r) => r.flags.length).length;
    const heats = data.events.reduce((n, e) => n + e.heats.length, 0);
    const rows = data.events.map((ev) => `<tr class="${ev.flagged ? 'flag' : ''}">
      <td>${esc(eventTitle(ev))}</td><td>${esc(roundLabel(ev.round))}</td>
      <td>${ev.heats.map((h) => h.heat).join(', ')}</td>
      <td>${ev.missing.length ? ev.missing.join(', ') : (state.startHeats.has(ev.event) ? 'none' : '—')}</td>
      <td class="num">${ev.swimmers}</td><td class="num">${ev.flagged}</td>
      <td class="num">${ev.maxAbs.toFixed(2)}</td></tr>`).join('');
    return `<section class="page">${pageHead('Meet Overview', 'Referee summary of Quantum heat results')}
      <div class="stats">
        <div class="stat"><b>${data.events.length}</b><span>Events</span></div>
        <div class="stat"><b>${heats}</b><span>Heats</span></div>
        <div class="stat"><b>${all.length}</b><span>Swims</span></div>
        <div class="stat"><b>${flagged}</b><span>Flagged lanes</span></div>
      </div>
      <table class="rs"><thead><tr><th>Event</th><th>Round</th><th>Heats loaded</th><th>Heats not loaded</th>
        <th class="num">Swims</th><th class="num">Flagged</th><th class="num">Largest |Δ|</th></tr></thead>
        <tbody>${rows}</tbody></table>
      <p class="legend" style="margin-top:12px">Review threshold ${threshold().toFixed(2)} s · lane numbering: first row = lane ${data.base}.
      ${state.startHeats.size ? '' : 'Add quantum.slx to list heats that have not been loaded and to show swimmer names.'}</p>
    </section>`;
  }

  function exceptionsPage(data, showNames) {
    const tables = data.events.map((ev) => {
      const flaggedHeats = ev.heats
        .map((h) => ({ ...h, rows: h.rows.filter((r) => r.flags.length) }))
        .filter((h) => h.rows.length);
      if (!flaggedHeats.length) return '';
      return `<div class="heat"><h3>${esc(eventTitle(ev))} <small>${esc(roundLabel(ev.round))}</small></h3>
        ${flaggedHeats.map((h) => `<div class="heat"><h3>Heat ${h.heat}<small>${esc(h.file)}</small></h3>${heatTable(ev, h, { showSplits: false, showNames })}</div>`).join('')}
      </div>`;
    }).join('');
    return `<section class="page">${pageHead('Exceptions — Lanes to Review', `Only lanes flagged at ≥ ${threshold().toFixed(2)} s or with a missing time`)}
      ${legend()}${tables || '<p class="none">No lanes flagged. Every swim has a pad time and two backups within the threshold.</p>'}
    </section>`;
  }

  function eventPage(ev, opts) {
    const heats = ev.heats.map((h) => `<div class="heat">
      <h3>Heat ${h.heat}<small>${h.rows.filter((r) => r.flags.length).length ? `${h.rows.filter((r) => r.flags.length).length} flagged · ` : ''}${esc(h.file)}</small></h3>
      ${heatTable(ev, h, opts)}</div>`).join('');
    const missing = ev.missing.length ? `<p class="legend"><strong>Heats not loaded:</strong> ${ev.missing.join(', ')}</p>` : '';
    const signoff = opts.signoff
      ? '<div class="signoff"><span>Referee signature</span><span>Name</span><span>Date / time</span></div>' : '';
    return `<section class="page">${pageHead(eventTitle(ev), `${roundLabel(ev.round)} · Referee Summary`)}
      <div class="stats">
        <div class="stat"><b>${ev.heats.length}</b><span>Heats</span></div>
        <div class="stat"><b>${ev.swimmers}</b><span>Swims</span></div>
        <div class="stat"><b>${ev.flagged}</b><span>Flagged</span></div>
        <div class="stat"><b>${ev.maxAbs.toFixed(2)}</b><span>Largest |Δ| (s)</span></div>
      </div>
      ${legend()}${missing}${heats}${signoff}
    </section>`;
  }

  function renderStatus() {
    els.status.innerHTML = state.files.slice(-40).map((f) =>
      `<div class="${f.ok ? 'ok' : 'warn'}">${f.ok ? '✓' : '!'} <strong>${esc(f.name)}</strong> — ${esc(f.msg)}</div>`).join('')
      + (state.files.length > 40 ? `<div class="ok">…and ${state.files.length - 40} earlier files</div>` : '');
  }

  function render() {
    renderStatus();
    const has = state.heats.size > 0;
    els.print.disabled = !has;
    els.clear.disabled = !state.files.length;
    if (!has) { els.report.innerHTML = emptyStateHTML; return; }
    const data = analyse();
    const showNames = state.startList.size > 0;
    const opts = { showSplits: els.optSplits.checked, showNames, signoff: els.optSignoff.checked };
    let html = '';
    if (els.optOverview.checked) html += overviewPage(data);
    if (els.optExceptions.checked) html += exceptionsPage(data, showNames);
    if (els.optEvents.checked) html += data.events.map((ev) => eventPage(ev, opts)).join('');
    els.report.innerHTML = html || '<div class="empty-state no-print"><h1>No reports selected</h1><p>Tick at least one report in step 3.</p></div>';
  }

  /* ---------------- wiring ---------------- */
  els.drop.addEventListener('dragover', (e) => { e.preventDefault(); els.drop.classList.add('over'); });
  els.drop.addEventListener('dragleave', () => els.drop.classList.remove('over'));
  // Accept drops anywhere on the page (and stop the browser opening the file).
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    els.drop.classList.remove('over');
    const items = [...(e.dataTransfer.items || [])].filter((i) => i.kind === 'file');
    const files = items.length && items[0].webkitGetAsEntry ? await readEntries(items) : e.dataTransfer.files;
    addFiles(files);
  });
  els.drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.input.click(); } });
  els.input.addEventListener('change', () => { addFiles(els.input.files); els.input.value = ''; });

  els.print.addEventListener('click', () => window.print());
  els.clear.addEventListener('click', () => {
    state.heats.clear(); state.events.clear(); state.startList.clear(); state.startHeats.clear(); state.files = [];
    render();
  });
  for (const k of SETTINGS) {
    els[k].addEventListener('input', () => { saveSettings(); render(); });
    els[k].addEventListener('change', () => { saveSettings(); render(); });
  }

  loadSettings();
  render();
})();
