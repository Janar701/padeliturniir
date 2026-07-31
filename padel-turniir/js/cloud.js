// Valikuline pilve-sünkroonimine (Firebase Firestore), et jagamislingid töötaksid
// igalt poolt (mitte ainult samas WiFi-võrgus) ja uueneksid automaatselt kõigil,
// kellel link on. Kui js/firebase-config.js pole täidetud, käitub äpp täpselt
// nagu enne — ainult kohalikus brauseris (localStorage), jagamine ei tööta.
import { firebaseConfig } from './firebase-config.js';

const SDK_VERSION = '10.12.2';
let ctxPromise = null;

export function isCloudConfigured() {
  return !!(firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith('PASTE_'));
}

function loadContext() {
  if (!ctxPromise) {
    ctxPromise = (async () => {
      const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`);
      const { getFirestore, doc, setDoc, getDoc, onSnapshot } = await import(
        `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`
      );
      const app = initializeApp(firebaseConfig);
      const db = getFirestore(app);
      return { db, doc, setDoc, getDoc, onSnapshot };
    })();
  }
  return ctxPromise;
}

// Kirjutab kogu turniiri oleku pilve (täielik ülekirjutus, mitte osaline liitmine).
export async function cloudSave(tournament) {
  if (!isCloudConfigured()) return false;
  const ctx = await loadContext();
  const ref = ctx.doc(ctx.db, 'tournaments', tournament.id);
  await ctx.setDoc(ref, tournament);
  return true;
}

export async function cloudGet(id) {
  if (!isCloudConfigured()) return null;
  const ctx = await loadContext();
  const ref = ctx.doc(ctx.db, 'tournaments', id);
  const snap = await ctx.getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

// Kutsub callback'i kohe (praeguse seisuga) ja iga kord, kui keegi teine dokumenti muudab.
// Tagastab unsubscribe-funktsiooni.
export async function cloudWatch(id, callback) {
  if (!isCloudConfigured()) return () => {};
  const ctx = await loadContext();
  const ref = ctx.doc(ctx.db, 'tournaments', id);
  return ctx.onSnapshot(
    ref,
    (snap) => {
      if (snap.exists()) callback(snap.data());
    },
    (err) => {
      console.error('Pilve jälgimine ebaõnnestus', err);
      window.dispatchEvent(new CustomEvent('cloud-error', { detail: err.message }));
    }
  );
}
