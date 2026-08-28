// Ajakava genereerimine: ühtne õiglane ajastaja (Ring ja Americano) ja play-off tabel.
import { shuffle } from './util.js';

function pairKey(x, y) {
  return x < y ? x + '|' + y : y + '|' + x;
}

// Klassikaline "ring-meetod" — kui väljakuid jagub, et KÕIK saaksid korraga mängida,
// annab see matemaatiliselt garanteeritud optimaalse tulemuse: täpselt n-1 vooru
// (paaris arvu puhul), ilma ühegi korduseta, deterministlikult (mitte juhuslikkuse najal).
function circleMethodRounds(entities) {
  const arr = [...entities];
  const bye = arr.length % 2 === 1 ? Symbol('bye') : null;
  if (bye) arr.push(bye);
  const n = arr.length;
  const fixed = arr[0];
  let rest = arr.slice(1);
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const roundArr = [fixed, ...rest];
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = roundArr[i];
      const b = roundArr[n - 1 - i];
      if (a !== bye && b !== bye) pairs.push([a, b]);
    }
    rounds.push(pairs);
    rest = [rest[rest.length - 1], ...rest.slice(0, rest.length - 1)];
  }
  return rounds;
}

// Paarismängu jaoks: TÄPSELT võrdne mängude arv kõigile — iga paar mängib iga teise paariga
// täpselt ÜKS kord, mitte kunagi rohkem (korduseid ei ole kunagi, seega mängude arv on alati
// täpselt (paaride arv - 1) igaühele, ilma eranditeta). Väljakud täidetakse võimalikult täis,
// aga viimane(sed) ajaperiood(id) võivad väljakupuudusel jääda osaliseks — see on ainuke koht,
// kus mõni väljak võib tühjaks jääda.
export function generateExactRoundRobin({ entities, entityPlayers, courts, maxSlots = Infinity }) {
  const n = entities.length;
  const matchesPerSlot = Math.max(0, Math.min(courts, Math.floor(n / 2)));
  if (matchesPerSlot === 0 || n < 2) return [];

  // Kui väljakuid jagub, et TÄIS ring korraga ära mahuks (courts >= floor(n/2)), kasuta
  // deterministlikku ring-meetodit — see garanteerib matemaatiliselt, et IGA ajaperiood
  // on täis (mitte ainult enamik), ilma juhusliku otsingu ebaõnneta. Juhuslik ahne otsing
  // allpool on vajalik AINULT siis, kui väljakud on päriselt kitsaskohaks (courts < floor(n/2)) —
  // just seal võib lõppu jääda osalisi perioode, mida tuleb otsingul optimeerida.
  if (matchesPerSlot === Math.floor(n / 2)) {
    const rounds = circleMethodRounds(entities)
      .map((pairs) => pairs.filter(([a, b]) => a !== undefined && b !== undefined))
      .filter((pairs) => pairs.length > 0)
      .slice(0, maxSlots);
    return rounds.map((pairs) => {
      const activeIds = new Set(pairs.flat());
      const resting = entities.filter((id) => !activeIds.has(id));
      return {
        matches: pairs.map(([a, b]) => ({ side1: entityPlayers[a], side2: entityPlayers[b] })),
        resting: resting.flatMap((id) => entityPlayers[id]),
      };
    });
  }

  // Väljakud on päriselt kitsaskohaks (courts < floor(n/2)): igal ring-meetodi voorul
  // on täpselt floor(n/2) mängu (garanteeritult ilma konfliktideta, sest need on ühe
  // "matching'u" osad) — jaotame IGA vooru mängud otse `courts`-suurusteks täis
  // ajaperioodideks (need on automaatselt konfliktivabad, sest on vooru alamhulk) ja
  // kogume ainult iga vooru "ülejäägi" (mis on väikevõrra alla courts) ühte kogumisse.
  // Ainult see väike ülejäägi-kogum vajab juhuslikku otsingut kokkupakkimiseks — seega
  // kõik täis-perioodid on garanteeritud täiuslikud ja ainuke koht, kus osaline periood
  // üldse tekkida saab, on kõige lõpus (ülejäägi-perioodid tulevad alati viimasena).
  const rounds = circleMethodRounds(entities);
  const fullSlots = [];
  const leftoverPairs = [];
  for (const roundPairs of rounds) {
    for (let i = 0; i + matchesPerSlot <= roundPairs.length; i += matchesPerSlot) {
      fullSlots.push(roundPairs.slice(i, i + matchesPerSlot));
    }
    const remainderStart = Math.floor(roundPairs.length / matchesPerSlot) * matchesPerSlot;
    for (let i = remainderStart; i < roundPairs.length; i++) leftoverPairs.push(roundPairs[i]);
  }

  // Üks katse: paki ülejäägi-mängud ahnelt slottidesse (iga slot proovitakse mitme
  // juhusliku järjestusega täita nii täis kui võimalik).
  function attemptOnce() {
    let remaining = leftoverPairs;
    const out = [];
    while (remaining.length > 0) {
      let best = null;
      const tries = Math.max(150, remaining.length * 5);
      for (let a = 0; a < tries; a++) {
        const order = shuffle(remaining);
        const busy = new Set();
        const picked = [];
        for (const pair of order) {
          if (picked.length >= matchesPerSlot) break;
          const [x, y] = pair;
          if (!busy.has(x) && !busy.has(y)) {
            picked.push(pair);
            busy.add(x);
            busy.add(y);
          }
        }
        if (!best || picked.length > best.length) {
          best = picked;
          if (best.length === matchesPerSlot) break; // täis — parem ei saagi
        }
      }
      if (!best || best.length === 0) break; // ummikseis, ei tohiks tavajuhul juhtuda
      out.push(best);
      const usedKeys = new Set(best.map(([a, b]) => pairKey(a, b)));
      remaining = remaining.filter(([a, b]) => !usedKeys.has(pairKey(a, b)));
    }
    return out;
  }

  // Proovi mitu katset ülejäägi kokkupakkimiseks ja jäta parim: kõigepealt kõige vähem
  // ajaperioode kokku, siis kõige vähem osalisi — see väike kogum pakib peaaegu alati
  // täielikult kokku, sest see on juba niigi väike (üks mäng vooru kohta).
  const outerAttempts = leftoverPairs.length <= 30 ? 25 : leftoverPairs.length <= 60 ? 12 : 5;
  let bestLeftoverSlots = leftoverPairs.length ? null : [];
  let bestScore = Infinity;
  for (let oa = 0; oa < outerAttempts && leftoverPairs.length; oa++) {
    const candidate = attemptOnce();
    const partial = candidate.filter((s) => s.length < matchesPerSlot).length;
    const waste = candidate.reduce((sum, s) => sum + (matchesPerSlot - s.length), 0);
    const score = candidate.length * 1000 + partial * 10 + waste;
    if (score < bestScore) {
      bestScore = score;
      bestLeftoverSlots = candidate;
      if (partial <= 1 && waste <= 1) break; // juba nii hea kui olla saab
    }
  }

  const bestSlots = [...fullSlots, ...bestLeftoverSlots].slice(0, maxSlots);

  return bestSlots.map((best) => {
    const activeIds = new Set(best.flat());
    const resting = entities.filter((id) => !activeIds.has(id));
    return {
      matches: best.map(([a, b]) => ({ side1: entityPlayers[a], side2: entityPlayers[b] })),
      resting: resting.flatMap((id) => entityPlayers[id]),
    };
  });
}

// Ühtne, õiglane ajakava genereerija — kasutatakse nii üksikmängus (entity = mängija)
// kui paarismängus (entity = fikseeritud paar; paarilised mängivad alati koos).
// Igal ajaslotil valitakse mängu need osalejad, kes on seni kõige vähem mänginud
// (nii on mängude arv kõigi vahel võimalikult võrdne, olenemata sellest, kus ajakava katkeb),
// ning vastased valitakse nii, et korduvaid vastasseise oleks võimalikult vähe.
//
// mode 'roundrobin': peatub, kui iga paar üksusi on juba korra kohtunud (täielik ring läbitud).
// mode 'americano': täidab kogu saadaoleva aja, eelistades ikka värskeid vastasseise.
export function generateFairSlots({ entities, entityPlayers, courts, maxSlots, mode, lastRoundCapacity }) {
  const n = entities.length;
  const matchesPerSlot = Math.max(0, Math.min(courts, Math.floor(n / 2)));
  const capacity = matchesPerSlot * 2;
  const playCount = {};
  entities.forEach((id) => (playCount[id] = 0));
  const pairCount = {};
  const usedPairs = new Set();
  const totalPossiblePairs = (n * (n - 1)) / 2;

  const slots = [];

  // Kui väljakute arv ei ole enam kitsaskoht (courts >= maksimaalne võimalik
  // samaaegsete mängude arv), kasuta deterministlikku ring-meetodit — see väldib
  // juhusliku otsingu ebaõnne, mis vahel oleks vajanud üleliigse lisavooru,
  // kuigi täpne kate mahtus n-1 vooru (paaritu n puhul n vooru, tänu ring-meetodi
  // enda "puhkevooru" loogikale).
  if (matchesPerSlot === Math.floor(n / 2) && n >= 2) {
    for (const pairs of circleMethodRounds(entities)) {
      if (slots.length >= maxSlots) break;
      if (mode === 'roundrobin' && usedPairs.size >= totalPossiblePairs) break;
      pairs.forEach(([a, b]) => {
        const key = pairKey(a, b);
        usedPairs.add(key);
        pairCount[key] = (pairCount[key] || 0) + 1;
        playCount[a] += 1;
        playCount[b] += 1;
      });
      const activeIds = new Set(pairs.flat());
      const resting = entities.filter((id) => !activeIds.has(id));
      slots.push({
        matches: pairs.map(([a, b]) => ({ side1: entityPlayers[a], side2: entityPlayers[b] })),
        resting: resting.flatMap((id) => entityPlayers[id]),
      });
    }
    if (mode === 'roundrobin' || slots.length >= maxSlots) return slots;
    // Americano ja aega jäi veel üle: täieliku ringi kõik paarid on juba kasutatud,
    // seega jätkub allpool olev juhuslik otsing paratamatult mõne kordusega.
  }

  for (let s = slots.length; s < maxSlots && matchesPerSlot > 0; s++) {
    if (mode === 'roundrobin' && usedPairs.size >= totalPossiblePairs) break;

    // Kõik voorud kasutavad täisvõimsust, VÄLJA ARVATUD kõige viimane voor, kui
    // täpse võrdsuse tagamiseks on vaja, et see kasutaks vähem väljakuid (vt
    // resolveExactRoundPlan) — väljak ei jää kunagi tühjaks keset turniiri.
    const roundCapacity = s === maxSlots - 1 && lastRoundCapacity != null ? lastRoundCapacity : capacity;
    const roundMatchesPerSlot = Math.floor(roundCapacity / 2);
    if (roundCapacity <= 0) continue;

    // Õiglus on kohustuslik, mitte soovituslik: kes on seni kõige vähem mänginud, need MANGIVAD.
    // Vabadus vastasseisu valikul (korduste vältimiseks) jääb ainult võrdse mängude arvuga
    // ("piiripealse") grupi sees — nii ei saa värskuse eelistamine kunagi õiglust rikkuda.
    // TÄHTIS: juhuslikkus tuleb SEGAMISEST enne sorteerimist, mitte sort'i comparator'ist
    // enda seest (vt generateAmericanoDoublesSlots kommentaari samal teemal).
    const sorted = shuffle(entities).sort((a, b) => playCount[a] - playCount[b]);
    const boundaryCount = playCount[sorted[roundCapacity - 1]];
    const mandatory = sorted.filter((id) => playCount[id] < boundaryCount);
    const tiedPool = sorted.filter((id) => playCount[id] === boundaryCount);
    const needed = roundCapacity - mandatory.length;

    let best = null;
    let bestScore = Infinity;
    const attempts = Math.max(200, tiedPool.length * 30);
    for (let attempt = 0; attempt < attempts; attempt++) {
      const flexPicks = shuffle(tiedPool).slice(0, needed);
      const active = shuffle([...mandatory, ...flexPicks]);
      const pairs = [];
      for (let g = 0; g < roundMatchesPerSlot; g++) pairs.push([active[g * 2], active[g * 2 + 1]]);
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

// Sama, aga paarismängu jaoks kasutatava korduseta ajastaja (generateExactRoundRobin) järgi —
// annab täpse ajaperioodide arvu, mida seaded-ekraan mängu pikkuse arvutamiseks kasutab.
export function estimateExactRoundRobinSlots(entityCount, courts) {
  if (entityCount < 2 || courts < 1) return 0;
  const entities = Array.from({ length: entityCount }, (_, i) => 'x' + i);
  const entityPlayers = {};
  entities.forEach((id) => (entityPlayers[id] = [id]));
  return generateExactRoundRobin({ entities, entityPlayers, courts }).length;
}

// Arvutab KÕIK kehtivad (täpset võrdsust tagavad) mänguaja-valikud antud mm vahemikus —
// jagatud abifunktsioon, mida kasutavad nii "vali automaatselt parim" (pickRelaxedMatchMinutes/
// pickAmericanoMatchMinutes) kui "näita kuni 5 valikut" (listRelaxedMatchOptions/
// listAmericanoMatchOptions) funktsioonid. Iga voorude arvu kohta jäetakse ainult parim
// (vähim lühendamine, siis rohkem ärakasutatud aega) mänguaeg — muidu näeks kasutaja mitut
// peaaegu identset valikut sama voorude arvuga.
function computeMatchOptions({ n, unitSize, courts, tournamentMinutes, pauseMinutes, mmMin, mmMax }) {
  const byRounds = new Map();
  for (let mm = mmMin; mm <= mmMax; mm++) {
    const plan = resolveExactRoundPlan({ n, unitSize, courts, tournamentMinutes, pauseMinutes, baseMatchMinutes: mm });
    if (!plan.exact || plan.rounds < 1) continue;
    const timeUsed = plan.rounds * mm - plan.shortenedCount + Math.max(0, plan.rounds - 1) * pauseMinutes;
    const candidate = { matchMinutes: mm, rounds: plan.rounds, lastRoundCapacity: plan.lastRoundCapacity, shortenedCount: plan.shortenedCount, timeUsed };
    const existing = byRounds.get(plan.rounds);
    if (
      !existing ||
      candidate.shortenedCount < existing.shortenedCount ||
      (candidate.shortenedCount === existing.shortenedCount && candidate.timeUsed > existing.timeUsed)
    ) {
      byRounds.set(plan.rounds, candidate);
    }
  }
  // Rohkem vooru enne (rohkem varieeruvust) — sama järjestus, mida äpp muidu automaatselt eelistab.
  return [...byRounds.values()].sort((a, b) => b.rounds - a.rounds);
}

// Üksikmängu jaoks: kõik ei pea kõigiga läbi mängima, mängu pikkus jäägu mõistlikku
// 12-20 min vahemikku ja mänge tehakse võimalikult palju ja hajutatult. Kui täielik kate
// (kõik mängivad kõigiga) mahub selle vahemiku sees ära, eelistame pikemat, mugavamat mängu —
// muidu valime lühima lubatud mängu, et voore (ja seega mängijate vahelist hajutatust) tuleks
// võimalikult palju antud turniiriaja sees.
export function pickRelaxedMatchMinutes({ tournamentMinutes, pauseMinutes, entityCount, courts }) {
  const roundsNeeded = estimateRoundsForFullCoverage(entityCount, courts);
  // Alustatakse 11-st (mitte 12-st), sest see on paarismängus juba niigi kehtiv
  // absoluutne alampiir (vt recomputeMatchLength) — parem kasutada seda otse ühtlase
  // mänguajana, kui panna enamik voore "1 minut lühemaks" 12-minutilisest baasist,
  // mis annaks sama tulemuse, aga näeks välja nagu erand, kuigi seda pole.
  const options = computeMatchOptions({ n: entityCount, unitSize: 2, courts, tournamentMinutes, pauseMinutes, mmMin: 11, mmMax: 20 });
  const best = options[0] || null;
  if (!best) return { matchMinutes: 12, rounds: 0, lastRoundCapacity: 0, shortenedCount: 0, fullCoverage: false };
  return {
    matchMinutes: best.matchMinutes,
    rounds: best.rounds,
    lastRoundCapacity: best.lastRoundCapacity,
    shortenedCount: best.shortenedCount,
    fullCoverage: best.rounds >= roundsNeeded,
  };
}

// Sama, aga tagastab KUNI 5 kehtivat valikut (mitte ainult ühte "parimat"), et kasutaja
// saaks ise valida mänguaja/voorude-arvu kombinatsiooni vahel seadete ekraanil.
export function listRelaxedMatchOptions({ tournamentMinutes, pauseMinutes, entityCount, courts }) {
  const options = computeMatchOptions({ n: entityCount, unitSize: 2, courts, tournamentMinutes, pauseMinutes, mmMin: 11, mmMax: 20 });
  return options.slice(0, 5);
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

// ---------------------------------------------------------------------------
// ÜHINE "kui palju vooru, kas viimane voor peab olema väiksema väljakute arvuga
// ja/või mõni voor 1 minut lühem" otsustaja. TÄPNE võrdsus on kohustuslik —
// exact:false EI OLE KUNAGI vastuvõetav lõpptulemus, kutsuja peab sel juhul
// näitama viga (mitte kunagi genereerima ebavõrdset ajakava vaikimisi).
//
// Kaks tööriista, proovitakse selles järjekorras (lihtsam enne):
// 1) Viimane voor võib kasutada vähem väljakuid kui kõik teised (VÄLJAK EI JÄÄ
//    KUNAGI TÜHJAKS KESKEL, ainult kõige viimases voorus, kui vaja) — see ei
//    puuduta mänguaega üldse.
// 2) Kui tööriist 1 ei aita, tehakse (laiali jaotatult, mitte lõppu kuhjatult)
//    mõni voor 1 minut lühem — kõik voorud kasutavad siis kõiki väljakuid.
//
// unitSize: mitu "kohta" üks ajaperiood ühe entity kohta nõuab (paarismängus 2, sest
// paar ise on juba pool mängust; americanos 4, sest 2 paari moodustatakse mängijatest).
// ---------------------------------------------------------------------------
export function resolveExactRoundPlan({ n, unitSize, courts, tournamentMinutes, pauseMinutes, baseMatchMinutes }) {
  const matchesPerSlot = Math.max(0, Math.min(courts, Math.floor(n / unitSize)));
  const capacity = matchesPerSlot * unitSize;
  if (capacity === 0 || n < unitSize || baseMatchMinutes < 1) {
    return { rounds: 0, lastRoundCapacity: 0, shortenedCount: 0, exact: false };
  }

  const timeFor = (rounds, mmSum) => mmSum + Math.max(0, rounds - 1) * pauseMinutes;
  let rTight = 0;
  while (timeFor(rTight + 1, (rTight + 1) * baseMatchMinutes) <= tournamentMinutes) rTight++;

  if (capacity === n) {
    // Kõik mängivad iga voor niikuinii — võrdsus on iseenesest tagatud.
    return { rounds: rTight, lastRoundCapacity: capacity, shortenedCount: 0, exact: true };
  }

  // 1. tööriist: kas rTight vooru (kõik täispikkusega) juures leidub viimasele voorule
  // väljakute-arv, millega kogusumma jagub täpselt? Ei mõjuta mänguaega üldse. lastCap=0
  // tähendaks, et "viimane voor" oleks täiesti tühi — see pole päris voor, seega
  // loetakse see hoopis (rTight-1) täisvõimsusel vooruks (fantoomvooru ei näidata).
  if (rTight >= 1) {
    for (let lastCap = capacity; lastCap > 0; lastCap -= unitSize) {
      const total = (rTight - 1) * capacity + lastCap;
      if (total % n === 0) {
        return { rounds: rTight, lastRoundCapacity: lastCap, shortenedCount: 0, exact: true };
      }
    }
    if (rTight - 1 >= 1 && (rTight - 1) * capacity % n === 0) {
      return { rounds: rTight - 1, lastRoundCapacity: capacity, shortenedCount: 0, exact: true };
    }
  }

  // 2. tööriist: mõni voor 1 minut lühem (kõik väljakud ikka iga voor täis).
  const shortMm = Math.max(1, baseMatchMinutes - 1);
  let rLoose = 0;
  while (timeFor(rLoose + 1, (rLoose + 1) * shortMm) <= tournamentMinutes) rLoose++;

  const period = n / gcd(n, capacity);
  if (period < 1 || period > rLoose) {
    // Isegi kõige lühema lubatud mänguajaga (tööriist 2) ega väiksema viimase vooruga
    // (tööriist 1) ei mahu vajalik voorude arv antud turniiriaja sisse — täpset
    // võrdsust EI SAA saavutada. Kutsuja peab siin näitama viga.
    return { rounds: 0, lastRoundCapacity: 0, shortenedCount: 0, exact: false };
  }
  // Suurim perioodi täiskordne, mis rLoose sisse mahub (rohkem vooru eelistatud) —
  // kuna R <= rLoose, on lühendamisega mahtumine matemaatiliselt garanteeritud.
  const R = Math.floor(rLoose / period) * period;
  const fullTime = timeFor(R, R * baseMatchMinutes);
  const shortenedCount = Math.max(0, fullTime - tournamentMinutes);
  return { rounds: R, lastRoundCapacity: capacity, shortenedCount, exact: true };
}

// Sama "tööriist 1" (viimane voor väiksema väljakute arvuga), aga FIKSEERITUD
// voorude arvu jaoks (mitte turniiriajast tuletatuna) — kasutatakse siis, kui
// play-off on juba voorude arvust osa ära võtnud ja "viimane voor" on nihkunud.
// Tagastab lastRoundCapacity või null, kui täpset lahendust ei leitud (langetakse
// tagasi täisvõimsusele, loomuliku ülimalt 1 mängu vahega).
export function findLastRoundCapacityForRounds(n, unitSize, courts, rounds) {
  const matchesPerSlot = Math.max(0, Math.min(courts, Math.floor(n / unitSize)));
  const capacity = matchesPerSlot * unitSize;
  if (capacity === 0 || rounds < 1 || capacity === n) return null;
  for (let lastCap = capacity; lastCap >= 0; lastCap -= unitSize) {
    const total = (rounds - 1) * capacity + lastCap;
    if (total % n === 0) return lastCap;
  }
  return null;
}

// Jaotab `shortenedCount` "1 minut lühema" vooru laiali üle kogu `rounds` voору
// (mitte lõppu kuhjatult) — tagastab Set'i 0-indekseeritud vooru-numbritega.
export function distributeShortenedRounds(rounds, shortenedCount) {
  const set = new Set();
  if (shortenedCount <= 0 || rounds <= 0) return set;
  const k = Math.min(shortenedCount, rounds);
  for (let i = 0; i < k; i++) {
    set.add(Math.floor(((i + 0.5) * rounds) / k));
  }
  return set;
}

// ---------------------------------------------------------------------------
// ÜKSIKMÄNG PADELIS ("Americano"): padelit ei saa mängida 1 vastu 1, seega mängitakse
// alati 2 vs 2, aga paariline ja vastased loositakse iga vooru uuesti — nii saab igaüks
// võimalikult erinevad paarilised ja vastased kogu turniiri jooksul. See loogika on
// teadlikult täiesti eraldiseisev paarismängu (fikseeritud paariline) omast.
// ---------------------------------------------------------------------------

// Ühe vooru jaoks: vali `capacity` mängijat (kes on seni kõige vähem mänginud), moodusta
// neist paarilised (võimalikult erinevad, kui varem juba koos mängitud) ja seejärel
// pane paarilised üksteise vastu mängima (võimalikult erinevad vastased, kui varem juba
// vastamisi mängitud). Sama juhusliku-otsingu-ja-skoori muster, mida kasutab generateFairSlots.
export function generateAmericanoDoublesSlots({ players, courts, maxSlots, lastRoundCapacity }) {
  const n = players.length;
  const matchesPerSlot = Math.max(0, Math.min(courts, Math.floor(n / 4)));
  if (matchesPerSlot === 0 || n < 4) return [];

  // Ühe vooru "ahne" valik (madalaim skoor) ei näe tervet turniiri ette — see üksi ei
  // taga, et "mängija X mängib mängija Y-ga uuesti, kuigi Z-ga pole veel kordagi
  // mängitud" ei juhtuks. Seepärast genereeritakse esmalt KOGU ajakava, ja SEEJÄREL
  // parandatakse tervet ajakava korraga (vahetatakse mängijate kohti eri voorude
  // vahel, mitte ainult ühe vooru sees) — vt repairScheduleGlobally. Kuna mängude
  // koguarv jääb kohavahetusel muutumatuks (mängija lihtsalt mängib teises voorus
  // sama palju), ei riku see kunagi juba tagatud võrdset mängude arvu. Mõne
  // (eriti lühikese) turniiri puhul jääb puhas "ainult parem" otsing mõnikord
  // kohalikku miinimumi kinni — seepärast proovitakse paar korda uuesti ja jäetakse
  // parim (samamoodi nagu iga üksiku vooru sees juba tehakse).
  const outerAttempts = n <= 14 ? 3 : n <= 22 ? 2 : 1;
  let best = null;
  let bestBadness = Infinity;
  for (let oa = 0; oa < outerAttempts; oa++) {
    const candidate = attemptFullSchedule(players, courts, maxSlots, lastRoundCapacity);
    repairScheduleGlobally(candidate, n, players);
    const badness = scheduleBadness(candidate, n);
    if (badness < bestBadness) {
      bestBadness = badness;
      best = candidate;
      if (badness === 0) break; // parem ei saagi
    }
  }
  return best;
}

// Loeb kokku, kui "halb" ajakava on — iga mängija puuduolevate vastaste arv ruudus
// (nii et "üks mängija kellel palju puudu" on hullem kui "mitu mängijat kellel üks
// puudu") — kasutatakse mitme täieliku katse hulgast parima valimiseks.
function scheduleBadness(slots, n) {
  const oppFaced = {};
  slots.forEach((slot) =>
    slot.matches.forEach((m) => {
      [...m.side1, ...m.side2].forEach((x) => {
        if (!oppFaced[x]) oppFaced[x] = new Set();
      });
      m.side1.forEach((x) => m.side2.forEach((y) => {
        oppFaced[x].add(y);
        oppFaced[y].add(x);
      }));
    })
  );
  let total = 0;
  Object.keys(oppFaced).forEach((p) => {
    const missing = n - 1 - oppFaced[p].size;
    total += missing * missing;
  });
  return total;
}

// Parandab KOGU ajakava korraga: vahetab juhuslikult kahe mängija "kohti" (kes mängib
// millises voorus, kellega paaris ja kelle vastu) — ka eri voorude vahel, mitte ainult
// ühe vooru sees. See annab palju rohkem vabadust kui ühe vooru siseselt otsimine, sest
// kohavahetus ei muuda kummagi mängija KOGU mängude arvu (mõlemad mängivad ikka sama
// palju, lihtsalt osalt erinevates voorudes) — seega ei saa see kunagi rikkuda juba
// tagatud võrdset mängude arvu. Aktsepteeritakse ainult vahetusi, mis ei tee asja
// halvemaks (korduvate paariliste/vastaste koguskoori mõttes).
function repairScheduleGlobally(slots, n, players) {
  const roundArrays = slots.map((slot) => slot.matches.flatMap((m) => [...m.side1, ...m.side2]));
  const numRounds = roundArrays.length;
  if (numRounds < 2) return;

  const partnerCount = {};
  const opponentCount = {};
  const roundPairs = (arr) => {
    const partners = [];
    for (let g = 0; g < arr.length; g += 2) partners.push([arr[g], arr[g + 1]]);
    const opponents = [];
    for (let g = 0; g < arr.length; g += 4) {
      const teamA = [arr[g], arr[g + 1]];
      const teamB = [arr[g + 2], arr[g + 3]];
      teamA.forEach((x) => teamB.forEach((y) => opponents.push([x, y])));
    }
    return { partners, opponents };
  };
  const roundScore = (arr) => {
    const { partners, opponents } = roundPairs(arr);
    let s = 0;
    partners.forEach(([x, y]) => { s += (partnerCount[pairKey(x, y)] || 0) ** 2 * 3; });
    opponents.forEach(([x, y]) => { s += (opponentCount[pairKey(x, y)] || 0) ** 2; });
    return s;
  };
  const applyCounts = (arr, delta) => {
    const { partners, opponents } = roundPairs(arr);
    partners.forEach(([x, y]) => { const k = pairKey(x, y); partnerCount[k] = (partnerCount[k] || 0) + delta; });
    opponents.forEach(([x, y]) => { const k = pairKey(x, y); opponentCount[k] = (opponentCount[k] || 0) + delta; });
  };
  roundArrays.forEach((arr) => applyCounts(arr, 1));

  const globalBadness = () => {
    const oppFaced = {};
    roundArrays.forEach((arr) => {
      const { opponents } = roundPairs(arr);
      opponents.forEach(([x, y]) => {
        if (!oppFaced[x]) oppFaced[x] = new Set();
        if (!oppFaced[y]) oppFaced[y] = new Set();
        oppFaced[x].add(y);
        oppFaced[y].add(x);
      });
    });
    let total = 0;
    Object.keys(oppFaced).forEach((p) => {
      const missing = n - 1 - oppFaced[p].size;
      total += missing * missing;
    });
    return total;
  };
  let bestSnapshot = roundArrays.map((arr) => [...arr]);
  let bestBadness = globalBadness();

  // Puhas "aktsepteeri ainult parem" otsing jääb vahel kohalikku miinimumi kinni
  // (mõni vahetus üksi ei paranda asja, kuigi mitu vahetust koos paranduks) — nn
  // "simulated annealing": alguses aktsepteeritakse vahel ka veidi halvemaid
  // vahetusi (mis aitab kohalikust miinimumist välja pääseda), lõpu poole aina
  // vähem. Kuna vahepeal võib otsing ajutiselt halveneda, jäetakse meelde KÕIGI
  // aegade parim leitud seis (mitte lihtsalt see, millega otsing lõpeb).
  const iterations = Math.min(600000, Math.max(50000, n * n * 1000));
  const checkEvery = Math.max(500, Math.floor(iterations / 100));
  for (let it = 0; it < iterations; it++) {
    const temperature = 3 * (1 - it / iterations);
    const ri = Math.floor(Math.random() * numRounds);
    const rj = Math.floor(Math.random() * numRounds);
    const arrI = roundArrays[ri];
    const arrJ = roundArrays[rj];
    if (!arrI.length || !arrJ.length) continue;
    const pi = Math.floor(Math.random() * arrI.length);
    const pj = Math.floor(Math.random() * arrJ.length);
    if (ri === rj && pi === pj) continue;
    const A = arrI[pi];
    const B = arrJ[pj];
    if (ri === rj) {
      if (A === B) continue;
      const before = roundScore(arrI);
      applyCounts(arrI, -1);
      [arrI[pi], arrI[pj]] = [arrI[pj], arrI[pi]];
      applyCounts(arrI, 1);
      const after = roundScore(arrI);
      const accept = after <= before || Math.random() < Math.exp(-(after - before) / Math.max(0.01, temperature));
      if (!accept) {
        applyCounts(arrI, -1);
        [arrI[pi], arrI[pj]] = [arrI[pj], arrI[pi]];
        applyCounts(arrI, 1);
      }
    } else {
      if (arrI.includes(B) || arrJ.includes(A)) continue; // sama mängija ei tohi ühes voorus kaks korda olla
      const before = roundScore(arrI) + roundScore(arrJ);
      applyCounts(arrI, -1);
      applyCounts(arrJ, -1);
      arrI[pi] = B;
      arrJ[pj] = A;
      applyCounts(arrI, 1);
      applyCounts(arrJ, 1);
      const after = roundScore(arrI) + roundScore(arrJ);
      const accept = after <= before || Math.random() < Math.exp(-(after - before) / Math.max(0.01, temperature));
      if (!accept) {
        applyCounts(arrI, -1);
        applyCounts(arrJ, -1);
        arrI[pi] = A;
        arrJ[pj] = B;
        applyCounts(arrI, 1);
        applyCounts(arrJ, 1);
      }
    }
    if (it % checkEvery === 0) {
      const badness = globalBadness();
      if (badness < bestBadness) {
        bestBadness = badness;
        bestSnapshot = roundArrays.map((arr) => [...arr]);
        if (badness === 0) break; // kõik on juba kõigiga kohtunud — parem ei saagi
      }
    }
  }
  if (globalBadness() > bestBadness) {
    bestSnapshot.forEach((arr, i) => { roundArrays[i] = arr; });
  }

  // Kirjuta parandatud kohad tagasi slots struktuuri (samad väljakud, uued kokkupanekud).
  // TÄHTIS: kohavahetus võib muuta, KES on üldse sel voorul aktiivne (mängija, kes oli
  // enne puhkamas, võib nüüd olla mängus, ja vastupidi) — seepärast tuleb "resting"
  // nimekiri IGA vooru jaoks uuesti arvutada, mitte jätta vana (enne parandust arvutatud)
  // nimekirja alles, muidu võib sama mängija olla korraga nii "puhkab" kui väljakul.
  slots.forEach((slot, si) => {
    const arr = roundArrays[si];
    const matchesPerSlotHere = slot.matches.length;
    for (let mi = 0; mi < matchesPerSlotHere; mi++) {
      slot.matches[mi].side1 = [arr[mi * 4], arr[mi * 4 + 1]];
      slot.matches[mi].side2 = [arr[mi * 4 + 2], arr[mi * 4 + 3]];
    }
    const activeIds = new Set(arr);
    slot.resting = players.filter((id) => !activeIds.has(id));
  });
}

// Ajakava genereerimine ise EI pea enam voorude arvu ega väljakute kasutust kohandama —
// väljakud on IGA voor täisvõimsusel (kunagi ei jää tühjaks), sest õige voorude arv
// (mis tagab võrdsuse) otsustatakse juba ette resolveExactRoundPlan abil (vt
// pickAmericanoMatchMinutes). Kuna kutsuja garanteerib maxSlots*täisvõimsus % n === 0
// alati kui vähegi võimalik, tagab allolev "kes on seni kõige vähem mänginud" valik
// ise täpse võrdsuse — ilma väljakute vähendamiseta.
function attemptFullSchedule(players, courts, maxSlots, lastRoundCapacity) {
  const n = players.length;
  const matchesPerSlot = Math.max(0, Math.min(courts, Math.floor(n / 4)));
  const fullCapacity = matchesPerSlot * 4;

  const playCount = {};
  players.forEach((id) => (playCount[id] = 0));
  const partnerCount = {};
  const opponentCount = {};

  const slots = [];
  for (let s = 0; s < maxSlots; s++) {
    const capacity = s === maxSlots - 1 && lastRoundCapacity != null ? lastRoundCapacity : fullCapacity;
    if (capacity <= 0) continue; // viimane voor jääb täielikult ära (napi väljakute arvu korral)

    // TÄHTIS: juhuslikkus tuleb SEGAMISEST enne sorteerimist, mitte sort'i comparator'ist
    // enda seest (comparator peab andma sama paari jaoks alati sama tulemuse, muidu on
    // sorteerimise tulemus defineerimata/vigane — just see rikkus varem õigluse: mõned
    // mängijad said "seni kõige vähem mänginud" hulka valesti, mis tekitaski ebavõrdse
    // mängude arvu ja tekitas samade vastaste kordumise, kuna aktiivsete mängijate valik
    // polnud tegelikult õiglane).
    const sorted = shuffle(players).sort((a, b) => playCount[a] - playCount[b]);
    const boundaryCount = playCount[sorted[capacity - 1]];
    const mandatory = sorted.filter((id) => playCount[id] < boundaryCount);
    const tiedPool = sorted.filter((id) => playCount[id] === boundaryCount);
    const needed = capacity - mandatory.length;

    // Moodusta paarilised JA pane nad üksteise vastu ÜHE koos otsinguga (mitte kahes
    // eraldi järjestikuses sammus) — kui paarilised valitakse esimesena ilma vastaseid
    // arvestamata, on hiljem vastaste valikuks jäänud ainult käputäis fikseeritud
    // kombinatsioone, mis võivad kõik olla juba varem kohtunud. Ühine otsing saab
    // valida terve vooru korraga nii, et nii paarilised KUI vastased oleks võimalikult
    // erinevad varasemast.
    let best = null;
    let bestScore = Infinity;
    const attempts = Math.max(600, capacity * 150);
    for (let a = 0; a < attempts; a++) {
      const flexPicks = shuffle(tiedPool).slice(0, needed);
      const active = shuffle([...mandatory, ...flexPicks]);
      const teams = [];
      for (let g = 0; g < capacity; g += 2) teams.push([active[g], active[g + 1]]);
      const matches = [];
      for (let g = 0; g < teams.length; g += 2) matches.push([teams[g], teams[g + 1]]);

      let score = 0;
      teams.forEach(([x, y]) => {
        score += (partnerCount[pairKey(x, y)] || 0) ** 2 * 3; // korduv paariline on halvem kui korduv vastane
      });
      matches.forEach(([teamA, teamB]) => {
        teamA.forEach((x) => teamB.forEach((y) => {
          score += (opponentCount[pairKey(x, y)] || 0) ** 2;
        }));
      });

      if (score < bestScore) {
        bestScore = score;
        best = { teams, matches };
        if (score === 0) break;
      }
    }
    const { teams: bestTeams, matches: bestMatches } = best;

    bestTeams.forEach(([x, y]) => {
      partnerCount[pairKey(x, y)] = (partnerCount[pairKey(x, y)] || 0) + 1;
    });
    bestMatches.forEach(([teamA, teamB]) => {
      teamA.forEach((x) => teamB.forEach((y) => {
        opponentCount[pairKey(x, y)] = (opponentCount[pairKey(x, y)] || 0) + 1;
      }));
      [...teamA, ...teamB].forEach((id) => (playCount[id] += 1));
    });

    const activeIds = new Set(bestTeams.flat());
    const resting = players.filter((id) => !activeIds.has(id));
    slots.push({
      matches: bestMatches.map(([teamA, teamB]) => ({ side1: teamA, side2: teamB })),
      resting,
    });
  }
  return slots;
}

// Kui palju erinevaid paarilisi-kombinatsioone (mitte "vooru") on olemas kokku ja mitu
// vooru kuluks, et igaüks saaks (arvutuslikult) vähemalt korra kõigiga paariliseks —
// kasutatakse ainult mängu pikkuse soovitamiseks, mitte tegeliku ajakava tagamiseks
// (täielik paariliste kate pole americanos kunagi garanteeritud, ainult eesmärk).
export function estimateAmericanoPartnerRoundsNeeded(playerCount, courts) {
  const matchesPerSlot = Math.max(0, Math.min(courts, Math.floor(playerCount / 4)));
  if (matchesPerSlot === 0 || playerCount < 4) return 0;
  const totalPartnerPairs = (playerCount * (playerCount - 1)) / 2;
  const partnerPairsPerRound = matchesPerSlot * 2;
  return Math.ceil(totalPartnerPairs / partnerPairsPerRound);
}

// Sama loogika, mis pickRelaxedMatchMinutes, aga americano (2 vs 2, loositavad paarilised)
// jaoks eraldi, sest "vooru mahutavus" on siin neljakaupa, mitte kahekaupa.
//
// ROHKEM VOORE ON TÄHTSAM KUI PIKEM MÄNG: rohkem voore tähendab rohkem erinevaid
// paarilisi ja vastaseid, mis on mängijatele olulisem kui mugavam, aga vähem
// varieeruvusega pikem mäng. Seepärast proovitakse KÕIKI mänguaegu 12-20 min
// vahemikus ja valitakse see, mis annab kõige ROHKEM päriselt mängitud voore
// (vt resolveExactRoundPlan, kus võrdsuse tagamiseks võib mõni voor olla 1 minut
// lühem — väljak ei jää kunagi tühjaks) — see toob praktikas peaaegu alati 12-14 min
// mängu, sest lühem mäng mahutab rohkem voore. "fullCoverage" (kas kõik jõuavad
// kõigiga paariliseks) on siin ainult INFO kuvamiseks, mitte peatumistingimus.
export function pickAmericanoMatchMinutes({ tournamentMinutes, pauseMinutes, playerCount, courts }) {
  const roundsNeeded = estimateAmericanoPartnerRoundsNeeded(playerCount, courts);
  const options = computeMatchOptions({ n: playerCount, unitSize: 4, courts, tournamentMinutes, pauseMinutes, mmMin: 12, mmMax: 20 });
  const best = options[0] || null;
  if (!best) return { matchMinutes: 12, rounds: 0, lastRoundCapacity: 0, shortenedCount: 0, fullCoverage: false };
  return {
    matchMinutes: best.matchMinutes,
    rounds: best.rounds,
    lastRoundCapacity: best.lastRoundCapacity,
    shortenedCount: best.shortenedCount,
    fullCoverage: best.rounds >= roundsNeeded,
  };
}

// Sama, aga tagastab KUNI 5 kehtivat valikut (mitte ainult ühte "parimat"), et kasutaja
// saaks ise valida mänguaja/voorude-arvu kombinatsiooni vahel seadete ekraanil.
export function listAmericanoMatchOptions({ tournamentMinutes, pauseMinutes, playerCount, courts }) {
  const options = computeMatchOptions({ n: playerCount, unitSize: 4, courts, tournamentMinutes, pauseMinutes, mmMin: 12, mmMax: 20 });
  return options.slice(0, 5);
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
// Märkus: Firestore ei luba massiive, mis sisaldavad otse teisi massiive, seega
// "rounds" hoitakse kujul [{matches:[...]}, ...], mitte otse [[...], ...].
export function generateBracket(entities) {
  const k = entities.length;
  const order = seedOrder(k);
  const round0 = [];
  for (let i = 0; i < k / 2; i++) {
    const e1 = entities[order[i * 2] - 1];
    const e2 = entities[order[i * 2 + 1] - 1];
    round0.push({ id: 'm-r0-' + i, slot1: { entityId: e1.id }, slot2: { entityId: e2.id }, score1: null, score2: null, winnerId: null });
  }
  const roundsRaw = [round0];
  let prevCount = round0.length;
  let r = 1;
  while (prevCount > 1) {
    const roundMatches = [];
    for (let i = 0; i < prevCount / 2; i++) {
      roundMatches.push({
        id: `m-r${r}-${i}`,
        slot1: { fromMatch: roundsRaw[r - 1][i * 2].id },
        slot2: { fromMatch: roundsRaw[r - 1][i * 2 + 1].id },
        score1: null,
        score2: null,
        winnerId: null,
      });
    }
    roundsRaw.push(roundMatches);
    prevCount = roundMatches.length;
    r++;
  }
  let thirdPlace = null;
  if (k >= 4) {
    const semiRound = roundsRaw[roundsRaw.length - 2];
    thirdPlace = {
      id: 'm-3rd',
      slot1: { fromMatch: semiRound[0].id, loser: true },
      slot2: { fromMatch: semiRound[1].id, loser: true },
      score1: null,
      score2: null,
      winnerId: null,
    };
  }
  return { rounds: roundsRaw.map((matches) => ({ matches })), thirdPlace };
}
