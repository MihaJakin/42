// Marathon PWA — main application logic
'use strict';

const DOW_NAMES = ["Pon", "Tor", "Sre", "Čet", "Pet", "Sob", "Ned"];

// === STATE ===
const state = {
  fullPlan: null,
  completedBySessionId: {},
  currentWeek: 1,
  maxHr: 180,
  paces: null,
};

// === UTILS ===
function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function parseDurationStr(s) {
  if (!s) return 0;
  const parts = s.trim().split(":").map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function fmtDuration(sec) {
  if (!sec || sec <= 0) return "—";
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtPace(secPerKm) { return PLAN.paceStr(secPerKm); }

function fmtDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("sl-SI", { day: "numeric", month: "numeric" });
}

function daysBetween(a, b) {
  const da = new Date(a + "T00:00:00");
  const db = new Date(b + "T00:00:00");
  return Math.round((db - da) / 86400000);
}

function currentWeekFromToday() {
  return Math.max(1, weekFromDate(todayISO()));
}

function weekFromDate(dateStr) {
  const diff = daysBetween(PLAN.CONFIG.startDate, dateStr);
  if (diff < 0) return 0;
  return Math.min(PLAN.CONFIG.totalWeeks, Math.floor(diff / 7) + 1);
}

// === INIT ===
async function init() {
  // Sync status hook za UI
  window.onSyncStatus = (status, msg) => {
    const el = $("#syncStatus");
    if (!el) return;
    const ts = new Date().toLocaleTimeString("sl-SI");
    if (status === "ok") el.textContent = `Status: ✓ sinhronizirano ${ts}`;
    else if (status === "error") el.textContent = `Status: ⚠ napaka — ${msg}`;
    else el.textContent = `Status: ${status}`;
  };

  await loadSettings();

  // Če je sync vklopljen in imamo gist ID, pulli iz gista PRED renderingom
  // (gist je canonical, lokalni IndexedDB samo cache)
  try {
    const enabled = await Store.getSetting("syncEnabled");
    const gistId = await Store.getSetting("gistId");
    const pat = await Store.getSetting("gistPat");
    if (enabled && gistId && pat) {
      await Sync.pullFromGist();
      await loadSettings(); // re-load po pull-u (pace cilji se lahko spremenijo)
      window.onSyncStatus("ok");
    }
  } catch (e) {
    console.warn("Boot sync pull failed:", e.message);
    window.onSyncStatus("error", e.message);
  }

  await refreshFullPlan();

  // One-shot auto-link history (npr. iz Apple Health seed) v planirane seje.
  // Pretežno koristno za W1 (Transition) kjer je uporabnik že tekel pred plan startom.
  try {
    const linked = await autoLinkHistoryToPlan();
    if (linked > 0) {
      console.log(`[autolink] linked ${linked} runs from history to plan sessions`);
      Sync.scheduleSyncPush();
    }
  } catch (e) {
    console.warn("Auto-link failed:", e.message);
  }

  await refreshCompleted();
  state.currentWeek = currentWeekFromToday();
  bindUI();
  renderHeader();
  renderWeek();
  renderPlan();
  renderStats();
  renderSettings();
}

async function loadSettings() {
  state.maxHr = await Store.getSetting("maxHr", 180);
  const goalSec = await Store.getSetting("goalTimeSec", 14400);
  state.goalTimeSec = goalSec;
  state.slowestPace = await Store.getSetting("slowestPace", 340); // 5:40/km default
  state.hrZones = await Store.getSetting("hrZones", null); // {z1Max, z2Max, z3Max, z4Max} ali null

  // Privzeto: pace cilji iz CILJA maratona (sub-4:00 → MP 5:41/km)
  // Easy pace anchored na goal MP zagotavlja, da uporabnik dejansko teče easy.
  // slowestPace zagotovi, da easy/long/recovery niso počasnejši od uporabnikovega floor-a.
  state.paces = PLAN.pacesFromRace(42.195, goalSec, state.slowestPace);

  // Custom override (uporabnik je v nastavitvah ročno preračunal paces)
  const overridePaces = await Store.getSetting("paces", null);
  if (overridePaces) state.paces = overridePaces;
}

async function refreshFullPlan() {
  state.fullPlan = PLAN.generateFullPlan(state.paces, state.maxHr);
}

// Readiness: koliko km in počitka v zadnjih 7 dneh pred danim datumom.
// Vrne color + label za prikaz "pripravljen / utrujen / preveč".
async function computeReadiness(sessionDate) {
  const completed = await Store.getAll("completed");
  const history = await Store.getAll("history");
  const sevenDaysAgo = PLAN.addDays(sessionDate, -7);
  const recent = [];
  for (const c of completed) if (!c.skipped && c.km > 0 && c.date >= sevenDaysAgo && c.date < sessionDate) recent.push(c);
  for (const h of history) if (h.date >= sevenDaysAgo && h.date < sessionDate) recent.push(h);
  const km = recent.reduce((s, r) => s + (r.km || 0), 0);
  const uniqueDates = new Set(recent.map(r => r.date));
  const restDays = 7 - uniqueDates.size;

  // Pragovi: prilagojeni za 3-4 sej/teden uporabnika
  if (km > 65 && restDays < 2) return { color: "#ef4444", label: "Visok volumen brez počitka", emoji: "🔴" };
  if (km > 55) return { color: "#f59e0b", label: "Visok volumen", emoji: "🟠" };
  if (km > 40 && restDays < 2) return { color: "#f59e0b", label: "Zmerno utrujen", emoji: "🟠" };
  if (km < 5 && restDays > 5) return { color: "#0091ea", label: "Spočit (malo treninga)", emoji: "🔵" };
  return { color: "#22c55e", label: "Pripravljen", emoji: "🟢" };
}

// Za vsako sejo v planu poišče history zapis na istem datumu in ga zveže
// kot 'completed'. Idempotentno: že linkane seje preskoči.
// Vrne število novo linkanih.
async function autoLinkHistoryToPlan() {
  const history = await Store.getAll("history");
  const completed = await Store.getAll("completed");
  if (history.length === 0) return 0;

  const completedByDate = {};
  for (const c of completed) {
    if (c.sessionId) completedByDate[c.sessionId] = c;
  }

  const histByDate = {};
  for (const h of history) histByDate[h.date] = h;

  let linked = 0;
  for (const s of state.fullPlan.sessions) {
    if (completedByDate[s.id]) continue; // že linkana
    const h = histByDate[s.date];
    if (!h) continue;
    const entry = {
      sessionId: s.id,
      date: s.date,
      week: s.week,
      type: s.type,
      km: h.km,
      durationSec: h.durationSec,
      avgHr: h.avgHr || null,
      maxHr: h.maxHr || null,
      rpe: null,
      feel: null,
      notes: "Auto-linkano iz Apple Health zgodovine",
      skipped: false,
      autoLinked: true,
      loggedAt: new Date().toISOString(),
    };
    await Store.add("completed", entry);
    linked++;
  }
  return linked;
}

async function refreshCompleted() {
  const all = await Store.getAll("completed");
  state.completedBySessionId = {};
  state.adhocRuns = [];
  for (const c of all) {
    if (c.sessionId) {
      state.completedBySessionId[c.sessionId] = c;
    } else {
      state.adhocRuns.push(c);
    }
  }
  state.adhocRuns.sort((a, b) => a.date.localeCompare(b.date));
}

// === HEADER ===
function renderHeader() {
  const days = daysBetween(todayISO(), PLAN.CONFIG.raceDate);
  $("#daysToRace").textContent = days;
  $("#goalTime").textContent = "sub-" + fmtDuration(state.goalTimeSec);
}

// === WEEK VIEW ===
async function renderWeek() {
  const w = state.currentWeek;
  const wkData = state.fullPlan.weeks.find(x => x.week === w);
  const wkSessions = state.fullPlan.sessions.filter(s => s.week === w);

  $("#weekLabel").textContent = `Teden ${w}/${PLAN.CONFIG.totalWeeks} · ${wkData.phase}`;
  const totalKm = wkSessions.reduce((sum, s) => sum + s.km, 0);
  const dateRange = `${fmtDate(wkSessions[0].date)} – ${fmtDate(wkSessions[wkSessions.length - 1].date)}`;

  // Volume indicator: izračunaj dejansko opravljeno (planned + adhoc + history avtolinkano)
  let actualKm = 0;
  for (const s of wkSessions) {
    const c = state.completedBySessionId[s.id];
    if (c && !c.skipped) actualKm += c.km;
  }
  // Plus ad-hoc teki znotraj tedenskega range
  const wkStart = wkSessions[0].date;
  const wkEnd = wkSessions[wkSessions.length - 1].date;
  for (const a of (state.adhocRuns || [])) {
    if (a.date >= wkStart && a.date <= wkEnd) actualKm += a.km;
  }
  const pct = totalKm > 0 ? Math.round((actualKm / totalKm) * 100) : 0;
  let pctColor = "var(--text-dim)";
  let pctEmoji = "";
  if (pct >= 85) { pctColor = "var(--success)"; pctEmoji = "✓"; }
  else if (pct >= 60) { pctColor = "var(--warn)"; pctEmoji = "⚠"; }
  else if (actualKm > 0) { pctColor = "var(--danger)"; pctEmoji = "↓"; }

  $("#weekMeta").innerHTML = `
    ${dateRange} · plan ${totalKm.toFixed(0)} km ·
    <span style="color:${pctColor};font-weight:600">opravljeno ${actualKm.toFixed(1)} km (${pct}%) ${pctEmoji}</span>
  `;

  const container = $("#weekSessions");
  container.innerHTML = "";
  if (wkSessions.length === 0) {
    container.innerHTML = '<div class="empty-state"><h3>Ni planiranih sej</h3></div>';
    return;
  }

  // Sort by date
  wkSessions.sort((a, b) => a.date.localeCompare(b.date));
  const today = todayISO();

  // Pre-compute readiness za nedostavljene seje (paralelno)
  const readinessMap = {};
  await Promise.all(wkSessions.map(async s => {
    const c = state.completedBySessionId[s.id];
    if (!c || c.rescheduled) {
      readinessMap[s.id] = await computeReadiness(s.date);
    }
  }));

  for (const s of wkSessions) {
    const c = state.completedBySessionId[s.id];
    const isRescheduled = c && c.rescheduled && (c.km === 0); // premaknjena ampak še ne opravljena
    // Če je premaknjena, prikaži kartico na NOVEM datumu (ne planskem)
    const displayDate = isRescheduled ? c.date : s.date;
    const isToday = displayDate === today;
    const isPast = displayDate < today;
    const isFuture = displayDate > today;
    const isSkipped = c && c.skipped;
    const isCompleted = c && !c.skipped && c.km > 0;

    const card = document.createElement("div");
    card.className = "session-card";
    if (isCompleted) card.classList.add("completed");
    if (isToday && !isCompleted) card.classList.add("today");
    if (isSkipped) card.classList.add("skipped");
    if (s.type === "race") card.classList.add("race");
    card.style.borderLeftColor = s.color;
    card.dataset.sessionId = s.id;

    // Day name iz dejanskega prikaza (po premiku se lahko spremeni)
    const displayDow = new Date(displayDate + "T00:00:00").getDay() || 7;
    const dayName = DOW_NAMES[displayDow - 1];
    const dateShort = fmtDate(displayDate);
    const planPace = PLAN.paceRangeStr(s.plannedPace);
    const planDur = fmtDuration(s.plannedDurationSec);
    const hrZone = s.plannedHrZone
      ? PLAN.hrRangeStr(s.plannedHrZone, state.maxHr, state.hrZones)
      : "";

    let actualHtml = "";
    if (c) {
      if (c.skipped) {
        actualHtml = `<div class="session-actual"><span class="badge skipped">PRESKOČENO</span> ${c.notes || ""}</div>`;
      } else if (isRescheduled) {
        actualHtml = `<div class="session-actual"><span class="badge today">📅 PREMAKNJENO</span> z ${fmtDate(c.originalDate)} → tap za vnos rezultata</div>`;
      } else {
        const actPace = c.durationSec / c.km;
        const planMidPace = s.plannedPace ? (s.plannedPace.min + s.plannedPace.max) / 2 : null;
        const delta = planMidPace ? actPace - planMidPace : null;
        const deltaCls = delta == null ? "" : (delta < -5 ? "pos" : delta > 15 ? "neg" : "");
        const deltaStr = delta == null ? "" : `<span class="delta ${deltaCls}">${delta < 0 ? "−" : "+"}${fmtPace(Math.abs(delta)).replace("/km", "")}</span>`;
        actualHtml = `
          <div class="session-actual">
            <span class="badge done">✓ OPRAVLJENO</span>
            <strong>${c.km.toFixed(2)} km</strong> · ${fmtDuration(c.durationSec)} ·
            pace <strong>${fmtPace(actPace)}</strong> ${deltaStr}
            ${c.avgHr ? `· HR ${c.avgHr}` : ""}
            ${c.rpe ? `· RPE ${c.rpe}/10` : ""}
            ${c.notes ? `<div class="hint" style="margin-top:4px">${escapeHtml(c.notes)}</div>` : ""}
          </div>`;
      }
    } else if (isPast) {
      actualHtml = `<div class="session-actual"><span class="badge skipped">Brez vnosa</span></div>`;
    } else if (isToday) {
      actualHtml = `<div class="session-actual"><span class="badge today">DANES — tapni za vnos</span></div>`;
    }

    // Readiness indikator (samo za neopravljene seje, ki še niso v preteklosti)
    const readiness = readinessMap[s.id];
    const readinessHtml = (readiness && !isCompleted && !isSkipped && !isPast)
      ? `<span title="${readiness.label}" style="color:${readiness.color};font-size:14px;margin-right:4px;">${readiness.emoji}</span>`
      : "";

    card.innerHTML = `
      <div class="session-head">
        <span class="session-type">
          ${readinessHtml}${s.typeLabel}
          <span class="pill" style="background:${s.color}">${s.type === "race" ? "🏁" : s.km + " km"}</span>
        </span>
        <span class="session-day">${dayName} · ${dateShort}</span>
      </div>
      <div class="session-meta">
        <span><strong>${s.km}</strong> km</span>
        <span>pace ${planPace}</span>
        ${planDur !== "—" ? `<span>~${planDur}</span>` : ""}
        ${hrZone ? `<span>${hrZone}</span>` : ""}
      </div>
      ${readiness && !isCompleted && !isSkipped && !isPast ? `<div class="session-meta" style="font-size:12px"><span style="color:${readiness.color}">${readiness.emoji} ${readiness.label}</span></div>` : ""}
      <div class="session-desc">${s.description}</div>
      ${actualHtml}
    `;
    card.addEventListener("click", () => openLogModal(s));
    container.appendChild(card);
  }

  // Render ad-hoc runs za ta teden (po datumu znotraj weekStart-weekEnd)
  renderAdhocForWeek(w);
}

function renderAdhocForWeek(weekNum) {
  const list = $("#adhocList");
  if (!list) return;
  list.innerHTML = "";

  const wkSessions = state.fullPlan.sessions.filter(s => s.week === weekNum);
  if (!wkSessions.length) return;
  const weekStart = wkSessions[0].date;
  const weekEnd   = wkSessions[wkSessions.length - 1].date;

  const adhoc = (state.adhocRuns || []).filter(r => r.date >= weekStart && r.date <= weekEnd);

  if (adhoc.length === 0) {
    list.innerHTML = '<div class="adhoc-empty">Brez dodatnih tekov ta teden.</div>';
    return;
  }

  for (const r of adhoc) {
    const typeLabel = (PLAN.TYPES[(r.type || "easy").toUpperCase()] || PLAN.TYPES.EASY).label;
    const color = (PLAN.TYPES[(r.type || "easy").toUpperCase()] || PLAN.TYPES.EASY).color;
    const card = document.createElement("div");
    card.className = "session-card";
    card.style.borderLeftColor = color;
    const pace = r.km > 0 ? fmtPace(r.durationSec / r.km) : "—";
    card.innerHTML = `
      <div class="session-head">
        <span class="session-type">
          ${typeLabel}
          <span class="pill" style="background:${color}">${r.km.toFixed(2)} km</span>
        </span>
        <span class="session-day">${fmtDate(r.date)}</span>
      </div>
      <div class="session-meta">
        <span><strong>${r.km.toFixed(2)}</strong> km</span>
        <span>${fmtDuration(r.durationSec)}</span>
        <span>pace ${pace}</span>
        ${r.avgHr ? `<span>HR ${r.avgHr}</span>` : ""}
        ${r.rpe ? `<span>RPE ${r.rpe}/10</span>` : ""}
      </div>
      ${r.notes ? `<div class="session-desc">${escapeHtml(r.notes)}</div>` : ""}
      <div class="session-actual" style="display:flex;gap:8px;align-items:center;">
        <span class="badge done">AD-HOC</span>
        <button class="btn ghost" data-edit-id="${r.id}" style="font-size:12px;padding:4px 8px;margin-left:auto">✎ Uredi</button>
        <button class="btn ghost" data-del-id="${r.id}" style="font-size:12px;padding:4px 8px;color:var(--danger)">🗑</button>
      </div>
    `;
    list.appendChild(card);
  }

  // Bind edit/delete
  list.querySelectorAll("[data-edit-id]").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.editId);
      const run = state.adhocRuns.find(x => x.id === id);
      if (run) openLogModal(null, run);
    });
  });
  list.querySelectorAll("[data-del-id]").forEach(btn => {
    btn.addEventListener("click", async e => {
      e.stopPropagation();
      if (!confirm("Izbrišem ta tek?")) return;
      await Store.del("completed", parseInt(btn.dataset.delId));
      Sync.scheduleSyncPush();
      await refreshCompleted();
      renderWeek();
      renderStats();
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// === PLAN OVERVIEW ===
function renderPlan() {
  const container = $("#planOverview");
  container.innerHTML = "";

  const phases = [];
  let lastPhase = null;
  for (const wk of state.fullPlan.weeks) {
    if (wk.phase !== lastPhase) {
      phases.push({ name: wk.phase, weeks: [] });
      lastPhase = wk.phase;
    }
    phases[phases.length - 1].weeks.push(wk);
  }

  for (const phase of phases) {
    const block = document.createElement("div");
    block.className = "phase-block";
    let html = `<h3>${phase.name}</h3>`;
    for (const wk of phase.weeks) {
      const cls = wk.week === state.currentWeek ? "week-row current" : "week-row";
      const sessionsArr = Object.entries(wk.sessions).map(([dow, s]) => {
        const t = PLAN.TYPES[s.type];
        return `<span class="mini" style="background:${t.color}">${t.label.split(" ")[0]} ${s.km}k</span>`;
      });
      html += `
        <div class="${cls}" data-week="${wk.week}" role="button" tabindex="0">
          <span class="week-num">W${wk.week}</span>
          <span class="week-km">${wk.weekKm} km</span>
          <span class="week-sess">${sessionsArr.join("")}</span>
        </div>`;
    }
    block.innerHTML = html;
    container.appendChild(block);
  }

  // Bind clicks: skoči na izbran teden
  container.querySelectorAll(".week-row[data-week]").forEach(row => {
    row.addEventListener("click", () => {
      state.currentWeek = parseInt(row.dataset.week);
      // Preklopi na Teden zavihek
      $$(".tab").forEach(x => x.classList.remove("active"));
      $$(".tab-panel").forEach(x => x.classList.remove("active"));
      $('[data-tab="week"]').classList.add("active");
      $('.tab-panel[data-panel="week"]').classList.add("active");
      $("#addRunBtn").style.display = "flex";
      renderWeek();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

// === STATS ===
async function renderStats() {
  const container = $("#statsContent");
  const completed = await Store.getAll("completed");
  const history = await Store.getAll("history");

  // Validni completed = ne preskočeni IN ima km > 0 (rescheduled imajo km=0)
  const validCompleted = completed.filter(c => !c.skipped && c.km > 0);

  // Dedup: če history zapis ima isti datum kot completed zapis, preferiraj completed
  // (completed je vir resnice; history je le seed za auto-link)
  const completedDates = new Set(validCompleted.map(c => c.date));
  const historyOnly = history.filter(h => !completedDates.has(h.date));

  const allRuns = [
    ...historyOnly.map(h => ({ date: h.date, km: h.km, durationSec: h.durationSec, avgHr: h.avgHr, source: "apple" })),
    ...validCompleted.map(c => ({ date: c.date, km: c.km, durationSec: c.durationSec, avgHr: c.avgHr, source: "app" })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  if (allRuns.length === 0) {
    container.innerHTML = '<div class="empty-state"><h3>Še ni zgodovine</h3><p>Vpiši prvi trening na Teden zavihku ali naloži seed iz Apple Health (Settings → Backup → Naloži seed).</p></div>';
    return;
  }

  const totalKm = allRuns.reduce((s, r) => s + r.km, 0);
  const totalDur = allRuns.reduce((s, r) => s + r.durationSec, 0);
  const last30 = allRuns.filter(r => daysBetween(r.date, todayISO()) <= 30);
  const last30Km = last30.reduce((s, r) => s + r.km, 0);
  const avgPace = totalDur / totalKm;
  const hrRuns = allRuns.filter(r => r.avgHr);
  const avgHr = hrRuns.length ? hrRuns.reduce((s, r) => s + r.avgHr, 0) / hrRuns.length : 0;

  // Tedenski volumen zadnjih 12 tednov
  const weekly = {};
  for (const r of allRuns) {
    const wk = isoWeekKey(r.date);
    weekly[wk] = (weekly[wk] || 0) + r.km;
  }
  const weeks = Object.entries(weekly).sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
  const maxWeekly = Math.max(...weeks.map(w => w[1]), 1);

  let bars = `<div class="bar-chart">`;
  for (const [wk, km] of weeks) {
    const h = (km / maxWeekly) * 100;
    bars += `<div class="bar" style="height:${h}%"><span class="val">${km.toFixed(0)}</span><span class="lbl">${wk.split("-")[1]}</span></div>`;
  }
  bars += `</div>`;

  container.innerHTML = `
    <div class="stat-card">
      <h3>Skupna statistika</h3>
      <div class="stat-grid">
        <div class="stat"><div class="stat-value">${allRuns.length}</div><div class="stat-label">Tekov</div></div>
        <div class="stat"><div class="stat-value">${totalKm.toFixed(0)}</div><div class="stat-label">Skupaj km</div></div>
        <div class="stat"><div class="stat-value">${fmtPace(avgPace).replace("/km", "")}</div><div class="stat-label">Avg pace</div></div>
        <div class="stat"><div class="stat-value">${avgHr ? avgHr.toFixed(0) : "—"}</div><div class="stat-label">Avg HR</div></div>
      </div>
    </div>
    <div class="stat-card">
      <h3>Zadnjih 30 dni</h3>
      <div class="stat-grid">
        <div class="stat"><div class="stat-value">${last30.length}</div><div class="stat-label">Tekov</div></div>
        <div class="stat"><div class="stat-value">${last30Km.toFixed(1)}</div><div class="stat-label">km</div></div>
      </div>
    </div>
    <div class="stat-card">
      <h3>Tedenski volumen (zadnjih 12 t.)</h3>
      <div style="padding-bottom:24px;">${bars}</div>
    </div>
  `;
}

function isoWeekKey(dateStr) {
  // Parsiraj kot UTC midnight da se izognemo timezone bugu (CEST sicer naredi
  // Mon → Sun in pomakne v prejšnji ISO teden).
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 4 - (dt.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const wk = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
}

// === SETTINGS ===
async function renderSettings() {
  $("#setMaxHr").value = state.maxHr;
  $("#setGoalTime").value = fmtDuration(state.goalTimeSec);
  $("#setSlowestPace").value = fmtPace(state.slowestPace).replace("/km", "");
  $("#setZ1Max").value = state.hrZones?.z1Max || "";
  $("#setZ2Max").value = state.hrZones?.z2Max || "";
  $("#setZ3Max").value = state.hrZones?.z3Max || "";
  $("#setZ4Max").value = state.hrZones?.z4Max || "";

  // Sync nastavitve
  const pat = await Store.getSetting("gistPat", "");
  const gistId = await Store.getSetting("gistId", "");
  const enabled = await Store.getSetting("syncEnabled", false);
  const lastSync = await Store.getSetting("lastSync", null);
  $("#syncPat").value = pat || "";
  $("#syncGistId").value = gistId || "";
  $("#syncEnabled").checked = !!enabled;
  if (lastSync) {
    const d = new Date(lastSync);
    $("#syncStatus").textContent = `Status: ✓ zadnja sinhronizacija ${d.toLocaleString("sl-SI")}`;
  } else if (pat) {
    $("#syncStatus").textContent = "Status: PAT shranjen, še ni sync-a";
  }

  const pacesDiv = $("#pacesTable");
  pacesDiv.innerHTML = "";
  for (const [key, range] of Object.entries(state.paces)) {
    pacesDiv.innerHTML += `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);">
      <span style="text-transform:capitalize">${key}</span>
      <span><strong>${fmtPace(range.min)} – ${fmtPace(range.max)}</strong></span>
    </div>`;
  }
}

// === MODAL / LOG ===
let modalSession = null;
let modalAdhoc = null; // če editiramo obstoječi adhoc run

function openLogModal(session, adhocRun = null) {
  modalSession = session;
  modalAdhoc = adhocRun;
  $("#logModal").hidden = false;
  $("#skipBtn").hidden = !session; // ad-hoc nima "preskoči"
  $("#rescheduleBtn").hidden = !session; // ad-hoc nima "premakni"
  $("#logTypeWrap").hidden = !!session; // tip selector samo za ad-hoc

  if (session) {
    // Standard planned session
    $("#modalTitle").textContent = `${session.typeLabel} · ${DOW_NAMES[session.dow - 1]} ${fmtDate(session.date)}`;
    $("#logSessionId").value = session.id;
    $("#logDate").value = session.date;

    const c = state.completedBySessionId[session.id];
    if (c && !c.skipped) {
      $("#logKm").value = c.km;
      $("#logDuration").value = fmtDuration(c.durationSec);
      $("#logAvgHr").value = c.avgHr || "";
      $("#logMaxHr").value = c.maxHr || "";
      $("#logRpe").value = c.rpe || 5;
      $("#logRpeVal").textContent = c.rpe || 5;
      $("#logFeel").value = c.feel || "good";
      $("#logNotes").value = c.notes || "";
    } else {
      $("#logKm").value = session.km;
      $("#logDuration").value = "";
      $("#logAvgHr").value = "";
      $("#logMaxHr").value = "";
      $("#logRpe").value = 5;
      $("#logRpeVal").textContent = 5;
      $("#logFeel").value = "good";
      $("#logNotes").value = "";
    }

    const p = $("#modalPlanned");
    const watchPlan = PLAN.generateWatchPlan(session, state.paces);
    const watchStepsHtml = renderWatchSteps(watchPlan, state.paces, state.maxHr, state.hrZones);

    p.innerHTML = `
      <div class="row"><span class="lbl">Plan razdalja</span><span class="val">${session.km} km</span></div>
      <div class="row"><span class="lbl">Plan pace</span><span class="val">${PLAN.paceRangeStr(session.plannedPace)}</span></div>
      <div class="row"><span class="lbl">Plan trajanje</span><span class="val">${fmtDuration(session.plannedDurationSec)}</span></div>
      <div class="row"><span class="lbl">Cilj HR</span><span class="val">${session.plannedHrZone ? PLAN.hrRangeStr(session.plannedHrZone, state.maxHr, state.hrZones) : "—"}</span></div>
      <div class="row" style="margin-top:6px"><span class="hint">${session.description}</span></div>
      ${watchStepsHtml}
    `;
  } else {
    // Ad-hoc tek (nov ali editiranje)
    const isEdit = !!adhocRun;
    $("#modalTitle").textContent = isEdit ? "Uredi tek (izven plana)" : "Dodaj tek (izven plana)";
    $("#logSessionId").value = "";
    $("#logDate").value = isEdit ? adhocRun.date : todayISO();
    $("#logKm").value = isEdit ? adhocRun.km : "";
    $("#logDuration").value = isEdit ? fmtDuration(adhocRun.durationSec) : "";
    $("#logAvgHr").value = isEdit ? (adhocRun.avgHr || "") : "";
    $("#logMaxHr").value = isEdit ? (adhocRun.maxHr || "") : "";
    $("#logRpe").value = isEdit ? (adhocRun.rpe || 5) : 5;
    $("#logRpeVal").textContent = $("#logRpe").value;
    $("#logFeel").value = isEdit ? (adhocRun.feel || "good") : "good";
    $("#logNotes").value = isEdit ? (adhocRun.notes || "") : "";
    $("#logType").value = isEdit ? (adhocRun.type || "easy") : "easy";

    $("#modalPlanned").innerHTML = `
      <div class="row"><span class="hint">Tek izven plana — ne vpliva na planirane seje, je pa upoštevan v statistiki.</span></div>
    `;
  }
}

// Render Apple Watch structured workout steps
function renderWatchSteps(steps, paces, maxHr, hrZones) {
  if (!steps || steps.length === 0) return "";
  const stepRows = steps.map((step, i) => {
    const pace = step.paceKey ? paces[step.paceKey] : null;
    const paceStr = pace ? PLAN.paceRangeStr(pace) : "—";
    let zoneKey = null;
    if (step.paceKey === "easy" || step.paceKey === "long" || step.paceKey === "recovery") zoneKey = "z2";
    else if (step.paceKey === "tempo" || step.paceKey === "marathon") zoneKey = "z3";
    else if (step.paceKey === "intervals") zoneKey = "z4";
    const hrStr = zoneKey ? PLAN.hrRangeStr(zoneKey, maxHr, hrZones) : "—";
    const distStr = step.distance >= 1 ? `${step.distance.toFixed(1)} km` : `${(step.distance * 1000).toFixed(0)} m`;
    let html = `
      <div class="watch-step">
        <div class="watch-step-head">
          <span class="watch-step-num">${i + 1}</span>
          <span class="watch-step-name">${step.name}</span>
          <span class="watch-step-dist">${distStr}${step.repeat ? ` × ${step.repeat}` : ""}</span>
        </div>
        <div class="watch-step-meta">pace ${paceStr} · HR ${hrStr}</div>
        ${step.note ? `<div class="watch-step-note">💡 ${step.note}</div>` : ""}`;
    if (step.rest) {
      const rPace = paces[step.rest.paceKey];
      html += `<div class="watch-step-rest">↺ Rest med ponovitvami: ${(step.rest.distance * 1000).toFixed(0)} m @ ${PLAN.paceRangeStr(rPace)} ${step.rest.note ? "(" + step.rest.note + ")" : ""}</div>`;
    }
    html += "</div>";
    return html;
  }).join("");

  return `
    <details class="watch-block" open>
      <summary>📲 Apple Watch trening — ${steps.length} korakov</summary>
      <div class="watch-steps">${stepRows}</div>
      <div class="watch-tip">
        <strong>Nastavi na uri:</strong> Workout app → Outdoor Run → ··· → Create Workout → Custom →
        dodaj korake po vrsti. Vsak korak <em>by Distance</em> + opcijsko <em>Pace Alert</em>
        ali <em>HR Alert</em>. Pred štartom: izberi ta custom workout.
      </div>
    </details>
  `;
}

function closeLogModal() {
  $("#logModal").hidden = true;
  modalSession = null;
}

async function handleLogSubmit(e) {
  e.preventDefault();

  const km = parseFloat($("#logKm").value);
  const durationSec = parseDurationStr($("#logDuration").value);
  if (!km || !durationSec) {
    alert("Vnesi razdaljo in čas.");
    return;
  }

  const date = $("#logDate").value;
  const baseEntry = {
    date,
    km,
    durationSec,
    avgHr: parseInt($("#logAvgHr").value) || null,
    maxHr: parseInt($("#logMaxHr").value) || null,
    rpe: parseInt($("#logRpe").value),
    feel: $("#logFeel").value,
    notes: $("#logNotes").value.trim(),
    skipped: false,
    loggedAt: new Date().toISOString(),
  };

  let entry;
  if (modalSession) {
    // Planned session log
    entry = {
      ...baseEntry,
      sessionId: modalSession.id,
      week: modalSession.week,
      type: modalSession.type,
    };
    // Izbriši obstoječi vnos za to sejo
    const existing = state.completedBySessionId[modalSession.id];
    if (existing && existing.id) {
      await Store.del("completed", existing.id);
    }
  } else {
    // Ad-hoc run (nov ali edit obstoječega)
    entry = {
      ...baseEntry,
      sessionId: null,
      week: weekFromDate(date),
      type: $("#logType").value,
      adhoc: true,
    };
    if (modalAdhoc && modalAdhoc.id) {
      // Editiranje — preserve id
      entry.id = modalAdhoc.id;
      await Store.del("completed", modalAdhoc.id);
    }
  }

  await Store.add("completed", entry);
  Sync.scheduleSyncPush(); // auto-push (debounced)

  // Adaptive recalibration — preveri, če je potreben re-compute pace-ov
  await maybeAdaptPaces();
  // Preveri tudi maxHr update
  if (entry.maxHr && entry.maxHr > state.maxHr - 5) {
    const newMax = entry.maxHr + 5;
    if (newMax > state.maxHr) {
      state.maxHr = newMax;
      await Store.setSetting("maxHr", newMax);
    }
  }

  await refreshFullPlan();
  await refreshCompleted();
  closeLogModal();
  renderWeek();
  renderStats();
  renderSettings();
}

async function maybeAdaptPaces() {
  const all = await Store.getAll("completed");
  const easyRuns = all
    .filter(c => !c.skipped && c.type === "easy" && c.km > 0 && c.durationSec > 0)
    .map(c => ({ ...c, actualPaceSec: c.durationSec / c.km }))
    .slice(-5);

  if (easyRuns.length < 3) return;

  // Če povprečni dejanski pace odstopa več kot 10s od plana, prilagodi
  const planMid = (state.paces.easy.min + state.paces.easy.max) / 2;
  const avgActual = easyRuns.reduce((s, r) => s + r.actualPaceSec, 0) / easyRuns.length;
  const delta = avgActual - planMid;

  if (Math.abs(delta) > 8) {
    const newPaces = PLAN.adaptivePaces(easyRuns, state.paces);
    state.paces = newPaces;
    await Store.setSetting("paces", newPaces);
    console.log(`[adapt] Easy pace recalibrated by ${delta > 0 ? "+" : ""}${delta.toFixed(0)}s/km`);
  }
}

async function handleReschedule() {
  if (!modalSession) return;
  const newDate = prompt(
    `Premakni "${modalSession.typeLabel} ${modalSession.km} km" iz ${fmtDate(modalSession.date)} na nov datum (YYYY-MM-DD):`,
    todayISO()
  );
  if (!newDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
    if (newDate) alert("Napačen format datuma. Pričakovan: YYYY-MM-DD (npr. 2026-05-30)");
    return;
  }
  // Shranjeno kot "moved" entry — original session ima vnos "moved" status, novi datum
  const entry = {
    sessionId: modalSession.id,
    date: newDate,
    week: weekFromDate(newDate) || modalSession.week,
    type: modalSession.type,
    km: 0, // 0 = ni opravljeno, samo premaknjeno
    durationSec: 0,
    skipped: false,
    rescheduled: true,
    originalDate: modalSession.date,
    notes: `Premaknjeno z ${fmtDate(modalSession.date)} → ${fmtDate(newDate)}`,
    loggedAt: new Date().toISOString(),
  };
  const existing = state.completedBySessionId[modalSession.id];
  if (existing && existing.id) await Store.del("completed", existing.id);
  await Store.add("completed", entry);
  Sync.scheduleSyncPush();
  await refreshCompleted();
  closeLogModal();
  renderWeek();
  alert(`Seja premaknjena na ${fmtDate(newDate)}. Ko jo opraviš, klikni nanjo in vpiši rezultat.`);
}

async function handleSkip() {
  if (!modalSession) return;
  const reason = prompt("Zakaj preskoči? (kratka opomba — bolezen, utrujenost, ...)") || "";
  const entry = {
    sessionId: modalSession.id,
    date: $("#logDate").value,
    week: modalSession.week,
    type: modalSession.type,
    km: 0,
    durationSec: 0,
    skipped: true,
    notes: reason,
    loggedAt: new Date().toISOString(),
  };
  const existing = state.completedBySessionId[modalSession.id];
  if (existing && existing.id) {
    await Store.del("completed", existing.id);
  }
  await Store.add("completed", entry);
  Sync.scheduleSyncPush();
  await refreshCompleted();
  closeLogModal();
  renderWeek();
}

// === BIND UI ===
function bindUI() {
  // Tabs
  $$(".tab").forEach(t => {
    t.addEventListener("click", () => {
      $$(".tab").forEach(x => x.classList.remove("active"));
      $$(".tab-panel").forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      $(`.tab-panel[data-panel="${t.dataset.tab}"]`).classList.add("active");
      if (t.dataset.tab === "stats") renderStats();
      if (t.dataset.tab === "plan") renderPlan();
      // FAB samo na Teden zavihku
      $("#addRunBtn").style.display = (t.dataset.tab === "week") ? "flex" : "none";
    });
  });

  // Week nav
  $("#prevWeek").addEventListener("click", () => {
    if (state.currentWeek > 1) { state.currentWeek--; renderWeek(); }
  });
  $("#nextWeek").addEventListener("click", () => {
    if (state.currentWeek < PLAN.CONFIG.totalWeeks) { state.currentWeek++; renderWeek(); }
  });

  // FAB: dodaj ad-hoc tek
  $("#addRunBtn").addEventListener("click", () => openLogModal(null, null));

  // Modal
  $("#closeModal").addEventListener("click", closeLogModal);
  $("#logModal").addEventListener("click", e => {
    if (e.target.id === "logModal") closeLogModal();
  });
  $("#logForm").addEventListener("submit", handleLogSubmit);
  $("#skipBtn").addEventListener("click", handleSkip);
  $("#rescheduleBtn").addEventListener("click", handleReschedule);
  $("#logRpe").addEventListener("input", e => $("#logRpeVal").textContent = e.target.value);

  // Settings
  $("#saveProfile").addEventListener("click", async () => {
    const maxHr = parseInt($("#setMaxHr").value);
    const goalSec = parseDurationStr($("#setGoalTime").value);
    const slowestStr = $("#setSlowestPace").value.trim();
    const slowestSec = slowestStr ? parseDurationStr(slowestStr) : null;
    // HR zones (vsi morajo biti vneseni za uporabo)
    const z1 = parseInt($("#setZ1Max").value) || null;
    const z2 = parseInt($("#setZ2Max").value) || null;
    const z3 = parseInt($("#setZ3Max").value) || null;
    const z4 = parseInt($("#setZ4Max").value) || null;
    const hrZones = (z2 && z3 && z4) ? { z1Max: z1, z2Max: z2, z3Max: z3, z4Max: z4 } : null;
    await Store.setSetting("hrZones", hrZones);

    if (maxHr) await Store.setSetting("maxHr", maxHr);
    if (goalSec) await Store.setSetting("goalTimeSec", goalSec);
    if (slowestSec) await Store.setSetting("slowestPace", slowestSec);
    state.maxHr = maxHr || state.maxHr;
    state.goalTimeSec = goalSec || state.goalTimeSec;
    state.slowestPace = slowestSec || state.slowestPace;
    state.hrZones = hrZones;
    // Recompute paces from new goal + floor
    state.paces = PLAN.pacesFromRace(42.195, state.goalTimeSec, state.slowestPace);
    await Store.setSetting("paces", state.paces);
    Sync.scheduleSyncPush();
    await refreshFullPlan();
    renderHeader();
    renderWeek();
    renderSettings();
    alert("Profil shranjen.");
  });

  $("#recomputePaces").addEventListener("click", async () => {
    const dist = parseFloat($("#raceDist").value);
    const sec = parseDurationStr($("#raceTime").value);
    if (!dist || !sec) { alert("Vnesi razdaljo in čas."); return; }
    state.paces = PLAN.pacesFromRace(dist, sec, state.slowestPace);
    await Store.setSetting("paces", state.paces);
    if (dist > 20 && dist < 22) {
      await Store.setSetting("hmTimeSec", sec);
      await Store.setSetting("hmDist", dist);
    }
    await refreshFullPlan();
    renderWeek();
    renderSettings();
    alert("Pace cilji preračunani.");
  });

  $("#exportBtn").addEventListener("click", async () => {
    const data = await Store.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `marathon-pwa-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $("#importBtn").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const text = await f.text();
      const data = JSON.parse(text);
      if (!confirm("Pozor: import bo prepisal vse trenutne podatke. Nadaljujem?")) return;
      await Store.importAll(data);
      await loadSettings();
      await refreshFullPlan();
      await refreshCompleted();
      renderHeader(); renderWeek(); renderPlan(); renderStats(); renderSettings();
      alert("Import uspešen.");
    } catch (err) {
      alert("Napaka pri importu: " + err.message);
    }
  });

  $("#loadSeed").addEventListener("click", async () => {
    try {
      const resp = await fetch("seed.json");
      if (!resp.ok) throw new Error("seed.json ni dostopen");
      const seed = await resp.json();
      if (!confirm(`Naloži ${seed.history.length} predhodnih tekov iz Apple Health?`)) return;
      await Store.clear("history");
      for (const h of seed.history) {
        await Store.put("history", h);
      }
      // Profile-related (samo cilj + maxHr; pace cilji se izračunajo iz cilja,
      // NE iz HM PB-ja, da easy teki ostanejo res easy)
      if (seed.userProfile) {
        await Store.setSetting("maxHr", seed.userProfile.maxHrEstimate || 180);
        if (seed.userProfile.goalTimeSec) {
          await Store.setSetting("goalTimeSec", seed.userProfile.goalTimeSec);
        }
        // PB se shrani samo za zgodovino — pace se ne preračuna avtomatsko
        if (seed.userProfile.halfMarathonPb) {
          await Store.setSetting("hmTimeSec", seed.userProfile.halfMarathonPb.timeSec);
          await Store.setSetting("hmDist", seed.userProfile.halfMarathonPb.km);
        }
      }
      // Pobriši morebitni custom pace override, da loadSettings ponovno izračuna iz cilja
      await Store.del("settings", "paces");
      await loadSettings();
      await refreshFullPlan();
      const linked = await autoLinkHistoryToPlan();
      await refreshCompleted();
      Sync.scheduleSyncPush();
      renderHeader(); renderWeek(); renderStats(); renderSettings();
      alert(`Seed naložen.${linked > 0 ? "\n\nAuto-linkano " + linked + " tekov v plan seje (videti boš ✓ pri pretečenih dnevih)." : ""}`);
    } catch (err) {
      alert("Napaka: " + err.message);
    }
  });

  // === SYNC UI ===
  $("#syncPat").addEventListener("change", async () => {
    const val = $("#syncPat").value.trim();
    if (val) await Store.setSetting("gistPat", val);
  });
  $("#syncEnabled").addEventListener("change", async () => {
    await Store.setSetting("syncEnabled", $("#syncEnabled").checked);
  });
  $("#syncGistId").addEventListener("change", async () => {
    const val = $("#syncGistId").value.trim();
    if (val) await Store.setSetting("gistId", val);
  });
  $("#syncTest").addEventListener("click", async () => {
    try {
      const val = $("#syncPat").value.trim();
      if (val) await Store.setSetting("gistPat", val);
      const u = await Sync.testAuth();
      alert(`✓ PAT OK\nPrijavljen kot: ${u.login}${u.name ? " (" + u.name + ")" : ""}`);
      window.onSyncStatus("ok");
    } catch (e) {
      alert("⚠ Napaka: " + e.message);
      window.onSyncStatus("error", e.message);
    }
  });
  $("#syncPush").addEventListener("click", async () => {
    try {
      const val = $("#syncPat").value.trim();
      if (val) await Store.setSetting("gistPat", val);
      const r = await Sync.pushToGist();
      if (r.created) {
        $("#syncGistId").value = r.gistId;
        alert(`✓ Nov gist ustvarjen!\nID: ${r.gistId}\nVklopil sem auto-sync. Na drugi napravi vnesi isti PAT in Gist ID, ali pa pulli.`);
        // Auto-enable sync after first successful push
        $("#syncEnabled").checked = true;
        await Store.setSetting("syncEnabled", true);
      } else {
        alert("✓ Sinhronizirano");
      }
      window.onSyncStatus("ok");
      renderSettings();
    } catch (e) {
      alert("⚠ Push napaka: " + e.message);
      window.onSyncStatus("error", e.message);
    }
  });
  $("#syncPull").addEventListener("click", async () => {
    try {
      if (!confirm("Pulli iz gista bo prepisal vse lokalne podatke. Nadaljujem?")) return;
      const val = $("#syncPat").value.trim();
      if (val) await Store.setSetting("gistPat", val);
      const idVal = $("#syncGistId").value.trim();
      if (idVal) await Store.setSetting("gistId", idVal);
      const r = await Sync.pullFromGist();
      alert(`✓ Pulled iz gista ${r.gistId} (${r.fetchedBytes} bytes).`);
      await loadSettings();
      await refreshFullPlan();
      await refreshCompleted();
      renderHeader(); renderWeek(); renderPlan(); renderStats(); renderSettings();
      window.onSyncStatus("ok");
    } catch (e) {
      alert("⚠ Pull napaka: " + e.message);
      window.onSyncStatus("error", e.message);
    }
  });

  $("#resetAll").addEventListener("click", async () => {
    if (!confirm("Resetiraj VSE podatke? Vse opravljeni treningi bodo zbrisani. Nepovratno.")) return;
    if (!confirm("Si res prepričan?")) return;
    await Store.clear("sessions");
    await Store.clear("completed");
    await Store.clear("history");
    await Store.clear("settings");
    location.reload();
  });
}

// === BOOT ===
window.addEventListener("DOMContentLoaded", init);
