// Turniiride salvestamine brauseri localStorage'isse (kohalik koopia / "Minu turniirid" nimekiri)
// ning kui Firebase on seadistatud, ka pilve (et jagamislingid saaksid töötada ja uueneda).
import { uid } from './util.js';
import { cloudSave, isCloudConfigured } from './cloud.js';

const STORAGE_KEY = 'padel_turniirid_v1';

export function loadAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveAll(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function getTournament(id) {
  return loadAll().find((t) => t.id === id) || null;
}

export function saveTournament(t) {
  const list = loadAll();
  const idx = list.findIndex((x) => x.id === t.id);
  t.updatedAt = Date.now();
  if (idx >= 0) list[idx] = t;
  else list.unshift(t);
  saveAll(list);
  if (isCloudConfigured()) {
    cloudSave(t).catch((err) => {
      console.error('Pilve salvestamine ebaõnnestus', err);
      window.dispatchEvent(new CustomEvent('cloud-error', { detail: err.message }));
    });
  }
  return t;
}

export function deleteTournament(id) {
  saveAll(loadAll().filter((t) => t.id !== id));
}

// Lisab/uuendab kohalikku nimekirja pilvest loetud turniiridega (nt sisselogitud
// kasutaja "Minu turniirid" päring) — ei kirjuta tagasi pilve, ainult kohalik vahemälu.
export function cacheTournaments(cloudList) {
  if (!cloudList || !cloudList.length) return;
  const existing = loadAll();
  const byId = {};
  existing.forEach((t) => (byId[t.id] = t));
  cloudList.forEach((t) => (byId[t.id] = t));
  saveAll(Object.values(byId).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
}

export function newTournament(settings, playerInputs) {
  // playerInputs: array of strings (nimed) VÕI {id, name} objektid (kui id-sid on vaja mujal taaskasutada, nt paaride jaoks)
  const players = playerInputs.map((p, i) =>
    typeof p === 'string' ? { id: uid(), name: p.trim() || `Mängija ${i + 1}` } : { id: p.id || uid(), name: (p.name || '').trim() || `Mängija ${i + 1}` }
  );
  return {
    id: uid(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    name: settings.name || 'Padeliturniir',
    settings,
    players,
    teams: [],
    slots: [], // { matches: [...], resting: [...] }
    phase: 'setup', // setup -> group -> playoffs -> done
    bracket: null,
  };
}
