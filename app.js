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
  const today = todayISO();
  const diff = daysBetween(PLAN.CONFIG.startDate, today);
  if (diff < 0) return 1;
  return Math.min(20, Math.floor(diff / 7) + 1);
}

// === INIT ===
async function init() {
  await loadSettings();
  await refreshFullPlan();
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

  // Privzeto: pace cilji iz CILJA maratona (sub-4:00 → MP 5:41/km)
  // Easy pace anchored na goal MP zagotavlja, da uporabnik dejansko teče easy,
  // ne pa na pace, ki bi ga zmogel po HM PB rezultatu.
  state.paces = PLAN.pacesFromRace(42.195, goalSec);

  // Custom override (uporabnik je v nastavitvah ročno preračunal paces)
  const overridePaces = await Store.getSetting("paces", null);
  if (overridePaces) state.paces = overridePaces;
}

async function refreshFullPlan() {
  state.fullPlan = PLAN.generateFullPlan(state.paces, state.maxHr);
}

async function refreshCompleted() {
  const all = await Store.getAll("completed");
  state.completedBySessionId = {};
  for (const c of all) {
    if (c.sessionId) {
      state.completedBySessionId[c.sessionId] = c;
    }
  }
}

// === HEADER ===
function renderHeader() {
  const days = daysBetween(todayISO(), PLAN.CONFIG.raceDate);
  $("#daysToRace").textContent = days;
  $("#goalTime").textContent = "sub-" + fmtDuration(state.goalTimeSec);
}

// === WEEK VIEW ===
function renderWeek() {
  const w = state.currentWeek;
  const wkData = state.fullPlan.weeks.find(x => x.week === w);
  const wkSessions = state.fullPlan.sessions.filter(s => s.week === w);

  $("#weekLabel").textContent = `Teden ${w}/20 · ${wkData.phase}`;
  const totalKm = wkSessions.reduce((sum, s) => sum + s.km, 0);
  const dateRange = `${fmtDate(wkSessions[0].date)} – ${fmtDate(wkSessions[wkSessions.length - 1].date)}`;
  $("#weekMeta").textContent = `${dateRange} · ${totalKm.toFixed(0)} km plan`;

  const container = $("#weekSessions");
  container.innerHTML = "";
  if (wkSessions.length === 0) {
    container.innerHTML = '<div class="empty-state"><h3>Ni planiranih sej</h3></div>';
    return;
  }

  // Sort by date
  wkSessions.sort((a, b) => a.date.localeCompare(b.date));
  const today = todayISO();

  for (const s of wkSessions) {
    const c = state.completedBySessionId[s.id];
    const isToday = s.date === today;
    const isPast = s.date < today;
    const isFuture = s.date > today;
    const isSkipped = c && c.skipped;
    const isCompleted = c && !c.skipped;

    const card = document.createElement("div");
    card.className = "session-card";
    if (isCompleted) card.classList.add("completed");
    if (isToday && !isCompleted) card.classList.add("today");
    if (isSkipped) card.classList.add("skipped");
    if (s.type === "race") card.classList.add("race");
    card.style.borderLeftColor = s.color;
    card.dataset.sessionId = s.id;

    const dayName = DOW_NAMES[s.dow - 1];
    const dateShort = fmtDate(s.date);
    const planPace = PLAN.paceRangeStr(s.plannedPace);
    const planDur = fmtDuration(s.plannedDurationSec);
    const hrZone = s.plannedHrZone
      ? PLAN.hrRangeStr(s.plannedHrZone, state.maxHr)
      : "";

    let actualHtml = "";
    if (c) {
      if (c.skipped) {
        actualHtml = `<div class="session-actual"><span class="badge skipped">PRESKOČENO</span> ${c.notes || ""}</div>`;
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

    card.innerHTML = `
      <div class="session-head">
        <span class="session-type">
          ${s.typeLabel}
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
      <div class="session-desc">${s.description}</div>
      ${actualHtml}
    `;
    card.addEventListener("click", () => openLogModal(s));
    container.appendChild(card);
  }
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
        <div class="${cls}">
          <span class="week-num">W${wk.week}</span>
          <span class="week-km">${wk.weekKm} km</span>
          <span class="week-sess">${sessionsArr.join("")}</span>
        </div>`;
    }
    block.innerHTML = html;
    container.appendChild(block);
  }
}

// === STATS ===
async function renderStats() {
  const container = $("#statsContent");
  const completed = await Store.getAll("completed");
  const history = await Store.getAll("history");

  const allRuns = [
    ...history.map(h => ({ date: h.date, km: h.km, durationSec: h.durationSec, avgHr: h.avgHr, source: "apple" })),
    ...completed.filter(c => !c.skipped).map(c => ({ date: c.date, km: c.km, durationSec: c.durationSec, avgHr: c.avgHr, source: "app" })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  if (allRuns.length === 0) {
    container.innerHTML = '<div class="empty-state"><h3>Še ni zgodovine</h3><p>Naloži seed iz Apple Health ali vpiši prve treninge.</p></div>';
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
  const d = new Date(dateStr + "T00:00:00");
  // ISO week: copy date, set to nearest Thursday
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const wk = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
}

// === SETTINGS ===
function renderSettings() {
  $("#setMaxHr").value = state.maxHr;
  $("#setGoalTime").value = fmtDuration(state.goalTimeSec);

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

function openLogModal(session) {
  modalSession = session;
  $("#logModal").hidden = false;
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
  p.innerHTML = `
    <div class="row"><span class="lbl">Plan razdalja</span><span class="val">${session.km} km</span></div>
    <div class="row"><span class="lbl">Plan pace</span><span class="val">${PLAN.paceRangeStr(session.plannedPace)}</span></div>
    <div class="row"><span class="lbl">Plan trajanje</span><span class="val">${fmtDuration(session.plannedDurationSec)}</span></div>
    <div class="row"><span class="lbl">Cilj HR</span><span class="val">${session.plannedHrZone ? PLAN.hrRangeStr(session.plannedHrZone, state.maxHr) : "—"}</span></div>
    <div class="row" style="margin-top:6px"><span class="hint">${session.description}</span></div>
  `;
}

function closeLogModal() {
  $("#logModal").hidden = true;
  modalSession = null;
}

async function handleLogSubmit(e) {
  e.preventDefault();
  if (!modalSession) return;

  const km = parseFloat($("#logKm").value);
  const durationSec = parseDurationStr($("#logDuration").value);
  if (!km || !durationSec) {
    alert("Vnesi razdaljo in čas.");
    return;
  }

  const entry = {
    sessionId: modalSession.id,
    date: $("#logDate").value,
    week: modalSession.week,
    type: modalSession.type,
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

  // Najprej izbriši obstoječi vnos za to sejo, da ne podvojimo
  const existing = state.completedBySessionId[modalSession.id];
  if (existing && existing.id) {
    await Store.del("completed", existing.id);
  }

  await Store.add("completed", entry);

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
    });
  });

  // Week nav
  $("#prevWeek").addEventListener("click", () => {
    if (state.currentWeek > 1) { state.currentWeek--; renderWeek(); }
  });
  $("#nextWeek").addEventListener("click", () => {
    if (state.currentWeek < 20) { state.currentWeek++; renderWeek(); }
  });

  // Modal
  $("#closeModal").addEventListener("click", closeLogModal);
  $("#logModal").addEventListener("click", e => {
    if (e.target.id === "logModal") closeLogModal();
  });
  $("#logForm").addEventListener("submit", handleLogSubmit);
  $("#skipBtn").addEventListener("click", handleSkip);
  $("#logRpe").addEventListener("input", e => $("#logRpeVal").textContent = e.target.value);

  // Settings
  $("#saveProfile").addEventListener("click", async () => {
    const maxHr = parseInt($("#setMaxHr").value);
    const goalSec = parseDurationStr($("#setGoalTime").value);
    if (maxHr) await Store.setSetting("maxHr", maxHr);
    if (goalSec) await Store.setSetting("goalTimeSec", goalSec);
    state.maxHr = maxHr || state.maxHr;
    state.goalTimeSec = goalSec || state.goalTimeSec;
    // Recompute paces from new goal
    state.paces = PLAN.pacesFromRace(42.195, state.goalTimeSec);
    await Store.setSetting("paces", state.paces);
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
    state.paces = PLAN.pacesFromRace(dist, sec);
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
      renderHeader(); renderWeek(); renderStats(); renderSettings();
      alert("Seed naložen.");
    } catch (err) {
      alert("Napaka: " + err.message);
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
