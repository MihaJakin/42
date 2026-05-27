// IndexedDB wrapper za marathon-pwa
// Stores:
//   sessions    — vse planirane seje (id, week, date, type, km, plannedPace, ...)
//   completed   — opravljeni vnosi (id, sessionId?, date, type, km, durationSec, avgHr, maxHr, rpe, notes)
//   settings    — uporabniške nastavitve (maxHr, paces, currentWeek, theme, ...)
//   history     — predhodni teki iz Apple Health exporta (read-only zgodovina)

const DB_NAME = "marathon-pwa";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("completed")) {
        const cs = db.createObjectStore("completed", { keyPath: "id", autoIncrement: true });
        cs.createIndex("date", "date", { unique: false });
        cs.createIndex("sessionId", "sessionId", { unique: false });
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("history")) {
        const hs = db.createObjectStore("history", { keyPath: "id", autoIncrement: true });
        hs.createIndex("date", "date", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(storeName, mode = "readonly") {
  const db = await openDB();
  return db.transaction(storeName, mode).objectStore(storeName);
}

async function getAll(storeName) {
  const store = await tx(storeName);
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function put(storeName, value) {
  const store = await tx(storeName, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function add(storeName, value) {
  const store = await tx(storeName, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.add(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function del(storeName, key) {
  const store = await tx(storeName, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function get(storeName, key) {
  const store = await tx(storeName);
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function clear(storeName) {
  const store = await tx(storeName, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// Pomožne za nastavitve
async function getSetting(key, defaultValue = null) {
  const v = await get("settings", key);
  return v ? v.value : defaultValue;
}

async function setSetting(key, value) {
  return put("settings", { key, value });
}

// Export celotne baze v JSON (za sync prek GitHub Gist ali ročno)
async function exportAll() {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    sessions:  await getAll("sessions"),
    completed: await getAll("completed"),
    settings:  await getAll("settings"),
    history:   await getAll("history"),
  };
}

// Import: prepiše vse store-e iz JSON-a
async function importAll(data) {
  if (!data || data.version !== 1) throw new Error("Unsupported export version");
  for (const name of ["sessions", "completed", "settings", "history"]) {
    await clear(name);
    for (const row of (data[name] || [])) {
      await put(name, row);
    }
  }
}

window.Store = {
  openDB, getAll, put, add, del, get, clear,
  getSetting, setSetting,
  exportAll, importAll,
};
