// Turniiride salvestamine brauseri localStorage'isse (kohalik koopia / "Minu turniirid" nimekiri)
// ning kui Firebase on seadistatud, ka pilve (et jagamislingid saaksid töötada ja uueneda).
import { uid } from './util.js';
import { cloudSave, cloudDelete, isCloudConfigured, saveCourtNames as cloudSaveCourtNames, getCourtNames as cloudGetCourtNames } from './cloud.js';

const STORAGE_KEY = 'padel_turniirid_v1';
const COURT_NAMES_KEY = 'padel_court_names_v1';

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

export async function deleteTournament(id) {
  saveAll(loadAll().filter((t) => t.id !== id));
  if (isCloudConfigured()) {
    try {
      await cloudDelete(id);
    } catch (err) {
      console.error('Pilvest kustutamine ebaõnnestus', err);
      window.dispatchEvent(new CustomEvent('cloud-error', { detail: err.message }));
    }
  }
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

// Väljakute nimed: kohalik koopia (kiireks kasutamiseks, töötab ka väljas-logituna
// samas brauseris) + kui sisse logitud, ka pilve sünkroon (et nimed käiksid kasutaja
// kontoga kaasas, mitte poleks seotud ühe kindla arvuti/brauseriga).
export function loadCourtNames() {
  try {
    const raw = localStorage.getItem(COURT_NAMES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function saveCourtNames(names) {
  localStorage.setItem(COURT_NAMES_KEY, JSON.stringify(names));
  if (isCloudConfigured()) {
    cloudSaveCourtNames(names).catch((err) => {
      console.error('Väljakute nimede pilve salvestamine ebaõnnestus', err);
      window.dispatchEvent(new CustomEvent('cloud-error', { detail: err.message }));
    });
  }
}

// Loeb sisselogimisel pilvest väljakute nimed ja uuendab kohalikku koopiat — nii
// näeb kasutaja oma nimesid ka teisest arvutist/telefonist sisse logides.
export async function syncCourtNamesFromCloud(uid) {
  if (!isCloudConfigured() || !uid) return loadCourtNames();
  try {
    const cloudNames = await cloudGetCourtNames(uid);
    if (cloudNames && cloudNames.length) {
      localStorage.setItem(COURT_NAMES_KEY, JSON.stringify(cloudNames));
      return cloudNames;
    }
  } catch (err) {
    console.error('Väljakute nimede pilvest laadimine ebaõnnestus', err);
  }
  return loadCourtNames();
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
