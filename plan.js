// Marathon Training Plan Generator
// 20-week plan, race day: 2026-10-18 (Sun, week 20 day 7)
// Start: 2026-06-01 (Mon, week 1)
// Designed for sub-4:00 marathon goal based on HM 1:44 (4:53/km)

const PLAN_CONFIG = {
  startDate: "2026-06-01",        // Mon, W1 day 1
  raceDate:  "2026-10-18",        // Sun, W20 day 7
  goalMarathonTime: 4 * 3600,     // sec → 3:59:59 target = 4 hours
  totalWeeks: 20,
};

// Pace zones (sec/km). Derived from goal: MP = 5:41/km = 341 s/km
// Recomputed dynamically by app from user's recent results.
const DEFAULT_PACES = {
  recovery:   { min: 390, max: 420 }, // 6:30 - 7:00 — true Z1/Z2
  easy:       { min: 360, max: 390 }, // 6:00 - 6:30 — aerobic baza
  long:       { min: 350, max: 380 }, // 5:50 - 6:20
  marathon:   { min: 330, max: 345 }, // 5:30 - 5:45 (MP goal: 5:41)
  tempo:      { min: 290, max: 310 }, // 4:50 - 5:10 — threshold
  intervals:  { min: 270, max: 290 }, // 4:30 - 4:50 — 5K pace
  strides:    { min: 240, max: 260 }, // 4:00 - 4:20 (~20s repeats)
};

// HR zones — true max HR predpostavljen ~180 (peak iz exporta 169 + buffer);
// kalibrira se sproti, ko uporabnik vpiše vidno višji peak
const DEFAULT_HR = {
  maxHr: 180,
  zones: {
    z1: [0.50, 0.60],   // recovery
    z2: [0.60, 0.70],   // easy/baza
    z3: [0.70, 0.80],   // tempo
    z4: [0.80, 0.90],   // threshold
    z5: [0.90, 1.00],   // VO2max
  },
};

// Tip seje
const TYPES = {
  EASY:      { code: "easy",      label: "Easy",       color: "#22c55e", paceKey: "easy",      hrZ: "z2" },
  RECOVERY:  { code: "recovery",  label: "Recovery",   color: "#84cc16", paceKey: "recovery",  hrZ: "z1" },
  LONG:      { code: "long",      label: "Long",       color: "#0091ea", paceKey: "long",      hrZ: "z2" },
  TEMPO:     { code: "tempo",     label: "Tempo",      color: "#f59e0b", paceKey: "tempo",     hrZ: "z3" },
  MP:        { code: "mp",        label: "MP (mar. pace)", color: "#a855f7", paceKey: "marathon", hrZ: "z3" },
  INTERVALS: { code: "intervals", label: "Intervali",  color: "#ef4444", paceKey: "intervals", hrZ: "z4" },
  PROGRESSION:{ code: "progression",label: "Progression",color:"#0ea5e9", paceKey: "long",     hrZ: "z2" },
  CROSS:     { code: "cross",     label: "Cross/odbij", color: "#94a3b8", paceKey: null,        hrZ: null },
  REST:      { code: "rest",      label: "Počitek",    color: "#475569", paceKey: null,        hrZ: null },
  RACE:      { code: "race",      label: "MARATON",    color: "#dc2626", paceKey: "marathon",  hrZ: "z3" },
};

// Glavni skeleton — 20 tednov, po dnevih (1=Pon, 7=Ned)
// Vsak teden je definiran kot { phase, weekKm, longKm, sessions: { dow: {type, km, desc} } }
function buildPlanSkeleton() {
  return [
    // ───────── FAZA 1: RECOVERY / BAZA (W1-W5) — easy fokus, 3 sej / teden ─────────
    { week: 1, phase: "Recovery", weekKm: 28, sessions: {
        2: { type: "EASY", km: 7,  desc: "Lahkoten tek — pravi 'conversational' pace. Po polmaratonu se baza popravlja." },
        4: { type: "EASY", km: 8,  desc: "Steady easy. Če noge utrujene, podaljšaj počitek." },
        7: { type: "LONG", km: 13, desc: "Dolgi tek — počasi. Brez intenzivnosti. Cilj: čas na nogah." },
    }},
    { week: 2, phase: "Recovery", weekKm: 30, sessions: {
        2: { type: "EASY", km: 7,  desc: "Easy + 4×20 s strides na koncu (4:00-4:20/km, full recovery med stridei)." },
        4: { type: "EASY", km: 9,  desc: "Easy. Fokus na kadenco 170-175 spm." },
        7: { type: "LONG", km: 14, desc: "Dolgi tek easy. Vodo s sabo, vsakih 4-5 km požirek." },
    }},
    { week: 3, phase: "Recovery", weekKm: 32, sessions: {
        2: { type: "EASY", km: 8,  desc: "Easy + 6×20 s strides na koncu." },
        4: { type: "EASY", km: 9,  desc: "Steady easy." },
        7: { type: "LONG", km: 15, desc: "Dolgi tek. Prva ura easy, zadnjih 15-20 min lahko nekaj hitreje (steady, ne tempo)." },
    }},
    { week: 4, phase: "Recovery", weekKm: 27, sessions: {
        2: { type: "EASY", km: 7,  desc: "Lahki teden — telo se prilagaja. Easy + 4 strides." },
        4: { type: "RECOVERY", km: 6, desc: "Recovery pace — super lahkotno (6:30-7:00/km). Cilj: aktivno okrevanje." },
        7: { type: "LONG", km: 14, desc: "Dolgi tek easy." },
    }},
    { week: 5, phase: "Recovery", weekKm: 33, sessions: {
        2: { type: "EASY", km: 8,  desc: "Easy + 6 strides." },
        4: { type: "EASY", km: 10, desc: "Steady easy — daljši mid-week run za adaptacijo." },
        7: { type: "LONG", km: 15, desc: "Dolgi tek. Drugi polčas malo pospeši (5:45-6:00/km zadnjih 5 km)." },
    }},

    // ───────── FAZA 2: BUILD 1 (W6-W10) — uvajanje kvalitete, 3-4 sej ─────────
    { week: 6, phase: "Build 1", weekKm: 35, sessions: {
        2: { type: "EASY", km: 8,  desc: "Easy + 6 strides." },
        4: { type: "TEMPO", km: 10, desc: "Tempo: 2 km warm + 4 km @ tempo (4:50-5:05/km) + 2 km cool + 2 km easy. Prvi tempo — ne pretiravaj." },
        7: { type: "LONG", km: 16, desc: "Dolgi tek easy." },
    }},
    { week: 7, phase: "Build 1", weekKm: 38, sessions: {
        2: { type: "EASY", km: 8,  desc: "Easy + 6 strides." },
        4: { type: "TEMPO", km: 11, desc: "Tempo: 2 km wu + 2×2,5 km tempo (4:50-5:05/km) z 90 s odm. + 2 km cool." },
        6: { type: "EASY", km: 6,  desc: "Opcijski lahkoten 4. trening — preskoči če utrujen." },
        7: { type: "LONG", km: 17, desc: "Dolgi tek easy." },
    }},
    { week: 8, phase: "Build 1", weekKm: 41, sessions: {
        2: { type: "EASY", km: 8,  desc: "Easy." },
        4: { type: "MP", km: 11, desc: "MP run: 2 km wu + 6 km @ MP (5:30-5:45/km) + 3 km cool. Občuti maratonski pace." },
        6: { type: "EASY", km: 7,  desc: "Easy ali izpusti." },
        7: { type: "LONG", km: 19, desc: "Dolgi tek easy. Glikogen test — brez gela, samo voda." },
    }},
    { week: 9, phase: "Build 1", weekKm: 32, sessions: {
        // Cutback teden — manj volumna
        2: { type: "EASY", km: 7,  desc: "Easy + 6 strides." },
        4: { type: "INTERVALS", km: 9, desc: "Intervali: 2 km wu + 5×800 m @ 4:30-4:45/km z 2 min joga odm. + 2 km cool. Prvi intervali — kontrola." },
        7: { type: "LONG", km: 16, desc: "Dolgi tek easy (cutback)." },
    }},
    { week: 10, phase: "Build 1", weekKm: 43, sessions: {
        2: { type: "EASY", km: 8,  desc: "Easy." },
        4: { type: "TEMPO", km: 12, desc: "Tempo: 2 km wu + 6 km @ tempo (4:55/km) + 2 km cool + 2 km easy." },
        6: { type: "EASY", km: 6,  desc: "Lahkoten." },
        7: { type: "LONG", km: 21, desc: "Dolgi tek easy. Preverjevalni — če uspe brez težav, gremo v Build 2." },
    }},

    // ───────── FAZA 3: BUILD 2 (W11-W14) — marathon specific, 4 sej ─────────
    { week: 11, phase: "Build 2", weekKm: 45, sessions: {
        2: { type: "EASY", km: 8,  desc: "Easy + 6 strides." },
        4: { type: "MP", km: 12, desc: "MP: 2 km wu + 8 km @ MP (5:35/km) + 2 km cool. Konsistenten pace celih 8 km." },
        6: { type: "EASY", km: 7,  desc: "Easy/recovery." },
        7: { type: "LONG", km: 22, desc: "Dolgi tek: prvih 18 km easy, zadnjih 4 km @ MP. Vzemi 1-2 gela." },
    }},
    { week: 12, phase: "Build 2", weekKm: 49, sessions: {
        2: { type: "EASY", km: 8,  desc: "Easy." },
        4: { type: "INTERVALS", km: 11, desc: "Intervali: 2 km wu + 6×1 km @ 4:30-4:40/km z 2 min joga odm. + 2 km cool." },
        6: { type: "EASY", km: 7,  desc: "Easy." },
        7: { type: "LONG", km: 24, desc: "Dolgi tek easy. Testiraj prehranjevanje (gel vsakih 30-40 min)." },
    }},
    { week: 13, phase: "Build 2", weekKm: 42, sessions: {
        // Cutback teden
        2: { type: "EASY", km: 8,  desc: "Easy + 6 strides." },
        4: { type: "TEMPO", km: 12, desc: "Tempo: 2 km wu + 2×4 km @ tempo z 3 min jog + 2 km cool." },
        7: { type: "LONG", km: 20, desc: "Dolgi tek easy (cutback). Aktivna regeneracija." },
    }},
    { week: 14, phase: "Build 2", weekKm: 52, sessions: {
        2: { type: "EASY", km: 9,  desc: "Easy + strides." },
        4: { type: "MP", km: 14, desc: "MP: 2 km wu + 10 km @ MP (5:35/km) + 2 km cool. Glavni MP block — disciplina pace-a." },
        6: { type: "EASY", km: 7,  desc: "Easy." },
        7: { type: "LONG", km: 26, desc: "Dolgi tek: 22 km easy + 4 km @ MP. Preizkus prehrane in opreme." },
    }},

    // ───────── FAZA 4: PEAK (W15-W17) — najvišji volumen ─────────
    { week: 15, phase: "Peak", weekKm: 55, sessions: {
        2: { type: "EASY", km: 9,  desc: "Easy + 6 strides." },
        4: { type: "INTERVALS", km: 12, desc: "K (Yasso 800): 2 km wu + 8×800 m @ 4:20-4:35/km z 2 min jog + 2 km cool. Klasični Yasso." },
        6: { type: "EASY", km: 7,  desc: "Easy ali recovery." },
        7: { type: "LONG", km: 28, desc: "Dolgi tek: 24 km easy + 4 km @ MP. Najdaljši doslej — telo se uči." },
    }},
    { week: 16, phase: "Peak", weekKm: 58, sessions: {
        2: { type: "EASY", km: 9,  desc: "Easy." },
        4: { type: "MP", km: 14, desc: "MP: 2 km wu + 10 km @ MP (5:35/km) + 2 km cool. Zadnji veliki MP." },
        6: { type: "EASY", km: 7,  desc: "Easy." },
        7: { type: "LONG", km: 30, desc: "Dolgi tek: 25 km easy + 5 km @ MP. PEAK long run. Trening za zid pri 30 km." },
    }},
    { week: 17, phase: "Peak", weekKm: 48, sessions: {
        // Cutback peak
        2: { type: "EASY", km: 8,  desc: "Easy + 6 strides." },
        4: { type: "TEMPO", km: 12, desc: "Tempo: 2 km wu + 6 km @ tempo + 4 km easy. Lažji od običajnega tempa." },
        7: { type: "LONG", km: 24, desc: "Dolgi tek easy. Cutback peak — pripravi telo za taper." },
    }},

    // ───────── FAZA 5: TAPER (W18-W20) — zmanjšaj volumen, ohrani ostrino ─────────
    { week: 18, phase: "Taper", weekKm: 40, sessions: {
        2: { type: "EASY", km: 8,  desc: "Easy + 6 strides." },
        4: { type: "MP", km: 11, desc: "MP: 2 km wu + 6 km @ MP + 3 km cool. Krajši ampak ostrina." },
        6: { type: "EASY", km: 6,  desc: "Easy." },
        7: { type: "LONG", km: 18, desc: "Skrajšan long: 14 km easy + 4 km @ MP. Taper začetek." },
    }},
    { week: 19, phase: "Taper", weekKm: 28, sessions: {
        2: { type: "EASY", km: 7,  desc: "Easy + 6 strides." },
        4: { type: "TEMPO", km: 8, desc: "Tempo: 2 km wu + 3 km @ tempo + 3 km cool. Kratki, oster trening." },
        7: { type: "LONG", km: 13, desc: "Mid-long easy. Vse manj." },
    }},
    { week: 20, phase: "Race Week", weekKm: 18, sessions: {
        2: { type: "EASY", km: 5, desc: "Lahkoten + 4 strides. Razmigaj noge." },
        4: { type: "EASY", km: 4, desc: "Zelo lahkoten 'shake-out'. 3-4 min @ MP samo da telo spomni." },
        6: { type: "RECOVERY", km: 3, desc: "Pre-race jog 20 min. Več počitka, hidracija, ogljikovi hidrati." },
        7: { type: "RACE", km: 42.2, desc: "🏁 MARATON 18.10.2026. Cilj: sub-4:00 (5:41/km). Prvih 10 km kontrola (5:45/km), 10-30 km MP, 30-42 km vse kar imaš." },
    }},
  ];
}

// Helpers
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function paceStr(secPerKm) {
  if (!secPerKm) return "—";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

function paceRangeStr(range) {
  if (!range) return "—";
  return `${paceStr(range.min)} – ${paceStr(range.max)}`;
}

function hrRangeStr(zoneKey, maxHr) {
  if (!zoneKey) return "—";
  const [lo, hi] = DEFAULT_HR.zones[zoneKey];
  return `${Math.round(lo * maxHr)} – ${Math.round(hi * maxHr)} bpm (${zoneKey.toUpperCase()})`;
}

function estimateDuration(km, paceRange) {
  if (!paceRange) return null;
  const mid = (paceRange.min + paceRange.max) / 2;
  return Math.round(km * mid);
}

// Generira polno listo seans z datumi in privzetimi vrednostmi
function generateFullPlan(paces = DEFAULT_PACES, maxHr = DEFAULT_HR.maxHr) {
  const skeleton = buildPlanSkeleton();
  const sessions = [];
  for (const wk of skeleton) {
    for (const [dowStr, s] of Object.entries(wk.sessions)) {
      const dow = parseInt(dowStr, 10);
      const date = addDays(PLAN_CONFIG.startDate, (wk.week - 1) * 7 + (dow - 1));
      const typeDef = TYPES[s.type];
      const paceRange = typeDef.paceKey ? paces[typeDef.paceKey] : null;
      sessions.push({
        id: `w${wk.week}d${dow}`,
        week: wk.week,
        phase: wk.phase,
        dow,
        date,
        type: typeDef.code,
        typeLabel: typeDef.label,
        color: typeDef.color,
        km: s.km,
        plannedPace: paceRange,
        plannedHrZone: typeDef.hrZ,
        plannedDurationSec: estimateDuration(s.km, paceRange),
        description: s.desc,
      });
    }
  }
  return { config: PLAN_CONFIG, sessions, weeks: skeleton, paces, maxHr };
}

// Adaptive recompute: na podlagi nedavnih opravljenih sej prilagodi pace cilje
// Pravilo: če je uporabnik povprečno 5%+ hitrejši/počasnejši od plana na easy tekih,
// premakni vse pace kategorije sorazmerno.
function adaptivePaces(completedSessions, basePaces = DEFAULT_PACES) {
  const easyCompleted = completedSessions
    .filter(s => s.type === "easy" && s.actualPaceSec)
    .slice(-5); // zadnjih 5
  if (easyCompleted.length < 3) return basePaces;

  const avgActual = easyCompleted.reduce((a, s) => a + s.actualPaceSec, 0) / easyCompleted.length;
  const planMid = (basePaces.easy.min + basePaces.easy.max) / 2;
  const ratio = avgActual / planMid; // <1 = hitrejši od plana

  // Bound ratio v razumne meje
  const bounded = Math.max(0.92, Math.min(1.08, ratio));

  const out = {};
  for (const [k, v] of Object.entries(basePaces)) {
    out[k] = {
      min: Math.round(v.min * bounded),
      max: Math.round(v.max * bounded),
    };
  }
  return out;
}

// Recompute paces iz nove race performanse (Riegel formula)
// new HM/10K/5K → estimate marathon pace → recompute all
// `slowestPace` = floor v sec/km za počasne teke (recovery/easy/long).
// Default 340 (5:40/km) — uporabnik želi nikoli ne teči počasneje.
// Če floor sili kompresijo, počasne teke stisnemo v ozek pas tik pod floor-om
// (recovery: 3s pas, easy: 8s pas, long: 15s pas). MP/tempo/intervali so vedno
// izračunani iz projekcije ne glede na floor.
function pacesFromRace(distanceKm, timeSec, slowestPace = 340) {
  // Riegel: T2 = T1 * (D2/D1)^1.06
  const projectedMarathonSec = timeSec * Math.pow(42.195 / distanceKm, 1.06);
  const projectedMP = projectedMarathonSec / 42.195; // sec/km

  const naturalRecoveryMax = projectedMP * 1.23;
  const floor = slowestPace;

  let recovery, easy, long;
  if (naturalRecoveryMax > floor) {
    // Floor zavzame nad naravno počasnimi paci → kompresiraj v ozek pas okoli floor-a
    recovery = { min: floor - 3,  max: floor };
    easy     = { min: floor - 8,  max: floor };
    long     = { min: floor - 15, max: floor };
  } else {
    // Naravni paci so že hitrejši od floor-a (uporabnikov cilj je dovolj agresiven)
    recovery = { min: Math.round(projectedMP * 1.15), max: Math.round(projectedMP * 1.23) };
    easy     = { min: Math.round(projectedMP * 1.06), max: Math.round(projectedMP * 1.15) };
    long     = { min: Math.round(projectedMP * 1.03), max: Math.round(projectedMP * 1.12) };
  }

  return {
    recovery,
    easy,
    long,
    marathon:  { min: Math.round(projectedMP * 0.97), max: Math.round(projectedMP * 1.01) },
    tempo:     { min: Math.round(projectedMP * 0.85), max: Math.round(projectedMP * 0.91) },
    intervals: { min: Math.round(projectedMP * 0.79), max: Math.round(projectedMP * 0.85) },
    strides:   { min: Math.round(projectedMP * 0.70), max: Math.round(projectedMP * 0.76) },
  };
}

// Export za browser (no modules)
window.PLAN = {
  CONFIG: PLAN_CONFIG,
  TYPES,
  DEFAULT_PACES,
  DEFAULT_HR,
  generateFullPlan,
  adaptivePaces,
  pacesFromRace,
  paceStr,
  paceRangeStr,
  hrRangeStr,
  estimateDuration,
  addDays,
};
