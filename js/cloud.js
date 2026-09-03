// Valikuline pilve-sünkroonimine (Firebase Firestore) + sisselogimine (Google), et
// jagamislingid töötaksid igalt poolt ja uueneksid automaatselt, ning et sisse logides
// näeks oma varasemaid turniire ka teisest arvutist/seadmest. Kui js/firebase-config.js
// pole täidetud, käitub äpp täpselt nagu enne — ainult kohalikus brauseris (localStorage).
import { firebaseConfig } from './firebase-config.js';

const SDK_VERSION = '10.12.2';
let ctxPromise = null;
let authCtxPromise = null;
let currentUser; // undefined = pole veel teada, null = välja logitud, objekt = sisse logitud
const authListeners = [];

export function isCloudConfigured() {
  return !!(firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith('PASTE_'));
}

function loadContext() {
  if (!ctxPromise) {
    ctxPromise = (async () => {
      const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`);
      const { getFirestore, doc, setDoc, getDoc, deleteDoc, onSnapshot, collection, query, where, getDocs } = await import(
        `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`
      );
      const app = initializeApp(firebaseConfig);
      const db = getFirestore(app);
      return { app, db, doc, setDoc, getDoc, deleteDoc, onSnapshot, collection, query, where, getDocs };
    })();
  }
  return ctxPromise;
}

function loadAuth() {
  if (!authCtxPromise) {
    authCtxPromise = (async () => {
      const ctx = await loadContext();
      const { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } = await import(
        `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js`
      );
      const auth = getAuth(ctx.app);
      onAuthStateChanged(auth, (user) => {
        currentUser = user;
        authListeners.forEach((cb) => cb(user));
      });
      return { auth, GoogleAuthProvider, signInWithPopup, signOut };
    })();
  }
  return authCtxPromise;
}

// Kui pilv on seadistatud, hakka kohe kasutaja olekut jälgima (et "Logi sisse" nupp
// teaks õigesti näidata, isegi kui keegi otse "Minu turniirid" vaadet ei ava).
if (isCloudConfigured()) loadAuth();

export function getCurrentUser() {
  return currentUser;
}

// cb(user) — user on null kui välja logitud, muidu Firebase kasutaja objekt.
// Tagastab unsubscribe-funktsiooni.
export function onAuthChange(cb) {
  authListeners.push(cb);
  loadAuth();
  if (currentUser !== undefined) cb(currentUser);
  return () => {
    const i = authListeners.indexOf(cb);
    if (i >= 0) authListeners.splice(i, 1);
  };
}

export async function signInWithGoogle() {
  const { auth, GoogleAuthProvider, signInWithPopup } = await loadAuth();
  await signInWithPopup(auth, new GoogleAuthProvider());
}

export async function signOutUser() {
  const { auth, signOut } = await loadAuth();
  await signOut(auth);
}

// Kirjutab kogu turniiri oleku pilve (täielik ülekirjutus, mitte osaline liitmine).
export async function cloudSave(tournament) {
  if (!isCloudConfigured()) return false;
  const ctx = await loadContext();
  const ref = ctx.doc(ctx.db, 'tournaments', tournament.id);
  await ctx.setDoc(ref, tournament);
  return true;
}

export async function cloudDelete(id) {
  if (!isCloudConfigured()) return false;
  const ctx = await loadContext();
  const ref = ctx.doc(ctx.db, 'tournaments', id);
  await ctx.deleteDoc(ref);
  return true;
}

// Väljakute nimed on seotud KASUTAJA (mitte turniiri) küljes, et neid ei peaks iga
// uue turniiri juures uuesti sisestama — hoitakse eraldi 'userSettings' kollektsioonis,
// dokumendi id on kasutaja uid.
export async function saveCourtNames(names) {
  if (!isCloudConfigured() || !currentUser) return false;
  const ctx = await loadContext();
  const ref = ctx.doc(ctx.db, 'userSettings', currentUser.uid);
  await ctx.setDoc(ref, { courtNames: names }, { merge: true });
  return true;
}

export async function getCourtNames(uid) {
  if (!isCloudConfigured() || !uid) return [];
  const ctx = await loadContext();
  const ref = ctx.doc(ctx.db, 'userSettings', uid);
  const snap = await ctx.getDoc(ref);
  return snap.exists() ? snap.data().courtNames || [] : [];
}

export async function cloudGet(id) {
  if (!isCloudConfigured()) return null;
  const ctx = await loadContext();
  const ref = ctx.doc(ctx.db, 'tournaments', id);
  const snap = await ctx.getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

// Kõik turniirid, mille see sisse logitud kasutaja on loonud (mistahes seadmest).
export async function queryMyTournaments(uid) {
  if (!isCloudConfigured() || !uid) return [];
  const ctx = await loadContext();
  const q = ctx.query(ctx.collection(ctx.db, 'tournaments'), ctx.where('ownerUid', '==', uid));
  const snap = await ctx.getDocs(q);
  return snap.docs.map((d) => d.data());
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
