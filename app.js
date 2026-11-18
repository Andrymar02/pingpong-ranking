'use strict';
/* =========================================================
   Ping Pong Ranking — PWA con "database" JSON su GitHub
   ========================================================= */

const DEFAULT_SETTINGS = {
  startRating: 1500,      // punteggio iniziale
  kFactor: 32,            // K normale
  provisionalK: 48,       // K per le prime partite (classifica si assesta più in fretta)
  provisionalMatches: 10, // quante partite sono "provvisorie"
  windFactor: 0.5,        // moltiplicatore punti con vento (0.5 = metà punti)
  marginWeight: 0.5       // peso dello scarto di punti (0 = conta solo vincere/perdere)
};
const emptyData = () => ({ version: 1, settings: { ...DEFAULT_SETTINGS }, players: [], matches: [] });

const MODES = { singolo: 'Singolo', doppio: 'Doppio' };
const CFG_KEY = 'pp_config', LOCAL_KEY = 'pp_local_data', CACHE_KEY = 'pp_cache';

/* ---------------- utility ---------------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmtDate = iso => { try { return new Date(iso + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); } catch { return iso; } };
const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(Math.round(n));
function b64encode(str) { const bytes = new TextEncoder().encode(str); let bin = ''; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin); }
function b64decode(b64) { const bin = atob(b64.replace(/\s/g, '')); return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))); }

function normalize(d) {
  const out = emptyData();
  if (!d || typeof d !== 'object') return out;
  out.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
  out.players = Array.isArray(d.players) ? d.players : [];
  out.matches = Array.isArray(d.matches) ? d.matches : [];
  return out;
}

/* =========================================================
   CALCOLO ELO
   - Rating separati per singolo e doppio
   - Doppio: rating squadra = media dei due giocatori, ogni giocatore riceve la stessa variazione
   - Scarto punti: moltiplicatore 1 + marginWeight × (diff punti / punti totali)
   - Vento: moltiplicatore windFactor sui punti guadagnati E persi
   - Tutto viene ricalcolato dallo storico → cancellare/modificare una partita è sempre coerente
   ========================================================= */
function tally(sets) {
  let setsA = 0, setsB = 0, ptsA = 0, ptsB = 0;
  for (const [a, b] of sets) { ptsA += a; ptsB += b; if (a > b) setsA++; else if (b > a) setsB++; }
  return { setsA, setsB, ptsA, ptsB };
}

function sortedMatches(matches) {
  return [...matches].sort((x, y) => (x.date || '').localeCompare(y.date || '') || (x.createdAt || 0) - (y.createdAt || 0));
}

function computeRatings(data) {
  const s = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  const res = { singolo: {}, doppio: {}, deltas: {} };
  const ensure = (mode, id) => res[mode][id] ||= {
    rating: s.startRating, played: 0, wins: 0, losses: 0, setsW: 0, setsL: 0,
    ptsFor: 0, ptsAgainst: 0, form: [], history: [s.startRating], lastDelta: 0, streak: 0
  };

  for (const m of sortedMatches(data.matches)) {
    const mode = m.type === 'doppio' ? 'doppio' : 'singolo';
    const A = m.teamA.map(id => ensure(mode, id));
    const B = m.teamB.map(id => ensure(mode, id));
    const rA = A.reduce((t, p) => t + p.rating, 0) / A.length;
    const rB = B.reduce((t, p) => t + p.rating, 0) / B.length;
    const expA = 1 / (1 + Math.pow(10, (rB - rA) / 400));
    const t = tally(m.sets);
    const scoreA = t.setsA > t.setsB ? 1 : 0;
    const totPts = t.ptsA + t.ptsB;
    const mov = 1 + s.marginWeight * (totPts > 0 ? Math.abs(t.ptsA - t.ptsB) / totPts : 0);
    const wind = m.wind ? s.windFactor : 1;

    const d = res.deltas[m.id] = {};
    const apply = (team, ids, score, exp, sw, sl, pf, pa) => team.forEach((p, i) => {
      const K = p.played < s.provisionalMatches ? s.provisionalK : s.kFactor;
      const delta = K * mov * wind * (score - exp);
      p.rating += delta; p.played++; p.lastDelta = delta;
      if (score) { p.wins++; p.streak = p.streak > 0 ? p.streak + 1 : 1; } else { p.losses++; p.streak = p.streak < 0 ? p.streak - 1 : -1; }
      p.setsW += sw; p.setsL += sl; p.ptsFor += pf; p.ptsAgainst += pa;
      p.form.push(score ? 'w' : 'l'); if (p.form.length > 5) p.form.shift();
      p.history.push(p.rating);
      d[ids[i]] = delta;
    });
    apply(A, m.teamA, scoreA, expA, t.setsA, t.setsB, t.ptsA, t.ptsB);
    apply(B, m.teamB, 1 - scoreA, 1 - expA, t.setsB, t.setsA, t.ptsB, t.ptsA);
  }
  return res;
}

if (typeof module !== 'undefined') module.exports = { computeRatings, tally, DEFAULT_SETTINGS, emptyData };

/* =========================================================
   STORAGE: GitHub Contents API oppure locale
   ========================================================= */
function getConfig() { try { return JSON.parse(localStorage.getItem(CFG_KEY)) || null; } catch { return null; } }
function setConfig(c) { if (c) localStorage.setItem(CFG_KEY, JSON.stringify(c)); else localStorage.removeItem(CFG_KEY); }
function isRemote() { const c = getConfig(); return !!(c && c.owner && c.repo); }
function apiUrl(c) {
  const path = (c.path || 'data/data.json').replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
  return `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${path}`;
}
function ghHeaders(c) {
  const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (c.token) h.Authorization = `Bearer ${c.token}`;
  return h;
}
async function ghError(res) {
  let msg = `${res.status}`;
  try { const j = await res.json(); if (j.message) msg += ` – ${j.message}`; } catch { }
  if (res.status === 401) msg += ' (token non valido o scaduto)';
  if (res.status === 403) msg += ' (permessi insufficienti o limite di richieste)';
  if (res.status === 404) msg += ' (repo non trovato o privato senza token)';
  return msg;
}

const store = {
  async load() {
    if (!isRemote()) {
      let d = null; try { d = JSON.parse(localStorage.getItem(LOCAL_KEY)); } catch { }
      return { data: normalize(d), sha: null };
    }
    const c = getConfig();
    const res = await fetch(`${apiUrl(c)}?ref=${encodeURIComponent(c.branch || 'main')}`, { headers: ghHeaders(c), cache: 'no-store' });
    if (res.status === 404) {
      // file non ancora creato: va bene se il repo esiste
      return { data: emptyData(), sha: null, missing: true };
    }
    if (!res.ok) throw new Error(await ghError(res));
    const j = await res.json();
    return { data: normalize(JSON.parse(b64decode(j.content))), sha: j.sha };
  },

  // Rilegge sempre l'ultima versione, applica la modifica e salva: così due colleghi
  // che salvano insieme non si sovrascrivono (in caso di conflitto riprova).
  async commit(mutator, message) {
    if (!isRemote()) {
      const { data } = await this.load();
      mutator(data);
      localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
      return { data, sha: null };
    }
    const c = getConfig();
    if (!c.token) throw new Error('Per salvare serve un token GitHub (vedi Impostazioni).');
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data, sha } = await this.load();
      mutator(data);
      const body = { message: `🏓 ${message}`, content: b64encode(JSON.stringify(data, null, 2) + '\n'), branch: c.branch || 'main' };
      if (sha) body.sha = sha;
      const res = await fetch(apiUrl(c), { method: 'PUT', headers: { ...ghHeaders(c), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) { const j = await res.json(); return { data, sha: j.content.sha }; }
      if (res.status === 409 || (res.status === 422 && attempt < 3)) { await sleep(700 * (attempt + 1)); continue; }
      throw new Error(await ghError(res));
    }
    throw new Error('Conflitto di salvataggio, riprova tra qualche secondo.');
  }
};

/* =========================================================
   UI
   ========================================================= */
if (typeof document !== 'undefined') {

const state = { data: emptyData(), tab: 'ranking', mode: 'singolo', busy: false, ratings: null };
const $ = s => document.querySelector(s);
const view = $('#view'), modal = $('#modal'), modalBody = $('#modalBody');

const settings = () => ({ ...DEFAULT_SETTINGS, ...state.data.settings });
const player = id => state.data.players.find(p => p.id === id);
const pname = id => player(id)?.name ?? '??';
const activePlayers = () => state.data.players.filter(p => !p.archived).sort((a, b) => a.name.localeCompare(b.name, 'it'));
const ratings = () => state.ratings ||= computeRatings(state.data);

function setData(d) { state.data = d; state.ratings = null; try { localStorage.setItem(CACHE_KEY, JSON.stringify(d)); } catch { } }

let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.className = 'toast', err ? 4500 : 2200);
}
function banner(html, err = false) {
  const b = $('#banner');
  if (!html) { b.classList.add('hidden'); return; }
  b.innerHTML = html; b.className = 'banner' + (err ? ' err' : '');
}
function setBusy(v) { state.busy = v; $('#refreshBtn').classList.toggle('spin', v); document.querySelectorAll('[data-busy]').forEach(b => b.disabled = v); }

async function refresh(silent = false) {
  setBusy(true);
  try {
    const r = await store.load();
    setData(r.data);
    if (!isRemote()) banner('📱 <b>Modalità locale</b>: i dati restano solo su questo dispositivo. Collega GitHub in <a href="#" data-goto="settings" style="color:inherit">Impostazioni</a> per condividerli.');
    else if (r.missing) banner('Il file dati non esiste ancora nel repo: verrà creato al primo salvataggio.');
    else banner('');
    if (!silent) toast('Dati aggiornati');
  } catch (e) {
    let cached = null; try { cached = JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { }
    if (cached) setData(normalize(cached));
    banner(`⚠️ Impossibile leggere da GitHub: ${esc(e.message)}${cached ? '<br>Mostro gli ultimi dati salvati sul telefono.' : ''}`, true);
  } finally { setBusy(false); render(); }
}

async function mutate(mutator, message, okMsg = 'Salvato ✓') {
  if (state.busy) return false;
  setBusy(true);
  try {
    const r = await store.commit(mutator, message);
    setData(r.data); render(); toast(okMsg); return true;
  } catch (e) { toast('Errore: ' + e.message, true); return false; }
  finally { setBusy(false); }
}

/* ---------- navigazione ---------- */
function go(tab) {
  state.tab = tab;
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  render(); window.scrollTo(0, 0);
}
function render() {
  ({ ranking: renderRanking, matches: renderMatches, players: renderPlayers, settings: renderSettings })[state.tab]();
  $('#fab').classList.toggle('hidden', state.tab === 'settings');
}
const modeSwitch = () => `<div class="seg">${Object.entries(MODES).map(([k, v]) => `<button data-mode="${k}" class="${state.mode === k ? 'on' : ''}">${v}</button>`).join('')}</div>`;

/* ---------- CLASSIFICA ---------- */
function renderRanking() {
  const s = settings();
  const rows = Object.entries(ratings()[state.mode])
    .map(([id, st]) => ({ id, ...st, p: player(id) }))
    .filter(x => x.p && !x.p.archived)
    .sort((a, b) => b.rating - a.rating);
  const medals = ['🥇', '🥈', '🥉'];
  view.innerHTML = modeSwitch() + (rows.length ? rows.map((r, i) => `
    <div class="card rank-item" data-player="${r.id}">
      <div class="rank-pos ${i < 3 ? 'medal' : ''}">${i < 3 ? medals[i] : i + 1}</div>
      <div class="grow">
        <div class="rank-name">${esc(r.p.name)}${r.played < s.provisionalMatches ? '<span class="badge" title="Classifica provvisoria">P</span>' : ''}</div>
        <div class="muted small">${r.wins}V – ${r.losses}S · ${Math.round(100 * r.wins / r.played)}%
          <span class="form">${r.form.map(f => `<i class="${f}"></i>`).join('')}</span></div>
      </div>
      <div class="right">
        <div class="rank-elo">${Math.round(r.rating)}</div>
        <div class="delta ${r.lastDelta >= 0 ? 'up' : 'down'}">${r.lastDelta >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(r.lastDelta))}</div>
      </div>
    </div>`).join('') + `<p class="help">P = provvisorio (meno di ${s.provisionalMatches} partite di ${MODES[state.mode].toLowerCase()}). Tocca un giocatore per i dettagli.</p>`
    : `<div class="empty"><b>🏓</b>Nessuna partita di ${MODES[state.mode].toLowerCase()} ancora.<br>${state.data.players.length < 2 ? 'Aggiungi prima i giocatori nella scheda 👥' : 'Premi <b>+</b> per registrare la prima!'}</div>`);
}

/* ---------- PARTITE ---------- */
function teamLabel(ids) { return ids.map(id => esc(pname(id))).join(' & '); }
function matchCard(m) {
  const t = tally(m.sets), aWin = t.setsA > t.setsB, d = ratings().deltas[m.id] || {};
  const dl = ids => ids.map(id => `<span class="d delta ${d[id] >= 0 ? 'up' : 'down'}">${ids.length > 1 ? esc(pname(id).split(' ')[0]) + ' ' : ''}${signed(d[id] || 0)}</span>`).join('');
  return `<div class="card">
    <div class="match-meta"><span class="tag">${MODES[m.type]}</span>${m.wind ? '<span class="tag wind">💨 Vento</span>' : ''}
      <span class="grow"></span><button class="btn ghost sm" data-del-match="${m.id}" aria-label="Elimina">🗑</button></div>
    <div class="match-teams">
      <div class="team ${aWin ? 'win' : 'lose'}">${aWin ? '🏆 ' : ''}${teamLabel(m.teamA)}${dl(m.teamA)}</div>
      <div class="score">${t.setsA}–${t.setsB}</div>
      <div class="team right ${!aWin ? 'win' : 'lose'}">${!aWin ? '🏆 ' : ''}${teamLabel(m.teamB)}${dl(m.teamB)}</div>
    </div>
    <div class="sets">${m.sets.map(([a, b]) => `${a}-${b}`).join(' · ')}</div>
  </div>`;
}
function renderMatches() {
  const list = sortedMatches(state.data.matches).reverse();
  if (!list.length) { view.innerHTML = `<div class="empty"><b>📋</b>Ancora nessuna partita registrata.</div>`; return; }
  let html = '', last = null;
  for (const m of list) {
    if (m.date !== last) { html += `<h2>${fmtDate(m.date)}</h2>`; last = m.date; }
    html += matchCard(m);
  }
  view.innerHTML = html;
}

/* ---------- GIOCATORI ---------- */
function renderPlayers() {
  const r = ratings();
  const all = [...state.data.players].sort((a, b) => (a.archived - b.archived) || a.name.localeCompare(b.name, 'it'));
  view.innerHTML = `
    <div class="card"><form id="addPlayer" class="row">
      <input type="text" name="name" placeholder="Nome nuovo giocatore" maxlength="40" required class="grow" autocomplete="off">
      <button class="btn" data-busy>Aggiungi</button></form></div>
    ${all.length ? all.map(p => `
      <div class="card row" data-player="${p.id}" style="${p.archived ? 'opacity:.5' : ''}">
        <div class="grow"><b>${esc(p.name)}</b>${p.archived ? '<span class="badge">archiviato</span>' : ''}
          <div class="muted small">Singolo: ${r.singolo[p.id] ? Math.round(r.singolo[p.id].rating) : '—'} · Doppio: ${r.doppio[p.id] ? Math.round(r.doppio[p.id].rating) : '—'}</div></div>
        <span class="muted">›</span>
      </div>`).join('') : '<div class="empty"><b>👥</b>Aggiungi i colleghi che giocano!</div>'}`;
  $('#addPlayer').onsubmit = async e => {
    e.preventDefault();
    const name = e.target.name.value.trim().replace(/\s+/g, ' ');
    if (!name) return;
    if (state.data.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return toast('Esiste già un giocatore con questo nome', true);
    const id = uid();
    await mutate(d => { if (!d.players.some(p => p.id === id)) d.players.push({ id, name, createdAt: Date.now() }); }, `Nuovo giocatore: ${name}`, `${name} aggiunto ✓`);
  };
}

function sparkline(hist) {
  if (hist.length < 2) return '<p class="muted small">Grafico disponibile dopo la prima partita.</p>';
  const w = 300, h = 70, pad = 4, min = Math.min(...hist), max = Math.max(...hist), span = max - min || 1;
  const pts = hist.map((v, i) => `${(pad + i * (w - 2 * pad) / (hist.length - 1)).toFixed(1)},${(h - pad - (v - min) / span * (h - 2 * pad)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="#f97316" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>
    <div class="row muted small"><span class="grow">min ${Math.round(min)}</span><span>max ${Math.round(max)}</span></div>`;
}

function openPlayer(id) {
  const p = player(id); if (!p) return;
  const r = ratings();
  const block = mode => {
    const st = r[mode][id];
    if (!st) return `<h2>${MODES[mode]}</h2><p class="muted small">Nessuna partita.</p>`;
    const pos = Object.entries(r[mode]).filter(([pid]) => !player(pid)?.archived).sort((a, b) => b[1].rating - a[1].rating).findIndex(([pid]) => pid === id) + 1;
    return `<h2>${MODES[mode]} · ${pos}° posto</h2>
      <div class="stats-grid">
        <div class="stat"><b>${Math.round(st.rating)}</b><span>ELO</span></div>
        <div class="stat"><b>${st.wins}–${st.losses}</b><span>V–S</span></div>
        <div class="stat"><b>${Math.round(100 * st.wins / st.played)}%</b><span>vittorie</span></div>
        <div class="stat"><b>${st.setsW}–${st.setsL}</b><span>set</span></div>
        <div class="stat"><b>${st.ptsFor - st.ptsAgainst > 0 ? '+' : ''}${st.ptsFor - st.ptsAgainst}</b><span>diff. punti</span></div>
        <div class="stat"><b>${st.streak > 0 ? '🔥' + st.streak : st.streak < 0 ? '❄️' + -st.streak : '–'}</b><span>serie</span></div>
      </div>${sparkline(st.history)}`;
  };
  modalBody.innerHTML = `
    <div class="modal-head"><h2>${esc(p.name)}</h2><button class="icon-btn" data-close>✕</button></div>
    ${block('singolo')}${block('doppio')}
    <h2>Gestione</h2>
    <form id="renameForm" class="row"><input type="text" name="name" value="${esc(p.name)}" maxlength="40" class="grow" required>
      <button class="btn ghost" data-busy>Rinomina</button></form>
    <div class="btns"><button class="btn ${p.archived ? '' : 'danger'}" id="archiveBtn" data-busy>${p.archived ? 'Riattiva giocatore' : 'Archivia (nascondi dalla classifica)'}</button></div>`;
  modal.showModal();
  $('#renameForm').onsubmit = async e => {
    e.preventDefault();
    const name = e.target.name.value.trim().replace(/\s+/g, ' ');
    if (!name || name === p.name) return;
    if (await mutate(d => { const x = d.players.find(q => q.id === id); if (x) x.name = name; }, `Rinomina ${p.name} → ${name}`)) modal.close();
  };
  $('#archiveBtn').onclick = async () => {
    const v = !p.archived;
    if (await mutate(d => { const x = d.players.find(q => q.id === id); if (x) x.archived = v; }, `${v ? 'Archivia' : 'Riattiva'} ${p.name}`)) modal.close();
  };
}

/* ---------- NUOVA PARTITA ---------- */
function openNewMatch() {
  const players = activePlayers();
  if (players.length < 2) { toast('Servono almeno 2 giocatori: aggiungili in 👥', true); go('players'); return; }
  const f = { type: state.mode, teamA: ['', ''], teamB: ['', ''], sets: [['', '']], wind: false, date: todayISO() };
  const opts = sel => `<option value="">— scegli —</option>` + players.map(p => `<option value="${p.id}" ${sel === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const n = () => f.type === 'doppio' ? 2 : 1;

  const draw = () => {
    modalBody.innerHTML = `
      <div class="modal-head"><h2>Nuova partita</h2><button class="icon-btn" data-close>✕</button></div>
      <div class="seg" style="margin-top:10px">${Object.entries(MODES).map(([k, v]) => `<button type="button" data-type="${k}" class="${f.type === k ? 'on' : ''}">${v}</button>`).join('')}</div>
      <div class="teams-grid">
        ${['A', 'B'].map(T => `<div class="team-box"><h3>${T === 'A' ? 'Squadra A' : 'Squadra B'}</h3>
          ${Array.from({ length: n() }, (_, i) => `<select data-team="${T}" data-i="${i}">${opts(f['team' + T][i])}</select>`).join('')}</div>`).join('')}
      </div>
      <label>Punteggio dei set (A – B)</label>
      <div id="setsBox">${f.sets.map(([a, b], i) => `
        <div class="set-row"><span class="muted small">Set ${i + 1}</span>
          <input type="number" inputmode="numeric" min="0" max="99" value="${a}" data-set="${i}" data-side="0" placeholder="A">
          <span class="muted" style="text-align:center">–</span>
          <input type="number" inputmode="numeric" min="0" max="99" value="${b}" data-set="${i}" data-side="1" placeholder="B">
          ${f.sets.length > 1 ? `<button type="button" class="x" data-rmset="${i}">✕</button>` : '<span></span>'}
        </div>`).join('')}</div>
      <div class="btns" style="margin-top:8px"><button type="button" class="btn ghost sm" id="addSet">+ Aggiungi set</button></div>
      <label class="wind-toggle"><input type="checkbox" id="wind" ${f.wind ? 'checked' : ''}>
        <span><b>💨 C'era vento</b><br><span class="small">Punti vinti e persi × ${settings().windFactor}</span></span></label>
      <label>Data</label><input type="date" id="mdate" value="${f.date}" max="${todayISO()}">
      <div id="preview" class="preview hidden"></div>
      <div class="btns"><button class="btn block" id="saveMatch" data-busy>Salva partita</button></div>`;
    updatePreview();
  };

  const validate = () => {
    const A = f.teamA.slice(0, n()), B = f.teamB.slice(0, n()), all = [...A, ...B];
    if (all.some(x => !x)) return { err: 'Seleziona tutti i giocatori' };
    if (new Set(all).size !== all.length) return { err: 'Un giocatore non può comparire due volte' };
    const sets = [];
    for (const [a, b] of f.sets) {
      if (a === '' && b === '') continue;
      const x = parseInt(a, 10), y = parseInt(b, 10);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return { err: 'Punteggi dei set non validi' };
      if (x === y) return { err: 'Un set non può finire in parità' };
      sets.push([x, y]);
    }
    if (!sets.length) return { err: 'Inserisci almeno un set' };
    const t = tally(sets);
    if (t.setsA === t.setsB) return { err: 'Set in parità: serve un vincitore' };
    return { match: { id: uid(), type: f.type, teamA: A, teamB: B, sets, wind: f.wind, date: f.date || todayISO(), createdAt: Date.now() } };
  };

  function updatePreview() {
    const box = $('#preview'); if (!box) return;
    const v = validate();
    if (v.err) { box.classList.add('hidden'); return; }
    const sim = computeRatings({ ...state.data, matches: [...state.data.matches, v.match] });
    const d = sim.deltas[v.match.id];
    const cur = ratings()[f.type];
    box.classList.remove('hidden');
    box.innerHTML = `<b>Anteprima variazione ELO</b>${v.match.wind ? ' <span class="tag wind">💨 ridotta</span>' : ''}` +
      [...v.match.teamA, ...v.match.teamB].map(id => `<div class="row"><span>${esc(pname(id))} <span class="muted small">${Math.round(cur[id]?.rating ?? settings().startRating)}</span></span>
        <span class="delta ${d[id] >= 0 ? 'up' : 'down'}">${signed(d[id])}</span></div>`).join('');
  }

  modalBody.oninput = modalBody.onchange = e => {
    const el = e.target;
    if (el.dataset.team) f['team' + el.dataset.team][+el.dataset.i] = el.value;
    else if (el.dataset.set !== undefined) f.sets[+el.dataset.set][+el.dataset.side] = el.value;
    else if (el.id === 'wind') f.wind = el.checked;
    else if (el.id === 'mdate') f.date = el.value;
    updatePreview();
  };
  modalBody.onclick = async e => {
    const el = e.target.closest('button'); if (!el) return;
    if (el.dataset.type) { f.type = el.dataset.type; draw(); }
    else if (el.id === 'addSet') { f.sets.push(['', '']); draw(); modalBody.querySelector(`[data-set="${f.sets.length - 1}"]`)?.focus(); }
    else if (el.dataset.rmset !== undefined) { f.sets.splice(+el.dataset.rmset, 1); draw(); }
    else if (el.id === 'saveMatch') {
      const v = validate(); if (v.err) return toast(v.err, true);
      const m = v.match, t = tally(m.sets);
      const ok = await mutate(d => { if (!d.matches.some(x => x.id === m.id)) d.matches.push(m); },
        `${MODES[m.type]}: ${m.teamA.map(pname).join('+')} ${t.setsA}-${t.setsB} ${m.teamB.map(pname).join('+')}${m.wind ? ' (vento)' : ''}`, 'Partita salvata 🏓');
      if (ok) { modal.close(); state.mode = m.type; go('ranking'); }
    }
  };
  draw();
  modal.showModal();
}

/* ---------- IMPOSTAZIONI ---------- */
function renderSettings() {
  const c = getConfig() || { branch: 'main', path: 'data/data.json' };
  const s = settings();
  view.innerHTML = `
    <h2>Archivio dati su GitHub</h2>
    <div class="card"><form id="cfgForm">
      <p class="help" style="margin-top:0">I dati vengono salvati in un file JSON nel tuo repository. Lascia vuoto "Utente" per usare la modalità locale.</p>
      <div class="teams-grid">
        <div><label>Utente / organizzazione</label><input type="text" name="owner" value="${esc(c.owner || '')}" placeholder="mario-rossi" autocapitalize="off" autocorrect="off"></div>
        <div><label>Repository</label><input type="text" name="repo" value="${esc(c.repo || '')}" placeholder="pingpong-ranking" autocapitalize="off" autocorrect="off"></div>
        <div><label>Branch</label><input type="text" name="branch" value="${esc(c.branch || 'main')}" autocapitalize="off"></div>
        <div><label>Percorso file</label><input type="text" name="path" value="${esc(c.path || 'data/data.json')}" autocapitalize="off"></div>
      </div>
      <label>Token GitHub (serve per salvare)</label>
      <input type="password" name="token" value="${esc(c.token || '')}" placeholder="github_pat_…" autocomplete="off">
      <p class="help">Token "fine-grained" limitato a questo repo con permesso <code>Contents: Read and write</code>. Resta salvato solo su questo dispositivo.</p>
      <div class="btns"><button class="btn" data-busy>Salva e collega</button><button type="button" class="btn ghost" id="shareCfg">🔗 Link per colleghi</button></div>
    </form></div>

    <h2>Parametri classifica</h2>
    <div class="card"><form id="eloForm">
      <div class="teams-grid">
        <div><label>Punteggio iniziale</label><input type="number" name="startRating" value="${s.startRating}" step="1"></div>
        <div><label>K normale</label><input type="number" name="kFactor" value="${s.kFactor}" step="1" min="1"></div>
        <div><label>K provvisorio</label><input type="number" name="provisionalK" value="${s.provisionalK}" step="1" min="1"></div>
        <div><label>Partite provvisorie</label><input type="number" name="provisionalMatches" value="${s.provisionalMatches}" step="1" min="0"></div>
        <div><label>Fattore vento (0–1)</label><input type="number" name="windFactor" value="${s.windFactor}" step="0.05" min="0" max="1"></div>
        <div><label>Peso scarto punti</label><input type="number" name="marginWeight" value="${s.marginWeight}" step="0.05" min="0" max="2"></div>
      </div>
      <div class="btns"><button class="btn" data-busy>Salva parametri</button></div>
      <p class="help">La classifica viene ricalcolata da zero su tutto lo storico, quindi cambiare i parametri vale anche per le partite passate.</p>
    </form></div>

    <h2>Come funziona il punteggio</h2>
    <div class="card help">
      <p style="margin-top:0">Ognuno parte da <b>${s.startRating}</b>. Dopo ogni partita: <code>variazione = K × scarto × vento × (risultato − atteso)</code></p>
      <ul style="padding-left:18px;margin:0">
        <li><b>Atteso</b>: probabilità di vittoria in base alla differenza di ELO. Battere uno più forte vale di più.</li>
        <li><b>K</b>: ${s.provisionalK} per le prime ${s.provisionalMatches} partite, poi ${s.kFactor}.</li>
        <li><b>Scarto</b>: da 1 a ${1 + s.marginWeight}× in base alla differenza di punti (11-2 pesa più di 12-10).</li>
        <li><b>Vento</b>: con il flag 💨 la variazione è × ${s.windFactor}, sia per chi vince sia per chi perde.</li>
        <li><b>Doppio</b>: classifica separata; vale la media ELO della coppia e i due compagni ricevono la stessa variazione.</li>
      </ul>
    </div>

    <h2>Backup</h2>
    <div class="card"><div class="btns" style="margin-top:0">
      <button class="btn ghost" id="exportBtn">⬇️ Esporta JSON</button>
      <label class="btn ghost" style="margin:0;text-align:center;color:var(--text);font-size:1rem">⬆️ Importa JSON<input type="file" id="importFile" accept="application/json,.json" hidden></label>
    </div></div>
    <p class="help" style="text-align:center">${isRemote() ? `Collegato a <b>${esc(c.owner)}/${esc(c.repo)}</b>` : 'Modalità locale'} · ${state.data.players.length} giocatori · ${state.data.matches.length} partite</p>`;

  $('#cfgForm').onsubmit = async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    for (const k in fd) fd[k] = fd[k].trim();
    if (fd.owner && !fd.repo) return toast('Indica anche il repository', true);
    setConfig(fd.owner ? fd : null);
    await refresh(true);
    if (isRemote() && !$('#banner').classList.contains('err')) toast('Collegato a GitHub ✓');
  };
  $('#shareCfg').onclick = async () => {
    const cfg = getConfig(); if (!cfg) return toast('Prima collega GitHub', true);
    const url = `${location.origin}${location.pathname}#setup=${encodeURIComponent(b64encode(JSON.stringify(cfg)))}`;
    try { if (navigator.share) await navigator.share({ title: 'Ping Pong Ranking', url }); else { await navigator.clipboard.writeText(url); toast('Link copiato negli appunti'); } }
    catch { prompt('Copia questo link:', url); }
  };
  $('#eloForm').onsubmit = async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target)); const ns = {};
    for (const k in fd) { const v = parseFloat(fd[k]); if (!Number.isFinite(v)) return toast('Valore non valido: ' + k, true); ns[k] = v; }
    ns.windFactor = Math.min(1, Math.max(0, ns.windFactor));
    await mutate(d => { d.settings = { ...d.settings, ...ns }; }, 'Aggiorna parametri classifica');
  };
  $('#exportBtn').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' }));
    a.download = `pingpong-backup-${todayISO()}.json`; a.click();
  };
  $('#importFile').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const d = normalize(JSON.parse(await file.text()));
      if (!confirm(`Sostituire tutti i dati con il backup (${d.players.length} giocatori, ${d.matches.length} partite)?`)) return;
      await mutate(x => { x.settings = d.settings; x.players = d.players; x.matches = d.matches; }, 'Import backup', 'Backup importato ✓');
    } catch { toast('File non valido', true); }
  };
}

/* ---------- eventi globali ---------- */
document.querySelector('.tabbar').onclick = e => { const b = e.target.closest('button'); if (b) go(b.dataset.tab); };
$('#fab').onclick = openNewMatch;
$('#refreshBtn').onclick = () => refresh();
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-mode],[data-player],[data-close],[data-del-match],[data-goto]');
  if (!t) return;
  if (t.dataset.goto) { e.preventDefault(); go(t.dataset.goto); }
  else if (t.dataset.mode && !modal.open) { state.mode = t.dataset.mode; render(); }
  else if (t.dataset.close !== undefined) modal.close();
  else if (t.dataset.player && !modal.open) openPlayer(t.dataset.player);
  else if (t.dataset.delMatch) {
    const m = state.data.matches.find(x => x.id === t.dataset.delMatch); if (!m) return;
    const tl = tally(m.sets);
    if (!confirm(`Eliminare la partita ${m.teamA.map(pname).join(' & ')} ${tl.setsA}-${tl.setsB} ${m.teamB.map(pname).join(' & ')}?`)) return;
    await mutate(d => { d.matches = d.matches.filter(x => x.id !== m.id); }, `Elimina partita del ${m.date}`, 'Partita eliminata');
  }
});
modal.addEventListener('click', e => { if (e.target === modal) modal.close(); });
modal.addEventListener('close', () => { modalBody.oninput = modalBody.onchange = modalBody.onclick = null; });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && isRemote() && !state.busy) refresh(true); });

/* ---------- avvio ---------- */
(function init() {
  const m = location.hash.match(/^#setup=(.+)$/);
  if (m) {
    try { const cfg = JSON.parse(b64decode(decodeURIComponent(m[1]))); if (cfg.owner && cfg.repo) { setConfig(cfg); toast('Configurazione importata ✓'); } } catch { toast('Link di configurazione non valido', true); }
    history.replaceState(null, '', location.pathname + location.search);
  }
  try { const c = JSON.parse(localStorage.getItem(CACHE_KEY)); if (c && isRemote()) setData(normalize(c)); } catch { }
  render();
  refresh(true);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });
})();

} // fine blocco UI
