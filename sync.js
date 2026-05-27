// Marathon PWA — GitHub Gist sync
// Shrani vse podatke v en privat gist na uporabnikovem GitHub računu.
// PAT (Personal Access Token) ostane v IndexedDB; nikoli ni v gistu.
//
// Datoteka v gistu: marathon-data.json
// Auto-sync: debounced push 2s po vsaki spremembi (če je sync vklopljen).
'use strict';

const SECRET_KEYS = ["gistPat", "gistId", "lastSync", "syncEnabled"];
const GIST_FILENAME = "marathon-data.json";

async function gistFetch(path, options = {}) {
  const pat = await Store.getSetting("gistPat");
  if (!pat) throw new Error("Manjka GitHub PAT");
  const resp = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${pat}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub API ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

// Pripravi payload za sync (brez secrets)
async function exportForSync() {
  const data = await Store.exportAll();
  data.settings = (data.settings || []).filter(s => !SECRET_KEYS.includes(s.key));
  return data;
}

// Apply remote data (ohrani lokalne secrets/sync nastavitve)
async function importFromSync(data) {
  const localSync = {};
  for (const key of SECRET_KEYS) {
    localSync[key] = await Store.getSetting(key);
  }
  await Store.importAll(data);
  for (const [key, value] of Object.entries(localSync)) {
    if (value !== null && value !== undefined) await Store.setSetting(key, value);
  }
}

async function createGist() {
  const data = await exportForSync();
  const body = {
    description: "Marathon PWA training data",
    public: false,
    files: { [GIST_FILENAME]: { content: JSON.stringify(data, null, 2) } },
  };
  const result = await gistFetch("/gists", {
    method: "POST",
    body: JSON.stringify(body),
  });
  await Store.setSetting("gistId", result.id);
  await Store.setSetting("lastSync", new Date().toISOString());
  return result.id;
}

async function pushToGist() {
  let gistId = await Store.getSetting("gistId");
  if (!gistId) {
    gistId = await createGist();
    return { created: true, gistId };
  }
  const data = await exportForSync();
  const body = {
    files: { [GIST_FILENAME]: { content: JSON.stringify(data, null, 2) } },
  };
  await gistFetch(`/gists/${gistId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  await Store.setSetting("lastSync", new Date().toISOString());
  return { created: false, gistId };
}

async function pullFromGist() {
  const gistId = await Store.getSetting("gistId");
  if (!gistId) throw new Error("Manjka Gist ID");
  const result = await gistFetch(`/gists/${gistId}`);
  const fileContent = result.files?.[GIST_FILENAME]?.content;
  if (!fileContent) throw new Error(`${GIST_FILENAME} ni v gistu`);
  const data = JSON.parse(fileContent);
  await importFromSync(data);
  await Store.setSetting("lastSync", new Date().toISOString());
  return { gistId, fetchedBytes: fileContent.length };
}

// Preveri PAT z lahkim API klicem
async function testAuth() {
  const result = await gistFetch("/user");
  return { login: result.login, name: result.name };
}

// Debounced auto-push
let syncTimer = null;
let syncInFlight = false;
let pendingPush = false;

function scheduleSyncPush(delayMs = 2500) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    syncTimer = null;
    if (syncInFlight) { pendingPush = true; return; }
    try {
      const enabled = await Store.getSetting("syncEnabled");
      if (!enabled) return;
      syncInFlight = true;
      await pushToGist();
      console.log("[sync] pushed");
      if (window.onSyncStatus) window.onSyncStatus("ok");
    } catch (e) {
      console.error("[sync] push failed:", e.message);
      if (window.onSyncStatus) window.onSyncStatus("error", e.message);
    } finally {
      syncInFlight = false;
      if (pendingPush) {
        pendingPush = false;
        scheduleSyncPush(500);
      }
    }
  }, delayMs);
}

window.Sync = {
  createGist,
  pushToGist,
  pullFromGist,
  testAuth,
  scheduleSyncPush,
  exportForSync,
  importFromSync,
};
