import * as State from './state.js';
import * as Schedule from './schedule.js';
import { computeStandings, computeTeamStandings, computeScheduledCounts, computeTeamScheduledCounts, findLeaderWithTieInfo, methodLabel } from './standings.js';
import { buildViewUrl, buildEditUrl, parseShareHash } from './share.js';
import { isCloudConfigured, cloudGet, cloudWatch, queryMyTournaments, getCurrentUser, onAuthChange, signInWithGoogle, signOutUser, recordUsage, getAllUserSettings, getAllTournaments } from './cloud.js';
import { uid, shuffle } from './util.js';

const appEl = document.getElementById('app');
// Sinu enda konto e-mail — ainult sellel kontol näidatakse "Admin" vaadet
// (kasutuse jälgimine: millal keegi äppi kasutanud on ja kas turniirid lõpuni mängiti).
const ADMIN_EMAIL = 'janar.meho@gmail.com';
const badgeEl = document.getElementById('viewOnlyBadge');
const liveBadgeEl = document.getElementById('liveBadge');
const cloudErrorEl = document.getElementById('cloudErrorBanner');
const authAreaEl = document.getElementById('authArea');
const homeLink = document.getElementById('homeLink');

let pendingPlayers = [];
let teamOrder = [];
let liveUnsub = null;
let liveTournamentId = null;
let cloudErrorTimer = null;

window.addEventListener('cloud-error', (e) => {
  cloudErrorEl.textContent = '⚠️ Pilve sünkroonimine ebaõnnestus: ' + (e.detail || 'tundmatu viga');
  cloudErrorEl.classList.remove('hidden');
  clearTimeout(cloudErrorTimer);
  cloudErrorTimer = setTimeout(() => cloudErrorEl.classList.add('hidden'), 8000);
});

// --- Sisselogimine (Google) — et "Minu turniirid" oleks nähtav ka teisest seadmest ---
function renderAuthArea(user) {
  if (!isCloudConfigured() || user === undefined) {
    authAreaEl.innerHTML = '';
    return;
  }
  if (user) {
    authAreaEl.innerHTML = `
      <span class="auth-user">${user.photoURL ? `<img class="auth-avatar" src="${escapeHtml(user.photoURL)}" alt="" />` : ''}${escapeHtml(user.displayName || user.email || 'Kasutaja')}</span>
      <button class="btn btn-secondary small" id="authLogoutBtn">Logi välja</button>`;
    document.getElementById('authLogoutBtn').addEventListener('click', () => signOutUser());
  } else {
    authAreaEl.innerHTML = `<button class="btn btn-secondary small" id="authLoginBtn">Logi sisse Google'iga</button>`;
    document.getElementById('authLoginBtn').addEventListener('click', () => {
      signInWithGoogle().catch((err) => {
        cloudErrorEl.textContent = "⚠️ Sisselogimine ebaõnnestus: " + err.message;
        cloudErrorEl.classList.remove('hidden');
      });
    });
  }
}

onAuthChange((user) => {
  renderAuthArea(user);
  if (document.getElementById('newBtn')) renderHome();
});

function stopLiveSync() {
  if (liveUnsub) liveUnsub();
  liveUnsub = null;
  liveTournamentId = null;
  liveBadgeEl.classList.add('hidden');
}

// --- Vooruaja märguanne: hüpikaknad loevad sekundeid maha ja arvuti räägib ---
let roundTimerHandle = null;
let roundTimerTournamentId = null;
let closedEndRounds = new Set();
let closedStartRounds = new Set();
let currentEndRoundIdx = null;
let currentStartRoundIdx = null;

const endPopupEl = document.getElementById('endCountdownPopup');
const endPopupNumberEl = document.getElementById('endCountdownNumber');
const startPopupEl = document.getElementById('startCountdownPopup');
const startPopupNumberEl = document.getElementById('startCountdownNumber');

function speak(text) {
  if (!window.speechSynthesis) return;
  try {
    speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  } catch (e) {
    // TTS pole saadaval — vaikimisi jätame vahele
  }
}

function showEndPopup(seconds) {
  endPopupNumberEl.textContent = seconds;
  endPopupEl.classList.remove('hidden');
}
function hideEndPopup() {
  endPopupEl.classList.add('hidden');
  currentEndRoundIdx = null;
}
function showStartPopup(seconds) {
  startPopupNumberEl.textContent = seconds;
  startPopupEl.classList.remove('hidden');
}
function hideStartPopup() {
  startPopupEl.classList.add('hidden');
  currentStartRoundIdx = null;
}

document.getElementById('endCountdownClose').addEventListener('click', () => {
  if (currentEndRoundIdx != null) closedEndRounds.add(currentEndRoundIdx);
  hideEndPopup();
});
document.getElementById('startCountdownClose').addEventListener('click', () => {
  if (currentStartRoundIdx != null) closedStartRounds.add(currentStartRoundIdx);
  hideStartPopup();
});

function stopRoundTimer() {
  if (roundTimerHandle) clearInterval(roundTimerHandle);
  roundTimerHandle = null;
  roundTimerTournamentId = null;
  hideEndPopup();
  hideStartPopup();
}

// Käivitatakse turniirivaate lõpus. Viimasel 60 sekundil enne vooru lõppu näidatakse
// suletavat hüpikakent koos maha loendusega; kui aeg saab läbi, öeldakse "STOP".
// Viimasel 10 sekundil enne järgmise vooru algust näidatakse teist hüpikakent; kui
// mäng peaks algama, öeldakse "START". Ei anna tagantjärele märku juba möödunud piiridest.
function startRoundTimer(t) {
  if (roundTimerTournamentId === t.id) return;
  stopRoundTimer();
  if (t.phase !== 'group' || !t.slots.length || !t.settings.startTime) return;
  roundTimerTournamentId = t.id;
  const windows = roundTimeWindows(t);
  const firedEnd = new Set();
  const firedStart = new Set();
  closedEndRounds = new Set();
  closedStartRounds = new Set();

  roundTimerHandle = setInterval(() => {
    const now = new Date();

    let endShown = false;
    windows.forEach((w, i) => {
      const msLeft = w.end - now;
      if (msLeft <= 60000 && msLeft > -3000 && !closedEndRounds.has(i)) {
        currentEndRoundIdx = i;
        showEndPopup(Math.max(0, Math.ceil(msLeft / 1000)));
        endShown = true;
      }
      if (msLeft <= 0 && msLeft > -3000 && !firedEnd.has(i)) {
        firedEnd.add(i);
        speak('STOP');
      }
    });
    if (!endShown) hideEndPopup();

    let startShown = false;
    windows.forEach((w, i) => {
      const msLeft = w.start - now;
      if (msLeft <= 10000 && msLeft > -3000 && !closedStartRounds.has(i)) {
        currentStartRoundIdx = i;
        showStartPopup(Math.max(0, Math.ceil(msLeft / 1000)));
        startShown = true;
      }
      if (msLeft <= 0 && msLeft > -3000 && !firedStart.has(i)) {
        firedStart.add(i);
        speak('START');
      }
    });
    if (!startShown) hideStartPopup();
  }, 1000);
}

// Kutsutakse iga turniiri-/play-off-vaate lõpus. Kui Firebase on seadistatud, jälgitakse
// dokumenti reaalajas ja vaade joonistatakse ümber, kui keegi (kaasa arvatud sina ise mõnes
// teises seadmes) andmeid muudab. Ei sega kasutajat, kui ta parajasti mõnda välja täidab.
function startLiveSync(t, opts) {
  if (!isCloudConfigured()) return;
  if (liveTournamentId === t.id) return;
  stopLiveSync();
  liveTournamentId = t.id;
  liveBadgeEl.classList.remove('hidden');
  cloudWatch(t.id, (data) => {
    const active = document.activeElement;
    const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
    if (typing) return;
    renderTournamentOrPlayoff(data, opts);
  }).then((unsub) => {
    if (liveTournamentId === t.id) liveUnsub = unsub;
    else unsub();
  });
}

function renderTournamentOrPlayoff(t, opts) {
  const usesPlayoffScreen = t.settings.finalists > 0 && (t.phase === 'playoffs' || t.phase === 'done');
  if (usesPlayoffScreen) renderPlayoffScreen(t, opts);
  else renderTournamentScreen(t, opts);
}

homeLink.addEventListener('click', (e) => {
  e.preventDefault();
  stopLiveSync();
  stopRoundTimer();
  badgeEl.classList.add('hidden');
  history.replaceState(null, '', window.location.pathname + window.location.search);
  renderHome();
});

async function init() {
  const shared = parseShareHash();
  if (!shared) {
    renderHome();
    return;
  }
  if (!isCloudConfigured()) {
    appEl.innerHTML = `<div class="card"><h1>Jagamine pole veel seadistatud</h1><p class="muted">Selle lingi avamiseks peab rakenduse omanik seadistama Firebase'i — vaata README.md "Firebase seadistamine" jaotist.</p></div>`;
    return;
  }
  appEl.innerHTML = `<div class="card"><p class="muted">Laen turniiri…</p></div>`;
  let data;
  try {
    data = await cloudGet(shared.id);
  } catch (err) {
    appEl.innerHTML = `<div class="card"><h1>Viga turniiri laadimisel</h1><p class="muted">${escapeHtml(err.message)}</p></div>`;
    return;
  }
  if (!data) {
    appEl.innerHTML = `<div class="card"><h1>Turniiri ei leitud</h1><p class="muted">Link võib olla vale või turniir kustutatud.</p></div>`;
    return;
  }
  if (!shared.isEdit) badgeEl.classList.remove('hidden');
  renderTournamentOrPlayoff(data, { readOnly: !shared.isEdit });
}

function nameForPlayer(t, id) {
  const p = t.players.find((x) => x.id === id);
  return p ? p.name : '???';
}

// Kolm formaati: 'singles' (üksikmäng), 'doubles_fixed' (paarismäng, kindel paariline —
// määratud registreerimisel), 'doubles_draw' (paarismäng, loositav paariline).
function isDoublesFormat(format) {
  return format === 'doubles_fixed' || format === 'doubles_draw';
}

function formatLabel(format) {
  if (format === 'doubles_fixed') return 'Paarismäng (kindel paariline)';
  if (format === 'doubles_draw') return 'Paarismäng (loositav paariline)';
  return 'Üksikmäng';
}

// Play-off "üksuseks" on paarismängus fikseeritud paar, üksikmängus (Americano) aga
// play-off'i jaoks eraldi moodustatud ajutine paar (vt seedAmericanoPlayoffTeams) —
// mõlemal juhul mängitakse play-off 2 vs 2, sest padelit ei saa mängida üksi.
function nameForEntity(t, id) {
  if (isDoublesFormat(t.settings.format) && t.teams) {
    const team = t.teams.find((tm) => tm.id === id);
    if (team) return sideLabel(t, team.playerIds);
  }
  if (t.playoffTeams) {
    const team = t.playoffTeams.find((tm) => tm.id === id);
    if (team) return sideLabel(t, team.playerIds);
  }
  return nameForPlayer(t, id);
}

function sideLabel(t, ids) {
  return ids.map((id) => nameForPlayer(t, id)).join(' & ');
}

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('et-EE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtTime(d) {
  return d.toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtDateTime(ts) {
  if (!ts) return '—';
  return `${fmtDate(ts)} ${fmtTime(new Date(ts))}`;
}

// Iga vooru alguse/lõpuaeg turniiri algusaja ning mängu+pausi pikkuse järgi.
function roundTimeWindows(t) {
  const [h, m] = (t.settings.startTime || '09:00').split(':').map((x) => parseInt(x, 10) || 0);
  const base = new Date();
  base.setHours(h, m, 0, 0);
  const matchMin = t.settings.matchMinutes || 0;
  const pauseMin = t.settings.pauseMinutes || 0;
  // Kui võrdsuse tagamiseks lühendati mõnda vooru 1 minuti võrra (vt resolveExactRoundPlan),
  // arvutatakse iga vooru enda kestuse järgi järjest, mitte ühtse kordajaga.
  const shortenedRounds = Schedule.distributeShortenedRounds(t.slots.length, t.settings.shortenedCount || 0);
  let cursor = base.getTime();
  return t.slots.map((_, i) => {
    const durationMin = shortenedRounds.has(i) ? Math.max(1, matchMin - 1) : matchMin;
    const start = new Date(cursor);
    const end = new Date(start.getTime() + durationMin * 60000);
    cursor = end.getTime() + pauseMin * 60000;
    return { start, end };
  });
}

// ---------------------------------------------------------------------------
// KODU
// ---------------------------------------------------------------------------
async function renderHome() {
  stopLiveSync();
  stopRoundTimer();
  const user = getCurrentUser();
  if (user) {
    appEl.innerHTML = `<div class="card"><p class="muted">Laen sinu turniire…</p></div>`;
    try {
      const cloudTournaments = await queryMyTournaments(user.uid);
      State.cacheTournaments(cloudTournaments);
      await State.syncCourtNamesFromCloud(user.uid);
    } catch (err) {
      console.error('Minu turniiride laadimine ebaõnnestus', err);
    }
    // "Millal kasutas" jälgimiseks — ei blokeeri lehe laadimist, kui ebaõnnestub.
    recordUsage(user).catch((err) => console.error('Kasutuse salvestamine ebaõnnestus', err));
  }
  const isAdmin = !!(user && user.email === ADMIN_EMAIL);
  const tournaments = State.loadAll();
  appEl.innerHTML = `
    <div class="card">
      <div class="row-between">
        <h1>Minu turniirid</h1>
        <div class="row-gap">
          ${isAdmin ? `<button class="btn btn-secondary" id="adminBtn">🛡️ Admin</button>` : ''}
          ${user ? `<button class="btn btn-secondary" id="courtNamesBtn">🏟️ Väljakute nimed</button>` : ''}
          <button class="btn btn-primary" id="newBtn">+ Loo uus turniir</button>
        </div>
      </div>
      ${user ? `<div id="courtNamesBox" class="hidden"></div>` : ''}
      ${
        isCloudConfigured() && !user
          ? `<p class="muted small">💡 Logi ülal paremal sisse, et näha oma turniire ka teisest arvutist või telefonist.</p>`
          : ''
      }
      ${
        tournaments.length === 0
          ? `<p class="muted">Ühtegi turniiri pole veel loodud.</p>`
          : `<div class="list">
              ${tournaments
                .map(
                  (t) => `
                <div class="list-item" data-id="${t.id}">
                  <div>
                    <strong>${escapeHtml(t.name)}</strong>
                    <div class="muted small">${fmtDate(t.createdAt)} · ${formatLabel(t.settings.format)} · ${t.players.length} mängijat · ${t.phase === 'setup' ? 'seadistamata' : t.phase === 'group' ? 'käimas' : t.phase === 'playoffs' ? 'play-off' : 'lõppenud'}</div>
                  </div>
                  <div class="row-gap">
                    <button class="btn btn-secondary open-btn" data-id="${t.id}">Ava</button>
                    <button class="btn btn-danger del-btn" data-id="${t.id}">Kustuta</button>
                  </div>
                </div>`
                )
                .join('')}
            </div>`
      }
    </div>
  `;
  document.getElementById('newBtn').addEventListener('click', () => renderSettingsScreen(null));
  const adminBtn = document.getElementById('adminBtn');
  if (adminBtn) adminBtn.addEventListener('click', () => renderAdminScreen());
  const courtNamesBtn = document.getElementById('courtNamesBtn');
  if (courtNamesBtn) {
    courtNamesBtn.addEventListener('click', () => {
      const box = document.getElementById('courtNamesBox');
      const isHidden = box.classList.contains('hidden');
      box.classList.toggle('hidden');
      if (isHidden) renderCourtNamesEditor(box);
    });
  }
  appEl.querySelectorAll('.open-btn').forEach((b) =>
    b.addEventListener('click', () => {
      const t = State.getTournament(b.dataset.id);
      if (t.phase === 'setup') renderSettingsScreen(t);
      else renderTournamentOrPlayoff(t, { readOnly: false });
    })
  );
  appEl.querySelectorAll('.del-btn').forEach((b) =>
    b.addEventListener('click', async () => {
      if (confirm('Kustutada see turniir jäädavalt?')) {
        await State.deleteTournament(b.dataset.id);
        renderHome();
      }
    })
  );
}

// Väljakute nimede haldus (ainult sisselogitud kasutajale) — nimed käivad kasutaja
// kontoga kaasas (pilve sünkroonitud), et neid ei peaks iga uue turniiri juures
// uuesti sisestama. Tühjaks jäetud nimega väljak näitab ajakavas lihtsalt numbrit.
function renderCourtNamesEditor(box) {
  let names = State.loadCourtNames();
  const draw = () => {
    box.innerHTML = `
      <div class="card">
        <h3>Väljakute nimed</h3>
        <p class="muted small">Anna oma väljakutele nimed (nt "Kesk", "A-väljak") — need jäävad meelde ja kehtivad kõigi tulevaste turniiride ajakavas. Tühjaks jäetud väljak näitab lihtsalt numbrit.</p>
        <div class="list" id="courtNameRows">
          ${names
            .map(
              (name, i) => `
            <div class="row-gap">
              <span class="court-badge">${i + 1}</span>
              <input type="text" class="court-name-input" data-idx="${i}" value="${escapeHtml(name)}" placeholder="Väljak ${i + 1}" />
              <button class="btn btn-secondary small remove-court-btn" data-idx="${i}" type="button">✕</button>
            </div>`
            )
            .join('')}
        </div>
        <div class="row-gap">
          <button class="btn btn-secondary" id="addCourtNameBtn" type="button">+ Lisa väljak</button>
          <button class="btn btn-primary" id="saveCourtNamesBtn" type="button">Salvesta</button>
        </div>
      </div>
    `;
    box.querySelectorAll('.court-name-input').forEach((inp) =>
      inp.addEventListener('input', (e) => {
        names[parseInt(e.target.dataset.idx, 10)] = e.target.value;
      })
    );
    box.querySelectorAll('.remove-court-btn').forEach((b) =>
      b.addEventListener('click', () => {
        names.splice(parseInt(b.dataset.idx, 10), 1);
        draw();
      })
    );
    document.getElementById('addCourtNameBtn').addEventListener('click', () => {
      names.push('');
      draw();
    });
    document.getElementById('saveCourtNamesBtn').addEventListener('click', () => {
      State.saveCourtNames(names.map((n) => n.trim()));
      box.classList.add('hidden');
    });
  };
  draw();
}

// Turniir loetakse "lõpuni mängituks", kui VIIMASE vooru kõigil mängudel on tulemus
// sisestatud — sõltumata sellest, kas keegi vajutas ka "Lõpeta turniir" nuppu (see
// jätab käsitsi tegemata jäetud lõpetamise tuvastamata, kui skoorid on tegelikult olemas).
function isTournamentCompleted(t) {
  if (!t.slots || !t.slots.length) return false;
  const lastSlot = t.slots[t.slots.length - 1];
  if (!lastSlot || !lastSlot.matches || !lastSlot.matches.length) return false;
  return lastSlot.matches.every((m) => m.score1 != null && m.score2 != null);
}

// Admin-vaade (ainult ADMIN_EMAIL kontole): näitab iga kasutaja jaoks, millal ta
// viimati äppi kasutas ja millised turniirid ta lõi (ning kas need lõpuni mängiti).
async function renderAdminScreen() {
  stopLiveSync();
  stopRoundTimer();
  appEl.innerHTML = `<div class="card"><p class="muted">Laen kasutuse andmeid…</p></div>`;
  let users = [];
  let tournaments = [];
  try {
    [users, tournaments] = await Promise.all([getAllUserSettings(), getAllTournaments()]);
  } catch (err) {
    appEl.innerHTML = `
      <div class="card">
        <h1>Viga andmete laadimisel</h1>
        <p class="muted">${escapeHtml(err.message)}</p>
        <button class="btn btn-secondary" id="backHomeBtn">← Tagasi</button>
      </div>`;
    document.getElementById('backHomeBtn').addEventListener('click', () => renderHome());
    return;
  }

  const tournamentsByUid = {};
  tournaments.forEach((t) => {
    const key = t.ownerUid || '__anon__';
    (tournamentsByUid[key] = tournamentsByUid[key] || []).push(t);
  });
  const usersByUid = {};
  users.forEach((u) => { usersByUid[u.id] = u; });

  // TÄHTIS: koonda KÕIK teadaolevad kasutaja-UID-d, mitte ainult need, kellel juba
  // on userSettings kirje — kasutaja, kes logis sisse ENNE kasutuse jälgimise
  // lisamist (või kelle esimene külastus veel salvestamata), on ownerUid kaudu
  // turniiridega olemas, aga tal pole (veel) userSettings dokumenti. Kui vaataks
  // ainult userSettings nimekirja, kaoksid tema turniirid vaikselt ära (täpselt see
  // viga, mis algversioonis oli — 67 turniiri, aga ainult 1 kasutaja nähtaval).
  const knownUids = new Set([...Object.keys(usersByUid), ...Object.keys(tournamentsByUid).filter((k) => k !== '__anon__')]);
  const knownEntries = [...knownUids].map((uidKey) => {
    const u = usersByUid[uidKey] || null;
    const userTournaments = (tournamentsByUid[uidKey] || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return { uid: uidKey, user: u, tournaments: userTournaments };
  });
  knownEntries.sort((a, b) => {
    const aTime = (a.user && a.user.lastActiveAt) || (a.tournaments[0] && a.tournaments[0].createdAt) || 0;
    const bTime = (b.user && b.user.lastActiveAt) || (b.tournaments[0] && b.tournaments[0].createdAt) || 0;
    return bTime - aTime;
  });
  const anonTournaments = (tournamentsByUid['__anon__'] || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const tournamentTableHtml = (list) => `
    <table class="table">
      <thead><tr><th>Turniir</th><th>Loodud</th><th>Staatus</th></tr></thead>
      <tbody>
        ${list
          .map(
            (t) => `<tr>
              <td>${escapeHtml(t.name || '')}</td>
              <td>${fmtDateTime(t.createdAt)}</td>
              <td>${isTournamentCompleted(t) ? '✅ Lõpetatud' : t.phase === 'done' ? '🏁 Märgitud lõppenuks' : '⏳ Pooleli'}</td>
            </tr>`
          )
          .join('')}
      </tbody>
    </table>`;

  const userCards = knownEntries
    .map(({ uid: uidKey, user: u, tournaments: userTournaments }) => {
      const completedCount = userTournaments.filter(isTournamentCompleted).length;
      const label = u ? u.displayName || u.email || uidKey : `Tundmatu kasutaja (${uidKey})`;
      const activityLine = u
        ? `Viimati aktiivne: ${fmtDateTime(u.lastActiveAt)} · Külastusi: ${u.visitCount || 0} · Turniire: ${userTournaments.length} (lõpetatud ${completedCount})`
        : `Kasutuse jälgimist pole (logis sisse enne selle lisamist) · Turniire: ${userTournaments.length} (lõpetatud ${completedCount})`;
      return `
        <div class="card">
          <div>
            <strong>${escapeHtml(label)}</strong>${u && u.email && u.displayName ? `<span class="muted small"> · ${escapeHtml(u.email)}</span>` : ''}
            <div class="muted small">${activityLine}</div>
          </div>
          ${userTournaments.length ? tournamentTableHtml(userTournaments) : `<p class="muted small">Ühtegi turniiri veel loodud.</p>`}
        </div>`;
    })
    .join('');

  const anonCard = anonTournaments.length
    ? `<div class="card">
        <strong>Sisselogimata kasutajad</strong>
        <div class="muted small">Need turniirid on loodud ilma sisse logimata — kasutajat ei saa tuvastada. Turniire: ${anonTournaments.length} (lõpetatud ${anonTournaments.filter(isTournamentCompleted).length})</div>
        ${tournamentTableHtml(anonTournaments)}
      </div>`
    : '';

  appEl.innerHTML = `
    <div class="card">
      <div class="row-between">
        <h1>Admin — kasutuse jälgimine</h1>
        <button class="btn btn-secondary" id="backHomeBtn">← Tagasi</button>
      </div>
      <p class="muted small">${knownEntries.length} teadaolevat kasutajat${anonTournaments.length ? ` + sisselogimata turniirid` : ''}, ${tournaments.length} turniiri kokku.</p>
    </div>
    ${anonCard}
    ${userCards}
  `;
  document.getElementById('backHomeBtn').addEventListener('click', () => renderHome());
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Pingerea "Punktid" veerg: tavaliselt kogutud geimipunktid (skooride summa), aga kui
// seadistuses on valitud punktisüsteem (võit 4p, viik 2p, kaotus 0p), näita hoopis
// selle süsteemi järgi kogunenud punkte — eraldi loogika ainult selle valiku jaoks.
function standingsPoints(r, winnerRule) {
  return winnerRule === 'leaguePoints' ? r.wins * 4 + r.draws * 2 : r.pointsFor;
}

// ---------------------------------------------------------------------------
// SEADED (eraldi ekraan)
// ---------------------------------------------------------------------------
// Üksikmängus tähendab "finalistid" mängijaid (min 4). Paarismängus tähendab see
// paare — paarilised on fikseeritud, seega "Top 2" tähendab 2 paari (4 mängijat) finaalis.
function finalistsOptions(format) {
  return isDoublesFormat(format)
    ? [
        { value: 0, label: "Ei mängita play-off'i — võitja on kõige rohkem punkte kogunud paar" },
        { value: 2, label: 'Top 2 paari — otse finaal' },
        { value: 4, label: 'Top 4 paari — poolfinaalid + finaal' },
        { value: 8, label: 'Top 8 paari — veerandfinaalid' },
      ]
    : [
        { value: 0, label: "Ei mängita play-off'i — võitja on kõige rohkem punkte kogunud mängija" },
        { value: 4, label: 'Top 4 — poolfinaalid + finaal' },
        { value: 8, label: 'Top 8 — veerandfinaalid' },
      ];
}

function finalistsOptionsHtml(format, selected) {
  const opts = finalistsOptions(format);
  const validValues = opts.map((o) => o.value);
  const chosen = validValues.includes(selected) ? selected : opts[0].value;
  return opts.map((o) => `<option value="${o.value}" ${o.value === chosen ? 'selected' : ''}>${o.label}</option>`).join('');
}

function finalistsHelpText(format) {
  return isDoublesFormat(format)
    ? 'Play-off toimub paaride vahel (paarilised mängivad koos ka finaalis). "Ei mängita" korral kasutatakse kogu turniiri aeg rühmamängudeks.'
    : 'Play-off mängitakse ka 2 vs 2: pingerea parim pannakse paariliseks viimasega, teine eelviimasega jne (tasavägisemad paarid), ja need paarid mängivad play-off\'i. "Ei mängita" korral kasutatakse kogu turniiri aeg rühmamängudeks.';
}

function infoIcon(tip) {
  return `<span class="info-wrap"><button type="button" class="info-btn" aria-label="Selgitus">ⓘ</button><span class="info-tip">${escapeHtml(tip)}</span></span>`;
}

function formatHelpText(format) {
  if (format === 'doubles_fixed') return 'Sina (või mängijad ise) määrate paarid juba nimekirja sisestades — järgmisel sammul sisestad otse paarid, loosimist ei toimu.';
  if (format === 'doubles_draw') return 'Paarid loositakse: sisestad kaks nimekirja (Veerg 1 ja Veerg 2) ning iga Veeru 1 mängija paaritatakse loositud Veeru 2 mängijaga.';
  return 'Americano: mängitakse alati 2 vs 2 (padelit ei saa üksi mängida), aga paariline ja vastased loositakse iga vooru uuesti, nii et kõik saavad võimalikult erinevad paarilised ja vastased. Vaja vähemalt 4 mängijat.';
}

// Ühe mänguaja-valiku kuvatav silt (kasutatakse nii americano kui lõdva paarismängu
// "kuni 5 valiku" raadionuppude jaoks) — unitSize: 4 americanos (2 paari mängijatest),
// 2 paarismängus (paar ise on juba pool mängust).
function formatMatchOptionLabel(opt, unitSize, fullMatchesPerSlot, extraTail) {
  const lastMatchesUsed = Math.floor((opt.lastRoundCapacity ?? fullMatchesPerSlot * unitSize) / unitSize);
  const shortNote =
    opt.shortenedCount > 0
      ? opt.shortenedCount === 1
        ? ', 1 voor on 1 min lühem'
        : `, ${opt.shortenedCount} vooru on 1 min lühemad`
      : '';
  const lastRoundNote = lastMatchesUsed < fullMatchesPerSlot ? `, viimases voorus ${lastMatchesUsed}/${fullMatchesPerSlot} väljakut` : '';
  const tail = typeof extraTail === 'function' ? extraTail(opt) : extraTail || '';
  return `${opt.matchMinutes} min (${opt.rounds} vooru${shortNote}${lastRoundNote}${tail})`;
}

// Renderdab kuni 5 mänguaja-valikut raadionuppudena computedMatchBox sisse ja seob
// muutuse kuulaja, mis kutsub onPick(valitudOptsioon) ilma kogu ajakava uuesti arvutamata.
function renderMatchOptionsRadios(box, options, unitSize, fullMatchesPerSlot, extraTail, onPick) {
  box.innerHTML = `<div class="radio-group">${options
    .map(
      (opt, i) =>
        `<label><input type="radio" name="f_matchoption" value="${i}" ${i === 0 ? 'checked' : ''}/> ${formatMatchOptionLabel(opt, unitSize, fullMatchesPerSlot, extraTail)}</label>`
    )
    .join('')}</div>`;
  box.querySelectorAll('input[name="f_matchoption"]').forEach((radio) =>
    radio.addEventListener('change', () => {
      if (radio.checked) onPick(options[parseInt(radio.value, 10)]);
    })
  );
  onPick(options[0]);
}

function renderSettingsScreen(existing) {
  stopLiveSync();
  stopRoundTimer();
  const s = existing
    ? existing.settings
    : {
        name: 'Padeliturniir',
        format: 'doubles_draw',
        tournamentMinutes: 120,
        pauseMinutes: 1,
        matchMinutes: 12,
        courts: 2,
        playersCount: 8,
        startTime: '09:00',
        finalists: 0,
        winnerRule: 'wins',
      };

  appEl.innerHTML = `
    <div class="card">
      <h1>Seaded</h1>
      <p class="muted">Määra turniiri raamistik. Mängijate nimed lisad järgmisel sammul.</p>

      <div class="field">
        <label>Turniiri nimi ${infoIcon('Kuvatakse pealkirjana kõigile, kes turniiri vaatavad või jagamislingi avavad.')}</label>
        <input type="text" id="f_name" value="${escapeHtml(s.name)}" />
      </div>

      <div class="field">
        <label>Formaat ${infoIcon('Üksikmäng (Americano): mängitakse 2 vs 2, aga paariline ja vastased loositakse iga vooru uuesti. Paarismäng kindla paarilisega: paarid on juba enne teada. Paarismäng loositava paarilisega: paarid loositakse osalejate seast.')}</label>
        <div class="radio-group">
          <label><input type="radio" name="f_format" value="singles" ${s.format === 'singles' ? 'checked' : ''}/> Üksikmäng</label>
          <label><input type="radio" name="f_format" value="doubles_fixed" ${s.format === 'doubles_fixed' ? 'checked' : ''}/> Paarismäng — kindel paariline</label>
          <label><input type="radio" name="f_format" value="doubles_draw" ${s.format === 'doubles_draw' || !s.format ? 'checked' : ''}/> Paarismäng — loositav paariline</label>
        </div>
        <p class="muted small" id="formatHelp">${formatHelpText(s.format)}</p>
      </div>

      <div class="grid-4">
        <div class="field">
          <label>Turniiri pikkus (min) ${infoIcon('Kogu turniiri kestus algusest lõpuni, minutites (kaasa arvatud pausid mängude vahel).')}</label>
          <input type="number" id="f_tmin" min="10" step="5" value="${s.tournamentMinutes}" />
        </div>
        <div class="field">
          <label>Pausi pikkus (min) ${infoIcon('Paus mängude vahel, nt väljaku vahetuseks. Pikem paus tähendab lühemat arvutatud mängu pikkust.')}</label>
          <select id="f_pause">
            ${[0, 1, 2, 3, 4, 5].map((v) => `<option value="${v}" ${s.pauseMinutes == v ? 'selected' : ''}>${v} min</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Väljakute arv ${infoIcon('Mitu mängu saab samal ajal käia (nii palju padeliväljakuid on kasutada).')}</label>
          <input type="number" id="f_courts" min="1" step="1" value="${s.courts}" />
          <p class="muted small" id="courtsHint"></p>
        </div>
        <div class="field">
          <label>Mängijate arv ${infoIcon('Kokku osalejate arv. Paarismängus peab olema paarisarv.')}</label>
          <input type="number" id="f_players" min="2" step="1" value="${s.playersCount}" />
        </div>
      </div>

      <div class="grid-2">
        <div class="field">
          <label>Mängu pikkus ${infoIcon('Arvutatakse automaatselt turniiri pikkuse, pausi, väljakute ja mängijate arvu järgi, nii et kõik jõuaksid kõigiga mängida.')}</label>
          <div id="computedMatchBox" class="computed-box"></div>
          <p class="muted small" id="matchCoverageHint"></p>
        </div>
        <div class="field">
          <label>Turniiri algus, 24h kellaaeg ${infoIcon('Millal esimene voor algab (nt pealelõunal kell üks = 13:00). Kasutatakse voorude alguse/lõpu aegade ja mänguaja lõppemise märguande jaoks.')}</label>
          ${(() => {
            const [dh, dm] = (s.startTime || '09:00').split(':').map((x) => parseInt(x, 10) || 0);
            const hourOpts = Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === dh ? 'selected' : ''}>${String(h).padStart(2, '0')}</option>`).join('');
            const minOpts = Array.from({ length: 60 }, (_, m) => `<option value="${m}" ${m === dm ? 'selected' : ''}>${String(m).padStart(2, '0')}</option>`).join('');
            return `<div class="row-gap"><select id="f_starttime_h">${hourOpts}</select><strong>:</strong><select id="f_starttime_m">${minOpts}</select></div>`;
          })()}
        </div>
      </div>

      <div class="field">
        <label>Finaalietapp ${infoIcon('Kas ja mitu parimat lähevad turniiri lõpus omavahel play-off\'i.')}</label>
        <select id="f_finalists">${finalistsOptionsHtml(s.format, s.finalists)}</select>
        <p class="muted small" id="finalistsHelp"></p>
      </div>

      <div class="field">
        <label>Võitja selgub ${infoIcon('Määrab, mille järgi pingerida ja võitja arvutatakse. Kui valitud viisi järgi tekib viik, näidatakse lisaks, kes juhiks mõne teise arvestuse järgi.')}</label>
        <div class="radio-group">
          <label><input type="radio" name="f_winnerrule" value="wins" ${s.winnerRule === 'wins' || !s.winnerRule ? 'checked' : ''}/> Kõige rohkem võidetud mänge</label>
          <label><input type="radio" name="f_winnerrule" value="points" ${s.winnerRule === 'points' ? 'checked' : ''}/> Kõige rohkem kogutud geimipunkte (skooride summa)</label>
          <label><input type="radio" name="f_winnerrule" value="leaguePoints" ${s.winnerRule === 'leaguePoints' ? 'checked' : ''}/> Punktisüsteem: võit 4p, viik 2p, kaotus 0p</label>
        </div>
      </div>

      <p id="settingsError" class="error hidden"></p>

      <div class="row-gap">
        <button class="btn btn-secondary" id="cancelBtn">Tagasi</button>
        <button class="btn btn-primary" id="nextBtn">Edasi → Mängijad</button>
      </div>
    </div>
  `;

  // Info-nupud: klõpsuga näita/peida selgitus (töötab ka puutega, mitte ainult hiirega).
  appEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('info-btn')) {
      e.target.parentElement.classList.toggle('open');
    } else if (!e.target.closest('.info-wrap')) {
      appEl.querySelectorAll('.info-wrap.open').forEach((w) => w.classList.remove('open'));
    }
  });

  const finalistsSelect = document.getElementById('f_finalists');
  const finalistsHelp = document.getElementById('finalistsHelp');
  finalistsHelp.textContent = finalistsHelpText(s.format);
  const formatHelp = document.getElementById('formatHelp');

  let computedMatchMinutes = 0;
  let computedGroupRounds = 0;
  let computedShortenedCount = 0;
  let computedLastRoundCapacity = null; // null = kõik voorud täisvõimsusel
  function recomputeMatchLength() {
    const format = document.querySelector('input[name="f_format"]:checked').value;
    const tournamentMinutes = parseInt(document.getElementById('f_tmin').value, 10) || 0;
    const courts = parseInt(document.getElementById('f_courts').value, 10) || 0;
    const pauseMinutes = parseInt(document.getElementById('f_pause').value, 10) || 0;
    const playersCount = parseInt(document.getElementById('f_players').value, 10) || 0;
    const entityCount = isDoublesFormat(format) ? Math.floor(playersCount / 2) : playersCount;
    const box = document.getElementById('computedMatchBox');
    const courtsHint = document.getElementById('courtsHint');
    // Väljakuid saab korraga kasutada ainult nii palju, kui mängijate arv üldse mängude
    // täitmiseks lubab (paarismängus 2 paari, üksikmängus 4 mängijat ühe mängu kohta) —
    // rohkem väljakuid kui seda ei aita, need lihtsalt jäävad tühjaks. Näita seda selgelt,
    // et "väljakute arvu suurendamine ei muuda midagi" ei tunduks veana.
    if (courtsHint) {
      const unitSizeForCourts = isDoublesFormat(format) ? 2 : 4;
      const usableCourts = entityCount >= unitSizeForCourts ? Math.floor(entityCount / unitSizeForCourts) : 0;
      courtsHint.textContent =
        courts > usableCourts && usableCourts > 0
          ? `Praeguse mängijate arvuga mahub korraga käima ainult ${usableCourts} väljak${usableCourts === 1 ? '' : 'ut'} — ülejäänud jääksid mängude ajal tühjaks.`
          : '';
    }
    const matchCoverageHint = document.getElementById('matchCoverageHint');
    if (matchCoverageHint) matchCoverageHint.textContent = '';
    if (entityCount < 2 || courts < 1 || tournamentMinutes < 1) {
      computedMatchMinutes = 0;
      box.innerHTML = `<span class="muted">Täida enne teised väljad</span>`;
      return;
    }
    if (isDoublesFormat(format)) {
      // Paarismängus on täielik kate (iga paar mängib kõigi ülejäänud paaridega) eesmärk,
      // AGA mitte iga hinna eest: kui see nõuaks alla 11-minutilisi mänge (liiga palju
      // paare/liiga vähe aega), on see pikkus juba mängimiseks ebamõistlik — sellisel juhul
      // loobutakse täielikust katvusest ja täidetakse väljakud õiglaselt (iga paar mängib nii
      // palju kui mahub, aga mitte tingimata kõigiga) — sarnaselt üksikmänguga.
      const rounds = Schedule.estimateExactRoundRobinSlots(entityCount, courts);
      const gamesPerPair = entityCount - 1;
      const raw = (tournamentMinutes - (rounds - 1) * pauseMinutes) / rounds;
      const mm = Math.floor(raw);
      if (mm >= 11) {
        // mm >= 11 tagab juba mm >= 1, seega see haru annab alati mängitava tulemuse
        // (generateExactRoundRobin garanteerib täpse võrdsuse iseenesest, mitte kunagi vahet).
        computedMatchMinutes = mm;
        computedGroupRounds = 0; // täielik katvus: buildSchedule arvutab voorude arvu ise (generateExactRoundRobin)
        computedShortenedCount = 0;
        computedLastRoundCapacity = null;
        box.innerHTML = `<strong>${mm} min</strong> <span class="muted small">(iga paar mängib ${gamesPerPair} vastasega, kokku ${rounds} ajaperioodi)</span>`;
      } else {
        const options = Schedule.listRelaxedMatchOptions({ tournamentMinutes, pauseMinutes, entityCount, courts });
        if (!options.length) {
          computedMatchMinutes = 0; // blokeeri "Edasi" nupp — täpne võrdsus pole selle seadistusega saavutatav
          computedGroupRounds = 0;
          computedShortenedCount = 0;
          computedLastRoundCapacity = null;
          box.innerHTML = `<span class="error">Selle paaride arvu, väljakute ja turniiriaja juures ei ole võimalik tagada, et kõik paarid saaksid täpselt võrdse arvu mänge — pikenda turniiri, lisa väljakuid, vähenda pausi või muuda paaride arvu.</span>`;
        } else {
          const fullMatchesPerSlot = Math.max(0, Math.min(courts, Math.floor(entityCount / 2)));
          // Iga valikul (mitte kõigil ühtemoodi) tuleb eraldi kontrollida, kas SELLE
          // voorude arvuga jõuab õiglane (generateFairSlots) ajastaja täieliku katvuseni —
          // sama muster, mida americano allpool juba kasutab. Ilma selleta näidati varem
          // KÕIGIL valikutel sama "liiga palju paare" teksti, isegi kui mõni valik
          // (nt kõige rohkem voore) oleks täieliku katvuse tegelikult juba saavutanud.
          const roundsNeeded = Schedule.estimateRoundsForFullCoverage(entityCount, courts);
          const tail = (opt) => (opt.rounds >= roundsNeeded ? ', kõik paarid jõuavad kõigiga mängida' : ' — liiga palju paare, et kõik jõuaksid kõigiga mängida');
          // Kui KOGU voorude-arv (mitte väljakute arv) on täieliku katvuse takistuseks —
          // st iga väljakute arv annaks sama "ei jõua" tulemuse, sest täpne ring-turniir
          // vajab alati sama arvu voore (rounds) sõltumata väljakute arvust — selgita
          // seda otse, muidu tundub kasutajale (õigustatult), et miski on katki, kuna
          // väljakute arvu muutmine ei aita kunagi (vt "kui panen pausi 2minutiks" juhtum).
          const bestOfferedRounds = options[0] ? options[0].rounds : 0;
          if (bestOfferedRounds < rounds && matchCoverageHint) {
            const idealTotal = rounds * 11 + (rounds - 1) * pauseMinutes;
            matchCoverageHint.textContent = `Täieliku katvuse jaoks (iga paar mängib kõigi ${entityCount - 1} ülejäänud paariga) oleks vaja ${rounds} vooru, mis 11 min/mäng ja ${pauseMinutes} min pausiga võtaks ${idealTotal} min — rohkem kui praegu turniiriks planeeritud ${tournamentMinutes} min. Väljakute arvu muutmine seda ei aita (voorude arv ei sõltu väljakutest, kui neid on juba piisavalt) — pikenda turniiri või lühenda pausi, kui tahad täielikku katvust.`;
          }
          renderMatchOptionsRadios(box, options, 2, fullMatchesPerSlot, tail, (opt) => {
            computedMatchMinutes = opt.matchMinutes;
            computedGroupRounds = opt.rounds;
            computedShortenedCount = opt.shortenedCount || 0;
            const lastMatchesUsed = Math.floor((opt.lastRoundCapacity ?? fullMatchesPerSlot * 2) / 2);
            computedLastRoundCapacity = lastMatchesUsed < fullMatchesPerSlot ? opt.lastRoundCapacity : null;
          });
        }
      }
    } else {
      // Üksikmäng = Americano: mängitakse alati 2 vs 2, paarilised ja vastased loositakse
      // iga vooru uuesti. Mängu pikkus jääb 10-20 min vahemikku, vähemalt 4 mängijat vajalik.
      if (entityCount < 4) {
        computedMatchMinutes = 0;
        box.innerHTML = `<span class="error">Üksikmängus (2 vs 2, paarilised loositakse) on vaja vähemalt 4 mängijat.</span>`;
        return;
      }
      const options = Schedule.listAmericanoMatchOptions({ tournamentMinutes, pauseMinutes, playerCount: entityCount, courts });
      if (!options.length) {
        computedMatchMinutes = 0; // blokeeri "Edasi" nupp — täpne võrdsus pole selle seadistusega saavutatav
        computedGroupRounds = 0;
        computedShortenedCount = 0;
        computedLastRoundCapacity = null;
        box.innerHTML = `<span class="error">Selle mängijate arvu, väljakute ja turniiriaja juures ei ole võimalik tagada, et kõik saaksid täpselt võrdse arvu mänge — pikenda turniiri, lisa väljakuid, vähenda pausi või muuda mängijate arvu.</span>`;
      } else {
        const fullMatchesPerSlot = Math.max(0, Math.min(courts, Math.floor(entityCount / 4)));
        const roundsNeeded = Schedule.estimateAmericanoPartnerRoundsNeeded(entityCount, courts);
        const tail = (opt) => (opt.rounds >= roundsNeeded ? ', 2 vs 2, kõik saavad kõigiga vähemalt korra paariliseks' : ', 2 vs 2, võimalikult erinevate paariliste ja vastastega');
        renderMatchOptionsRadios(box, options, 4, fullMatchesPerSlot, tail, (opt) => {
          computedMatchMinutes = opt.matchMinutes;
          computedGroupRounds = opt.rounds;
          computedShortenedCount = opt.shortenedCount || 0;
          const lastMatchesUsed = Math.floor((opt.lastRoundCapacity ?? fullMatchesPerSlot * 4) / 4);
          computedLastRoundCapacity = lastMatchesUsed < fullMatchesPerSlot ? opt.lastRoundCapacity : null;
        });
      }
    }
  }

  appEl.querySelectorAll('input[name="f_format"]').forEach((radio) =>
    radio.addEventListener('change', (e) => {
      finalistsSelect.innerHTML = finalistsOptionsHtml(e.target.value, parseInt(finalistsSelect.value, 10));
      finalistsHelp.textContent = finalistsHelpText(e.target.value);
      formatHelp.textContent = formatHelpText(e.target.value);
      recomputeMatchLength();
    })
  );
  ['f_tmin', 'f_courts', 'f_pause', 'f_players'].forEach((id) =>
    document.getElementById(id).addEventListener('input', recomputeMatchLength)
  );
  recomputeMatchLength();

  document.getElementById('cancelBtn').addEventListener('click', renderHome);
  document.getElementById('nextBtn').addEventListener('click', () => {
    const settings = {
      name: document.getElementById('f_name').value.trim() || 'Padeliturniir',
      format: document.querySelector('input[name="f_format"]:checked').value,
      tournamentMinutes: parseInt(document.getElementById('f_tmin').value, 10),
      pauseMinutes: parseInt(document.getElementById('f_pause').value, 10),
      matchMinutes: computedMatchMinutes,
      groupRounds: computedGroupRounds,
      shortenedCount: computedShortenedCount,
      lastRoundCapacity: computedLastRoundCapacity,
      courts: parseInt(document.getElementById('f_courts').value, 10),
      playersCount: parseInt(document.getElementById('f_players').value, 10),
      startTime: `${String(parseInt(document.getElementById('f_starttime_h').value, 10)).padStart(2, '0')}:${String(parseInt(document.getElementById('f_starttime_m').value, 10)).padStart(2, '0')}`,
      finalists: parseInt(document.getElementById('f_finalists').value, 10),
      winnerRule: document.querySelector('input[name="f_winnerrule"]:checked').value,
    };
    const errEl = document.getElementById('settingsError');
    const minNeeded = 4; // Padelit ei saa mängida vähem kui 4 mängijaga (2 vs 2), ei üksik- ega paarismängus.
    if (!settings.tournamentMinutes || settings.tournamentMinutes < 10) {
      errEl.textContent = 'Turniiri pikkus peab olema vähemalt 10 minutit.';
      errEl.classList.remove('hidden');
      return;
    }
    if (!settings.courts || settings.courts < 1) {
      errEl.textContent = 'Väljakuid peab olema vähemalt 1.';
      errEl.classList.remove('hidden');
      return;
    }
    if (!settings.playersCount || settings.playersCount < minNeeded) {
      errEl.textContent = `Vali vähemalt ${minNeeded} mängijat (${isDoublesFormat(settings.format) ? 'paarismäng' : 'üksikmäng'}).`;
      errEl.classList.remove('hidden');
      return;
    }
    if (isDoublesFormat(settings.format) && settings.playersCount % 2 !== 0) {
      errEl.textContent = 'Paarismängu jaoks peab mängijate arv olema paaris.';
      errEl.classList.remove('hidden');
      return;
    }
    if (!settings.matchMinutes || settings.matchMinutes < 1) {
      errEl.textContent = 'Selle seadistusega ei ole võimalik tagada, et kõik saaksid täpselt võrdse arvu mänge — pikenda turniiri, lisa väljakuid, vähenda pausi või muuda mängijate arvu.';
      errEl.classList.remove('hidden');
      return;
    }
    const finalistsNeedsPlayers = isDoublesFormat(settings.format) ? settings.finalists * 2 : settings.finalists;
    if (finalistsNeedsPlayers > settings.playersCount) {
      errEl.textContent = isDoublesFormat(settings.format)
        ? `${settings.finalists} paari finaalietappi jaoks on vaja vähemalt ${finalistsNeedsPlayers} mängijat.`
        : `Vali vähemalt ${settings.finalists} mängijat, et ${settings.finalists} parimat saaksid play-off’i minna.`;
      errEl.classList.remove('hidden');
      return;
    }
    if (existing) {
      pendingPlayers = existing.players.map((p) => ({ id: p.id, name: p.name }));
    }
    renderPlayersScreen(settings, existing);
  });
}

// ---------------------------------------------------------------------------
// MÄNGIJAD
// ---------------------------------------------------------------------------
function renderPlayersScreen(settings, existing) {
  if (pendingPlayers.length !== settings.playersCount) {
    const base = pendingPlayers;
    pendingPlayers = [];
    for (let i = 0; i < settings.playersCount; i++) {
      pendingPlayers.push(base[i] || { id: uid(), name: '' });
    }
  }
  const isFixed = settings.format === 'doubles_fixed';
  const isDraw = settings.format === 'doubles_draw';
  const half = Math.floor(settings.playersCount / 2);

  if (isDraw && teamOrder.length !== half) {
    teamOrder = shuffle(pendingPlayers.slice(half).map((p) => p.id));
  }

  function nameOrPlaceholder(id) {
    const idx = pendingPlayers.findIndex((x) => x.id === id);
    const p = pendingPlayers[idx];
    return escapeHtml(p && p.name ? p.name : `Mängija ${idx + 1}`);
  }

  const renderSinglesInputs = () =>
    `<div class="grid-2">${pendingPlayers
      .map(
        (p, i) => `
      <div class="field">
        <label>Mängija ${i + 1}</label>
        <input type="text" class="player-name" data-idx="${i}" placeholder="Mängija ${i + 1}" value="${escapeHtml(p.name)}" />
      </div>`
      )
      .join('')}</div>`;

  const renderFixedPairInputs = () => {
    let rows = '';
    for (let i = 0; i < half; i++) {
      const a = 2 * i;
      const b = 2 * i + 1;
      rows += `
        <div class="field">
          <label>Paar ${i + 1}</label>
          <div class="row-gap">
            <input type="text" class="player-name" data-idx="${a}" placeholder="Mängija ${a + 1}" value="${escapeHtml(pendingPlayers[a].name)}" />
            <span>&amp;</span>
            <input type="text" class="player-name" data-idx="${b}" placeholder="Mängija ${b + 1}" value="${escapeHtml(pendingPlayers[b].name)}" />
          </div>
        </div>`;
    }
    return `<p class="muted small">Sisesta paarid otse — need EI loosita, mängivad täpselt nii nagu siia kirjutad.</p>${rows}`;
  };

  const renderDrawColumns = () => {
    const col1 = pendingPlayers
      .slice(0, half)
      .map(
        (p, i) => `
      <div class="field">
        <label>Veerg 1 · ${i + 1}</label>
        <input type="text" class="player-name" data-idx="${i}" placeholder="Mängija ${i + 1}" value="${escapeHtml(p.name)}" />
      </div>`
      )
      .join('');
    const col2 = pendingPlayers
      .slice(half)
      .map((p, i) => {
        const idx = half + i;
        return `
      <div class="field">
        <label>Veerg 2 · ${i + 1}</label>
        <input type="text" class="player-name" data-idx="${idx}" placeholder="Mängija ${idx + 1}" value="${escapeHtml(p.name)}" />
      </div>`;
      })
      .join('');
    return `
      <p class="muted small">Paarid loositakse: Veeru 1 mängijad paaritatakse allpool loositud järjekorras Veeru 2 mängijatega.</p>
      <div class="grid-2"><div>${col1}</div><div>${col2}</div></div>`;
  };

  const renderDrawPreview = () => {
    if (!isDraw) return '';
    const rows = teamOrder
      .map((id2, i) => `<div class="team-chip">Paar ${i + 1}: ${nameOrPlaceholder(pendingPlayers[i].id)} &amp; ${nameOrPlaceholder(id2)}</div>`)
      .join('');
    return `
      <div class="field">
        <div class="row-between">
          <label>Loositud paarid</label>
          <button class="btn btn-secondary small" id="reshuffleBtn" type="button">🔀 Loosi uuesti</button>
        </div>
        <div class="team-preview">${rows}</div>
      </div>`;
  };

  appEl.innerHTML = `
    <div class="card">
      <h1>Mängijad</h1>
      <p class="muted">${settings.name} · ${formatLabel(settings.format)} · ${settings.playersCount} mängijat</p>
      <div id="playerInputs">${settings.format === 'singles' ? renderSinglesInputs() : isFixed ? renderFixedPairInputs() : renderDrawColumns()}</div>
      <div id="teamPreviewWrap">${renderDrawPreview()}</div>
      <p id="playersError" class="error hidden"></p>
      <div class="row-gap">
        <button class="btn btn-secondary" id="backBtn">Tagasi</button>
        <button class="btn btn-primary" id="createBtn">Loo ajakava</button>
      </div>
    </div>
  `;

  document.getElementById('backBtn').addEventListener('click', () => renderSettingsScreen({ settings }));
  const teamPreviewWrap = document.getElementById('teamPreviewWrap');
  appEl.querySelectorAll('.player-name').forEach((inp) =>
    inp.addEventListener('input', (e) => {
      const el = e.target;
      const capitalized = el.value.charAt(0).toUpperCase() + el.value.slice(1);
      if (capitalized !== el.value) {
        const pos = el.selectionStart;
        el.value = capitalized;
        el.setSelectionRange(pos, pos);
      }
      pendingPlayers[parseInt(el.dataset.idx, 10)].name = el.value;
      if (isDraw) teamPreviewWrap.innerHTML = renderDrawPreview();
    })
  );
  // Delegeeritud kuular: teamPreviewWrap ise ei kao kunagi, ainult selle sisu uueneb,
  // seega "Loosi uuesti" nupp töötab ka pärast taasjoonistamist.
  teamPreviewWrap.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'reshuffleBtn') {
      teamOrder = shuffle(teamOrder);
      teamPreviewWrap.innerHTML = renderDrawPreview();
    }
  });

  document.getElementById('createBtn').addEventListener('click', () => {
    let teamOrderIds = null;
    if (isFixed) {
      teamOrderIds = pendingPlayers.map((p) => p.id);
    } else if (isDraw) {
      teamOrderIds = [];
      for (let i = 0; i < half; i++) teamOrderIds.push(pendingPlayers[i].id, teamOrder[i]);
    }
    const t = State.newTournament(settings, pendingPlayers);
    if (existing) {
      // Sama turniiri uuestitegemine (nt "Muuda seadistust") — säilita algne id/loomisaeg,
      // et jagatud lingid ja pilve-sünkroon jätkaksid sama turniiriga, mitte ei loo uut.
      t.id = existing.id;
      t.createdAt = existing.createdAt;
    }
    const currentUser = getCurrentUser();
    t.ownerUid = (existing && existing.ownerUid) || (currentUser && currentUser.uid) || null;
    buildSchedule(t, teamOrderIds);
    t.phase = 'group';
    State.saveTournament(t);
    pendingPlayers = [];
    teamOrder = [];
    renderTournamentScreen(t, { readOnly: false });
  });
}

// ---------------------------------------------------------------------------
// AJAKAVA GENEREERIMINE
// ---------------------------------------------------------------------------
function buildSchedule(t, teamOrderIds) {
  const { format, tournamentMinutes, matchMinutes, pauseMinutes, courts, finalists, groupRounds, lastRoundCapacity } = t.settings;
  const pause = pauseMinutes || 0;
  const totalSlots = Math.max(1, Math.floor((tournamentMinutes + pause) / (matchMinutes + pause)));
  const playoffSlots = finalists > 0 ? Math.log2(finalists) : 0;
  const groupSlots = Math.max(1, totalSlots - playoffSlots);
  // Ainult americano/lõdva paarismängu jaoks: sama TÄPNE voorude arv, mis seadete
  // ekraanil juba arvutati (vt recomputeMatchLength) — see arvestab juba võrdsuse
  // tagamiseks vajaliku lühendamisega, seega EI arvutata seda siin uuesti lihtsa jagamisega.
  const exactGroupSlots = Math.max(1, (groupRounds || groupSlots) - playoffSlots);
  // lastRoundCapacity kehtib seadete ekraanil arvutatud VIIMASE vooru kohta — kui
  // play-off võtab lõpust vooru(sid) ära, nihkub "viimane voor" ja tuleb selle
  // (väiksema) voorude arvu jaoks uuesti arvutada (harv kombinatsioon: lõdva
  // katvusega + play-off).
  let effectiveLastRoundCapacity = lastRoundCapacity;
  if (playoffSlots > 0 && (lastRoundCapacity != null || groupRounds)) {
    const n = isDoublesFormat(format) ? Math.floor(t.players.length / 2) : t.players.length;
    const unitSize = isDoublesFormat(format) ? 2 : 4;
    effectiveLastRoundCapacity = Schedule.findLastRoundCapacityForRounds(n, unitSize, courts, exactGroupSlots);
  }
  const allPlayerIds = t.players.map((p) => p.id);

  const toMatches = (rawMatches) =>
    rawMatches.map((m, idx) => ({
      id: uid(),
      court: idx + 1,
      side1: m.side1,
      side2: m.side2,
      score1: null,
      score2: null,
    }));

  if (isDoublesFormat(format)) {
    // Paarilised on fikseeritud kogu turniiri vältel — moodustatakse üks kord siin.
    // teamOrderIds annab järjekorra, milles järjestikused kaksikud (kindel paariline: sisestusjärjekord;
    // loositav paariline: loosimise tulemus) moodustavad paari.
    const order = teamOrderIds && teamOrderIds.length === allPlayerIds.length ? teamOrderIds : shuffle(allPlayerIds);
    const teams = [];
    for (let i = 0; i < order.length; i += 2) {
      if (order[i + 1]) teams.push({ id: uid(), playerIds: [order[i], order[i + 1]] });
    }
    t.teams = teams;
    const entityPlayers = {};
    teams.forEach((team) => (entityPlayers[team.id] = team.playerIds));
    // Sama 11-minutilise piiri kontroll, mida seaded-ekraan mängu pikkuse valikul juba
    // tegi (vt recomputeMatchLength) — kui täieliku katvuse nõue teeks mängud liiga
    // lühikeseks, ei nõuta enam, et iga paar mängiks kõigi teistega, vaid väljakud
    // täidetakse õiglaselt olemasoleva aja sees (sarnaselt üksikmänguga).
    const fullCoverageRounds = Schedule.estimateExactRoundRobinSlots(teams.length, courts);
    const fullCoverageMm = Math.floor((tournamentMinutes - (fullCoverageRounds - 1) * pause) / fullCoverageRounds);
    let rawSlots;
    if (fullCoverageMm >= 11) {
      // Iga paar mängib iga teise paariga TÄPSELT üks kord (mitte kunagi rohkem) — nii on
      // mängude arv kõigile täpselt võrdne. Väljakud täidetakse võimalikult täis, ainult
      // viimane(sed) ajaperiood(id) võivad väljakupuudusel jääda osaliseks.
      rawSlots = Schedule.generateExactRoundRobin({ entities: teams.map((tm) => tm.id), entityPlayers, courts, maxSlots: groupSlots });
    } else {
      // Liiga palju paare antud aja jaoks — täielikku katvust ei nõuta, väljakud
      // täidetakse õiglaselt (kõige vähem mänginud paarid mängivad esimesena).
      rawSlots = Schedule.generateFairSlots({ entities: teams.map((tm) => tm.id), entityPlayers, courts, maxSlots: exactGroupSlots, mode: 'americano', lastRoundCapacity: effectiveLastRoundCapacity });
    }
    t.slots = rawSlots.map((s, idx) => ({ round: idx + 1, matches: toMatches(s.matches), resting: s.resting }));
  } else {
    // Üksikmäng = padeli "Americano": padelit ei saa mängida 1 vastu 1, seega mängitakse
    // ikka 2 vs 2, aga paariline ja vastased loositakse iga vooru uuesti (eraldi loogika
    // paarismängust — vt generateAmericanoDoublesSlots).
    const rawSlots = Schedule.generateAmericanoDoublesSlots({ players: allPlayerIds, courts, maxSlots: exactGroupSlots, lastRoundCapacity: effectiveLastRoundCapacity });
    t.slots = rawSlots.map((s, idx) => ({ round: idx + 1, matches: toMatches(s.matches), resting: s.resting }));
  }
}

// ---------------------------------------------------------------------------
// TURNIIRIVAADE (rühmaetapp)
// ---------------------------------------------------------------------------
function renderTournamentScreen(t, { readOnly }) {
  const isDoubles = isDoublesFormat(t.settings.format);
  const winnerRule = t.settings.winnerRule || 'wins';
  const standings = isDoubles ? computeTeamStandings(t, winnerRule) : computeStandings(t, winnerRule);
  // "played" pingereas loeb ainult juba tulemusega mänge — keset turniiri on see
  // paratamatult eri paaride/mängijate vahel erinev (nemad ei ole veel kõiki oma voore
  // mänginud/tulemust sisestanud). scheduledCounts annab "kokku plaanis" numbri, mida
  // "Mänge" veerus "senini / kokku" kujul kõrvale näidatakse, et see erinevus ei jätaks
  // muljet, nagu oleks ajakava ise ebavõrdne (vt computeScheduledCounts kommentaari).
  const scheduledCounts = isDoubles ? computeTeamScheduledCounts(t) : computeScheduledCounts(t);
  const roundWindows = roundTimeWindows(t);

  // Grupeeri slotid loogilise vooru järgi — paarismängus võib üks voor (kui väljakuid napib)
  // koosneda mitmest järjestikusest "lainest", mis kuvatakse ühe "Voor N" pealkirja all.
  const roundGroups = [];
  t.slots.forEach((slot, si) => {
    const roundNum = slot.round || si + 1;
    const lastGroup = roundGroups[roundGroups.length - 1];
    if (!lastGroup || lastGroup.round !== roundNum) {
      roundGroups.push({ round: roundNum, items: [] });
    }
    roundGroups[roundGroups.length - 1].items.push({ slot, si });
  });

  const courtNames = State.loadCourtNames();
  const courtLabel = (courtNum) => escapeHtml((courtNames[courtNum - 1] || '').trim() || String(courtNum));
  const matchTable = (slot, si) => `
    <table class="table">
      <thead><tr><th>Väljak</th><th></th><th>Skoor</th><th></th></tr></thead>
      <tbody>
        ${slot.matches
          .map(
            (m, mi) => `
          <tr>
            <td class="court-badge">${courtLabel(m.court)}</td>
            <td class="side">${escapeHtml(sideLabel(t, m.side1))}</td>
            <td class="score-cell">
              ${
                readOnly
                  ? `<span>${m.score1 ?? '–'} : ${m.score2 ?? '–'}</span>`
                  : `<input type="number" min="0" class="score-input" data-si="${si}" data-mi="${mi}" data-side="1" value="${m.score1 ?? ''}" />
                     <span>:</span>
                     <input type="number" min="0" class="score-input" data-si="${si}" data-mi="${mi}" data-side="2" value="${m.score2 ?? ''}" />`
              }
            </td>
            <td class="side">${escapeHtml(sideLabel(t, m.side2))}</td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>
    ${slot.resting && slot.resting.length ? `<p class="muted small">Puhkavad: ${slot.resting.map((id) => escapeHtml(nameForPlayer(t, id))).join(', ')}</p>` : ''}`;

  const slotsHtml = roundGroups
    .map((group) => {
      const firstSi = group.items[0].si;
      const lastSi = group.items[group.items.length - 1].si;
      const multiWave = group.items.length > 1;
      const wavesHtml = group.items
        .map(
          ({ slot, si }, waveIdx) => `
        ${multiWave ? `<p class="muted small">Osa ${waveIdx + 1}/${group.items.length} · ${fmtTime(roundWindows[si].start)}–${fmtTime(roundWindows[si].end)} (väljakuid napib, voor jaguneb lainetesse)</p>` : ''}
        ${matchTable(slot, si)}`
        )
        .join('');
      return `
    <div class="round-block">
      <h3>Voor ${group.round} <span class="muted">· ${fmtTime(roundWindows[firstSi].start)}–${fmtTime(roundWindows[lastSi].end)}</span></h3>
      ${wavesHtml}
    </div>`;
    })
    .join('');

  const standingsHtml = `
    <table class="table standings-table">
      <thead><tr><th>#</th><th>${isDoubles ? 'Paar' : 'Mängija'}</th><th>V</th><th>K</th><th>Viik</th><th>Punktid</th><th>V-K</th><th>Mänge ${infoIcon('Senini sisestatud tulemustega mängude arv / kokku ajakavas planeeritud mängude arv. Kuni kõigi voorude tulemused on sisestatud, on "senini" number paratamatult erinev — ajakava ise annab kõigile lõpuks täpselt sama "kokku" arvu.')}</th></tr></thead>
      <tbody>
        ${standings
          .map(
            (r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(r.name)}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.draws}</td><td>${standingsPoints(r, winnerRule)}</td><td>${r.pointsFor - r.pointsAgainst}</td><td>${r.played} / ${scheduledCounts[r.id] ?? r.played}</td></tr>`
          )
          .join('')}
      </tbody>
    </table>`;

  const hasPlayoff = t.settings.finalists > 0;
  const leaderInfo = hasPlayoff ? null : findLeaderWithTieInfo(standings, winnerRule);
  const championHtml =
    !hasPlayoff && leaderInfo
      ? `<div class="champion-banner">
          ${t.phase === 'done' ? `🏆 Turniiri võitja: <strong>${escapeHtml(leaderInfo.leader.name)}</strong>` : `Hetkel juhib: <strong>${escapeHtml(leaderInfo.leader.name)}</strong>`}
          ${
            leaderInfo.tie
              ? `<div class="tie-note">Viik ${methodLabel(winnerRule)} järgi. ${
                  leaderInfo.altLeader
                    ? `${capitalize(methodLabel(leaderInfo.altMethod))} järgi juhiks: <strong>${escapeHtml(leaderInfo.altLeader.name)}</strong>`
                    : 'Viik ka teiste arvestuste järgi.'
                }</div>`
              : ''
          }
        </div>`
      : '';

  const actionButtons = readOnly
    ? ''
    : hasPlayoff
    ? `<button class="btn btn-primary" id="playoffBtn">Alusta play-off'e →</button>`
    : t.phase !== 'done'
    ? `<button class="btn btn-primary" id="finishBtn">🏁 Lõpeta turniir ja kuuluta võitja</button>`
    : '';

  appEl.innerHTML = `
    <div class="card">
      <div class="row-between">
        <div>
          <h1>${escapeHtml(t.name)}</h1>
          <p class="muted small">${formatLabel(t.settings.format)} · ${t.settings.courts} väljakut · ${roundGroups.length} vooru · ${t.settings.matchMinutes} min/mäng ${hasPlayoff ? '' : '· Ilma play-off\'ita'}</p>
        </div>
        ${readOnly ? '' : `<div class="row-gap"><button class="btn btn-secondary" id="backToSettingsBtn">← Muuda seadistust</button><button class="btn btn-secondary" id="shareBtn">🔗 Jaga link</button>${actionButtons}</div>`}
      </div>
      ${championHtml}
      <div id="shareBox" class="share-box hidden"></div>
    </div>

    <div class="two-col">
      <div class="card">
        <h2>Ajakava</h2>
        ${slotsHtml}
      </div>
      <div class="card sticky-card">
        <h2>Pingerida</h2>
        ${standingsHtml}
      </div>
    </div>
  `;

  if (!readOnly) {
    appEl.querySelectorAll('.score-input').forEach((inp) =>
      inp.addEventListener('change', (e) => {
        const si = parseInt(e.target.dataset.si, 10);
        const mi = parseInt(e.target.dataset.mi, 10);
        const side = e.target.dataset.side;
        const val = e.target.value === '' ? null : Math.max(0, parseInt(e.target.value, 10));
        t.slots[si].matches[mi][side === '1' ? 'score1' : 'score2'] = val;
        State.saveTournament(t);
        renderTournamentScreen(t, { readOnly: false });
      })
    );
    document.getElementById('shareBtn').addEventListener('click', () => wireShareBox(t, 'shareBox'));
    document.getElementById('backToSettingsBtn').addEventListener('click', () => {
      const hasScores = t.slots.some((s) => s.matches.some((m) => m.score1 != null || m.score2 != null));
      if (hasScores && !confirm('Seadistuse muutmine loob ajakava uuesti ja kustutab juba sisestatud skoorid. Kas jätkata?')) {
        return;
      }
      renderSettingsScreen(t);
    });
    const playoffBtn = document.getElementById('playoffBtn');
    if (playoffBtn) {
      playoffBtn.addEventListener('click', () => {
        const allScored = t.slots.every((s) => s.matches.every((m) => m.score1 != null && m.score2 != null));
        if (!allScored && !confirm("Kõik rühmaetapi mängud pole veel skoore saanud — pingerida ei pruugi olla lõplik. Kas alustada play-off'e ikkagi?")) {
          return;
        }
        startPlayoffs(t);
      });
    }
    const finishBtn = document.getElementById('finishBtn');
    if (finishBtn) {
      finishBtn.addEventListener('click', () => {
        const allScored = t.slots.every((s) => s.matches.every((m) => m.score1 != null && m.score2 != null));
        if (!allScored && !confirm('Kõik mängud pole veel skoore saanud — pingerida ei pruugi olla lõplik. Kas kuulutada võitja ikkagi?')) {
          return;
        }
        t.phase = 'done';
        State.saveTournament(t);
        renderTournamentScreen(t, { readOnly: false });
      });
    }
  }
  startLiveSync(t, { readOnly });
  startRoundTimer(t);
}

// ---------------------------------------------------------------------------
// PLAY-OFF
// ---------------------------------------------------------------------------
// Üksikmängu (Americano) play-off jaoks: pingerea parim + halvim finalist mängivad koos
// paaris, teine + eelviimane jne — nii tulevad play-off'i paarid võimalikult tasavägised.
// Eraldi loogika paarismängust, kus paarilised on juba kogu turniiri vältel fikseeritud.
function seedAmericanoPlayoffTeams(finalistRows) {
  const k = finalistRows.length;
  const teams = [];
  for (let i = 0; i < k / 2; i++) {
    const a = finalistRows[i];
    const b = finalistRows[k - 1 - i];
    teams.push({ id: uid(), playerIds: [a.id, b.id] });
  }
  return teams;
}

function startPlayoffs(t) {
  const isDoubles = isDoublesFormat(t.settings.format);
  const winnerRule = t.settings.winnerRule || 'wins';
  const standings = isDoubles ? computeTeamStandings(t, winnerRule) : computeStandings(t, winnerRule);
  if (isDoubles) {
    const finalists = standings.slice(0, t.settings.finalists).map((r) => ({ id: r.id, name: r.name }));
    t.playoffTeams = null;
    t.bracket = Schedule.generateBracket(finalists);
  } else {
    // Padelit ei saa mängida üksi, seega moodustame play-off'i jaoks ajutised paarid.
    const finalistRows = standings.slice(0, t.settings.finalists);
    const playoffTeams = seedAmericanoPlayoffTeams(finalistRows);
    t.playoffTeams = playoffTeams;
    t.bracket = Schedule.generateBracket(playoffTeams.map((tm) => ({ id: tm.id, name: sideLabel(t, tm.playerIds) })));
  }
  t.phase = 'playoffs';
  State.saveTournament(t);
  renderPlayoffScreen(t, { readOnly: false });
}

function findMatch(bracket, id) {
  for (const round of bracket.rounds) {
    const m = round.matches.find((x) => x.id === id);
    if (m) return m;
  }
  if (bracket.thirdPlace && bracket.thirdPlace.id === id) return bracket.thirdPlace;
  return null;
}

function resolveSlot(t, slot) {
  if (slot.entityId) return { id: slot.entityId, name: nameForEntity(t, slot.entityId) };
  const m = findMatch(t.bracket, slot.fromMatch);
  if (!m) return null;
  const wantId = slot.loser ? m.loserId : m.winnerId;
  if (wantId == null) return null;
  return { id: wantId, name: nameForEntity(t, wantId) };
}

function renderPlayoffScreen(t, { readOnly }) {
  stopRoundTimer();
  const roundNames = (count) => {
    if (count === 1) return 'Finaal';
    if (count === 2) return 'Poolfinaalid';
    if (count === 4) return 'Veerandfinaalid';
    return `${count * 2}-ringi`;
  };

  const matchCard = (m) => {
    const s1 = resolveSlot(t, m.slot1);
    const s2 = resolveSlot(t, m.slot2);
    const canScore = s1 && s2 && !readOnly;
    return `
      <div class="bracket-match" data-mid="${m.id}">
        <div class="bracket-side ${m.winnerId === (s1 && s1.id) ? 'winner' : ''}">
          <span>${s1 ? escapeHtml(s1.name) : '<span class="muted">selgub…</span>'}</span>
          ${canScore ? `<input type="number" min="0" class="bscore" data-mid="${m.id}" data-side="1" value="${m.score1 ?? ''}" />` : `<span class="bscore-static">${m.score1 ?? ''}</span>`}
        </div>
        <div class="bracket-side ${m.winnerId === (s2 && s2.id) ? 'winner' : ''}">
          <span>${s2 ? escapeHtml(s2.name) : '<span class="muted">selgub…</span>'}</span>
          ${canScore ? `<input type="number" min="0" class="bscore" data-mid="${m.id}" data-side="2" value="${m.score2 ?? ''}" />` : `<span class="bscore-static">${m.score2 ?? ''}</span>`}
        </div>
      </div>`;
  };

  const roundsHtml = t.bracket.rounds
    .map(
      (round, ri) => `
    <div class="bracket-col">
      <h3>${roundNames(round.matches.length)}</h3>
      ${round.matches.map(matchCard).join('')}
    </div>`
    )
    .join('');

  const finalRound = t.bracket.rounds[t.bracket.rounds.length - 1].matches;
  const championSlot = finalRound.length === 1 && finalRound[0].winnerId != null ? finalRound[0] : null;
  const champion = championSlot ? nameForEntity(t, championSlot.winnerId) : null;

  const isDoubles = isDoublesFormat(t.settings.format);
  const winnerRule = t.settings.winnerRule || 'wins';
  const overallStandings = isDoubles ? computeTeamStandings(t, winnerRule) : computeStandings(t, winnerRule);
  const overallScheduledCounts = isDoubles ? computeTeamScheduledCounts(t) : computeScheduledCounts(t);
  const overallStandingsHtml = `
    <table class="table standings-table">
      <thead><tr><th>#</th><th>${isDoubles ? 'Paar' : 'Mängija'}</th><th>V</th><th>K</th><th>Viik</th><th>Punktid</th><th>V-K</th><th>Mänge ${infoIcon('Senini sisestatud tulemustega mängude arv / kokku ajakavas planeeritud mängude arv (rühmamängud).')}</th></tr></thead>
      <tbody>
        ${overallStandings
          .map(
            (r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(r.name)}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.draws}</td><td>${standingsPoints(r, winnerRule)}</td><td>${r.pointsFor - r.pointsAgainst}</td><td>${r.played} / ${overallScheduledCounts[r.id] ?? r.played}</td></tr>`
          )
          .join('')}
      </tbody>
    </table>`;

  appEl.innerHTML = `
    <div class="card">
      <div class="row-between">
        <h1>${escapeHtml(t.name)} — Play-off</h1>
        ${
          readOnly
            ? ''
            : `<div class="row-gap"><button class="btn btn-secondary" id="newTournamentBtn2">+ Uus turniir</button><button class="btn btn-secondary" id="shareBtn2">🔗 Jaga link</button></div>`
        }
      </div>
      ${champion ? `<div class="champion-banner">🏆 Turniiri võitja: <strong>${escapeHtml(champion)}</strong></div>` : ''}
      <div id="shareBox2" class="share-box hidden"></div>
    </div>
    <div class="two-col">
      <div class="card">
        <h2>Play-off tabel</h2>
        <div class="bracket">
          ${roundsHtml}
          ${
            t.bracket.thirdPlace
              ? `<div class="bracket-col"><h3>3. koha mäng</h3>${matchCard(t.bracket.thirdPlace)}</div>`
              : ''
          }
        </div>
      </div>
      <div class="card">
        <h2>Üldine pingerida</h2>
        ${overallStandingsHtml}
      </div>
    </div>
  `;

  if (!readOnly) {
    appEl.querySelectorAll('.bscore').forEach((inp) =>
      inp.addEventListener('change', (e) => {
        const m = findMatch(t.bracket, e.target.dataset.mid);
        const val = e.target.value === '' ? null : Math.max(0, parseInt(e.target.value, 10));
        m[e.target.dataset.side === '1' ? 'score1' : 'score2'] = val;
        if (m.score1 != null && m.score2 != null && m.score1 !== m.score2) {
          const s1 = resolveSlot(t, m.slot1);
          const s2 = resolveSlot(t, m.slot2);
          m.winnerId = m.score1 > m.score2 ? s1.id : s2.id;
          m.loserId = m.score1 > m.score2 ? s2.id : s1.id;
        } else {
          m.winnerId = null;
          m.loserId = null;
        }
        const finalM = t.bracket.rounds[t.bracket.rounds.length - 1].matches[0];
        t.phase = finalM.winnerId != null ? 'done' : 'playoffs';
        State.saveTournament(t);
        renderPlayoffScreen(t, { readOnly: false });
      })
    );
    document.getElementById('shareBtn2').addEventListener('click', () => wireShareBox(t, 'shareBox2'));
    document.getElementById('newTournamentBtn2').addEventListener('click', () => renderSettingsScreen(null));
  }
  startLiveSync(t, { readOnly });
}

// Näitab jagamiskasti kahe lingiga: vaatamiseks (loeb, uueneb automaatselt) ja
// toimetamiseks (saab ka skoore sisestada). Kui pilv pole seadistatud, selgitab miks mitte.
function wireShareBox(t, boxId) {
  const box = document.getElementById(boxId);
  box.classList.remove('hidden');
  if (!isCloudConfigured()) {
    box.innerHTML = `<p class="muted small">Jagamine vajab, et rakenduse omanik seadistaks Firebase'i (vt README.md). Seni töötab äpp ainult siin brauseris.</p>`;
    return;
  }
  const viewUrl = buildViewUrl(t.id);
  const editUrl = buildEditUrl(t.id);
  box.innerHTML = `
    <p class="muted small">Mõlemad lingid uuenevad automaatselt kõigil, kellel need avatud on.</p>
    <div class="field">
      <label>👁️ Vaatamise link (ei saa muuta)</label>
      <div class="row-gap">
        <input type="text" readonly class="share-url" value="${escapeHtml(viewUrl)}" />
        <button class="btn btn-secondary copy-share-btn" type="button">Kopeeri</button>
      </div>
    </div>
    <div class="field">
      <label>✏️ Toimetamise link (saab skoore sisestada)</label>
      <div class="row-gap">
        <input type="text" readonly class="share-url" value="${escapeHtml(editUrl)}" />
        <button class="btn btn-secondary copy-share-btn" type="button">Kopeeri</button>
      </div>
    </div>`;
  box.querySelectorAll('.share-url').forEach((inp) => inp.addEventListener('click', (e) => e.target.select()));
  box.querySelectorAll('.copy-share-btn').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const input = btn.previousElementSibling;
      try {
        await navigator.clipboard.writeText(input.value);
        btn.textContent = 'Kopeeritud ✓';
      } catch (e) {
        input.select();
      }
    })
  );
}

window.addEventListener('hashchange', () => {
  // Kui hash muutub (nt tagasi/edasi nupp, või uue lingi kleepimine samasse avatud vahelehte),
  // käivita marsruutimine uuesti — pelk hash-muutus ei lae lehte iseenesest uuesti.
  init();
});

init();
