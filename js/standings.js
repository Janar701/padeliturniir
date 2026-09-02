// Pingerea arvutamine mängija (mitte paari) põhiselt — töötab nii üksik- kui paarismängu
// ja Americano puhul, kus partnerid vahetuvad.

// Kuidas võitja/pingerida selgub — vt app.js "Võitja selgub" seadet:
// 'wins'         — kõige rohkem võidetud mänge
// 'points'       — kõige rohkem kogutud geimipunkte (skooride summa)
// 'leaguePoints' — võit 4p, viik 2p, kaotus 0p, kõige rohkem kogunenud punkte
export function metricValue(row, method) {
  if (method === 'points') return row.pointsFor;
  if (method === 'leaguePoints') return row.wins * 4 + row.draws * 2;
  return row.wins;
}

export function methodLabel(method) {
  if (method === 'points') return 'kogutud geimipunktide';
  if (method === 'leaguePoints') return 'võit/viik/kaotus punktide';
  return 'võitude';
}

function sortByMethod(rows, method) {
  return [...rows].sort((a, b) => {
    const diff = metricValue(b, method) - metricValue(a, method);
    if (diff !== 0) return diff;
    const diffA = a.pointsFor - a.pointsAgainst;
    const diffB = b.pointsFor - b.pointsAgainst;
    if (diffB !== diffA) return diffB - diffA;
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
    return a.name.localeCompare(b.name, 'et');
  });
}

function buildIndividualRows(tournament) {
  const table = {};
  tournament.players.forEach((p) => {
    table[p.id] = { id: p.id, name: p.name, wins: 0, losses: 0, draws: 0, played: 0, pointsFor: 0, pointsAgainst: 0 };
  });

  tournament.slots.forEach((slot) => {
    slot.matches.forEach((m) => {
      if (m.score1 == null || m.score2 == null) return;
      const side1 = m.side1Players || m.side1;
      const side2 = m.side2Players || m.side2;
      const s1 = m.score1;
      const s2 = m.score2;
      const applySide = (ids, own, opp) => {
        ids.forEach((id) => {
          const row = table[id];
          if (!row) return;
          row.played += 1;
          row.pointsFor += own;
          row.pointsAgainst += opp;
          if (own > opp) row.wins += 1;
          else if (own < opp) row.losses += 1;
          else row.draws += 1;
        });
      };
      applySide(side1, s1, s2);
      applySide(side2, s2, s1);
    });
  });

  return Object.values(table);
}

// Paaripõhine — paarilised mängivad kogu turniiri koos, nii et paari tulemus on
// lihtsalt selle paari mängude summa.
function buildTeamRows(tournament) {
  if (!tournament.teams || !tournament.teams.length) return [];
  const playerToTeam = {};
  tournament.teams.forEach((team) => team.playerIds.forEach((pid) => (playerToTeam[pid] = team.id)));
  const nameForTeam = (team) =>
    team.playerIds.map((pid) => (tournament.players.find((p) => p.id === pid) || {}).name || '?').join(' & ');

  const table = {};
  tournament.teams.forEach((team) => {
    table[team.id] = { id: team.id, name: nameForTeam(team), wins: 0, losses: 0, draws: 0, played: 0, pointsFor: 0, pointsAgainst: 0 };
  });

  tournament.slots.forEach((slot) => {
    slot.matches.forEach((m) => {
      if (m.score1 == null || m.score2 == null) return;
      const team1 = playerToTeam[m.side1[0]];
      const team2 = playerToTeam[m.side2[0]];
      const apply = (teamId, own, opp) => {
        const row = table[teamId];
        if (!row) return;
        row.played += 1;
        row.pointsFor += own;
        row.pointsAgainst += opp;
        if (own > opp) row.wins += 1;
        else if (own < opp) row.losses += 1;
        else row.draws += 1;
      };
      apply(team1, m.score1, m.score2);
      apply(team2, m.score2, m.score1);
    });
  });

  return Object.values(table);
}

export function computeStandings(tournament, method = 'wins') {
  return sortByMethod(buildIndividualRows(tournament), method);
}

export function computeTeamStandings(tournament, method = 'wins') {
  return sortByMethod(buildTeamRows(tournament), method);
}

// Kui palju mänge on igale MÄNGIJALE ajakavas kokku planeeritud (kõik voorud, olenemata
// sellest, kas tulemus on juba sisestatud). Pingerea "played" loeb ainult juba sisestatud
// tulemustega mänge, seega näitab see keset turniiri paratamatult erinevaid numbreid eri
// paaride/mängijate vahel (nemad ei ole veel kõik sama arvu voore mänginud/tulemust
// sisestanud) — see EI tähenda, et ajakava ise oleks ebavõrdne. See funktsioon annab
// "kokku plaanis" numbri, mida saab "senini mängitud" numbri kõrval näidata, et vahe
// oleks kasutajale selge (vt renderTournamentScreen/renderPlayoffScreen "Mänge" veerg).
export function computeScheduledCounts(tournament) {
  const counts = {};
  tournament.players.forEach((p) => (counts[p.id] = 0));
  (tournament.slots || []).forEach((slot) => {
    slot.matches.forEach((m) => {
      const side1 = m.side1Players || m.side1;
      const side2 = m.side2Players || m.side2;
      [...side1, ...side2].forEach((id) => {
        if (counts[id] != null) counts[id] += 1;
      });
    });
  });
  return counts;
}

// Sama, aga paari (mitte üksikmängija) kohta — paarilised mängivad alati koos, seega
// paari kokku-plaanitud mängude arv on lihtsalt ühe paarilise oma.
export function computeTeamScheduledCounts(tournament) {
  const perPlayer = computeScheduledCounts(tournament);
  const counts = {};
  (tournament.teams || []).forEach((team) => {
    counts[team.id] = perPlayer[team.playerIds[0]] || 0;
  });
  return counts;
}

// Kui pingerea tipus on viik valitud meetodi järgi, proovi mõne teise meetodiga leida
// ühene juht — kasutatakse "hetkel juhib / võitja" bänneris viigi korral vihjena.
export function findLeaderWithTieInfo(standings, method) {
  const played = standings.filter((r) => r.played > 0);
  if (!played.length) return null;
  const topVal = metricValue(played[0], method);
  const tiedLeaders = played.filter((r) => metricValue(r, method) === topVal);
  if (tiedLeaders.length <= 1) {
    return { leader: played[0], tie: false };
  }
  const otherMethods = ['wins', 'leaguePoints', 'points'].filter((m) => m !== method);
  for (const altMethod of otherMethods) {
    const altSorted = sortByMethod(tiedLeaders, altMethod);
    const altTop = metricValue(altSorted[0], altMethod);
    const altTied = altSorted.filter((r) => metricValue(r, altMethod) === altTop);
    if (altTied.length === 1) {
      return { leader: played[0], tie: true, altLeader: altSorted[0], altMethod };
    }
  }
  return { leader: played[0], tie: true, altLeader: null, altMethod: null };
}
