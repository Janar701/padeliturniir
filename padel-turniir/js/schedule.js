// Ajakava genereerimine: ühtne õiglane ajastaja (Ring ja Americano) ja play-off tabel.
import { shuffle } from './util.js';

function pairKey(x, y) {
  return x < y ? x + '|' + y : y + '|' + x;
}

// Ühtne, õiglane ajakava genereerija — kasutatakse nii üksikmängus (entity = mängija)
// kui paarismängus (entity = fikseeritud paar; paarilised mängivad alati koos).
// Igal ajaslotil valitakse mängu need osalejad, kes on seni kõige vähem mänginud
// (nii on mängude arv kõigi vahel võimalikult võrdne, olenemata sellest, kus ajakava katkeb),
// ning vastased valitakse nii, et korduvaid vastasseise oleks võimalikult vähe.
//
// mode 'roundrobin': peatub, kui iga paar üksusi on juba korra kohtunud (täielik ring läbitud).
// mode 'americano': täidab kogu saadaoleva aja, eelistades ikka värskeid vastasseise.
export function generateFairSlots({ entities, entityPlayers, courts, maxSlots, mode }) {
  const n = entities.length;
  const matchesPerSlot = Math.max(0, Math.min(courts, Math.floor(n / 2)));
  const capacity = matchesPerSlot * 2;
  const playCount = {};
  entities.forEach((id) => (playCount[id] = 0));
  const pairCount = {};
  const usedPairs = new Set();
  const totalPossiblePairs = (n * (n - 1)) / 2;

  const slots = [];
  for (let s = 0; s < maxSlots && matchesPerSlot > 0; s++) {
    if (mode === 'roundrobin' && usedPairs.size >= totalPossiblePairs) break;

    // Õiglus on kohustuslik, mitte soovituslik: kes on seni kõige vähem mänginud, need MANGIVAD.
    // Vabadus vastasseisu valikul (korduste vältimiseks) jääb ainult võrdse mängude arvuga
    // ("piiripealse") grupi sees — nii ei saa värskuse eelistamine kunagi õiglust rikkuda.
    const sorted = [...entities].sort((a, b) => playCount[a] - playCount[b] || Math.random() - 0.5);
    const boundaryCount = playCount[sorted[capacity - 1]];
    const mandatory = sorted.filter((id) => playCount[id] < boundaryCount);
    const tiedPool = sorted.filter((id) => playCount[id] === boundaryCount);
    const needed = capacity - mandatory.length;

    let best = null;
    let bestScore = Infinity;
    const attempts = Math.max(200, tiedPool.length * 30);
    for (let attempt = 0; attempt < attempts; attempt++) {
      const flexPicks = shuffle(tiedPool).slice(0, needed);
      const active = shuffle([...mandatory, ...flexPicks]);
      const pairs = [];
      for (let g = 0; g < matchesPerSlot; g++) pairs.push([active[g * 2], active[g * 2 + 1]]);
      let score = 0;
      pairs.forEach(([a, b]) => {
        score += (pairCount[pairKey(a, b)] || 0) ** 2;
      });
      if (score < bestScore) {
        bestScore = score;
        best = pairs;
        if (score === 0) break;
      }
    }

    best.forEach(([a, b]) => {
      const key = pairKey(a, b);
      usedPairs.add(key);
      pairCount[key] = (pairCount[key] || 0) + 1;
      playCount[a] += 1;
      playCount[b] += 1;
    });

    const activeIds = new Set(best.flat());
    const resting = entities.filter((id) => !activeIds.has(id));

    slots.push({
      matches: best.map(([a, b]) => ({ side1: entityPlayers[a], side2: entityPlayers[b] })),
      resting: resting.flatMap((id) => entityPlayers[id]),
    });
  }
  return slots;
}

// Kui palju vooru on vaja, et TÄIELIK ring-turniir saaks läbi (kõik mängivad kõigiga),
// antud osalejate arvu ja väljakute juures. Kasutatakse "mängu pikkuse" automaatarvutuseks
// seadete ekraanil, enne kui päris mängijad/id-d üldse olemas on — sisu pole tähtis, ainult
// see, mitu vooru õiglane ajastaja täieliku katvuseni vajab.
export function estimateRoundsForFullCoverage(entityCount, courts) {
  if (entityCount < 2 || courts < 1) return 0;
  const entities = Array.from({ length: entityCount }, (_, i) => 'x' + i);
  const entityPlayers = {};
  entities.forEach((id) => (entityPlayers[id] = [id]));
  // Turvaline ülempiir: täielikuks katvuseks ei tohiks kunagi kuluda rohkem kui n*n vooru.
  const safeCap = entityCount * entityCount + 4;
  const slots = generateFairSlots({ entities, entityPlayers, courts, maxSlots: safeCap, mode: 'roundrobin' });
  return slots.length;
}

// --- Play-off tabel (single elimination) ---
function seedOrder(k) {
  let order = [1, 2];
  while (order.length < k) {
    const s = order.length * 2 + 1;
    const next = [];
    order.forEach((o) => {
      next.push(o);
      next.push(s - o);
    });
    order = next;
  }
  return order;
}

// entities: [{id, name}] pingerea järjekorras (parim esimesena). length peab olema 2, 4 või 8.
export function generateBracket(entities) {
  const k = entities.length;
  const order = seedOrder(k);
  const round0 = [];
  for (let i = 0; i < k / 2; i++) {
    const e1 = entities[order[i * 2] - 1];
    const e2 = entities[order[i * 2 + 1] - 1];
    round0.push({ id: 'm-r0-' + i, slot1: { entityId: e1.id }, slot2: { entityId: e2.id }, score1: null, score2: null, winnerId: null });
  }
  const rounds = [round0];
  let prevCount = round0.length;
  let r = 1;
  while (prevCount > 1) {
    const roundMatches = [];
    for (let i = 0; i < prevCount / 2; i++) {
      roundMatches.push({
        id: `m-r${r}-${i}`,
        slot1: { fromMatch: rounds[r - 1][i * 2].id },
        slot2: { fromMatch: rounds[r - 1][i * 2 + 1].id },
        score1: null,
        score2: null,
        winnerId: null,
      });
    }
    rounds.push(roundMatches);
    prevCount = roundMatches.length;
    r++;
  }
  let thirdPlace = null;
  if (k >= 4) {
    const semiRound = rounds[rounds.length - 2];
    thirdPlace = {
      id: 'm-3rd',
      slot1: { fromMatch: semiRound[0].id, loser: true },
      slot2: { fromMatch: semiRound[1].id, loser: true },
      score1: null,
      score2: null,
      winnerId: null,
    };
  }
  return { rounds, thirdPlace };
}
