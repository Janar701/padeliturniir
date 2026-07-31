// Pingerea arvutamine mängija (mitte paari) põhiselt — töötab nii üksik- kui paarismängu
// ja Americano puhul, kus partnerid vahetuvad.
export function computeStandings(tournament) {
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

  return Object.values(table).sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    const diffA = a.pointsFor - a.pointsAgainst;
    const diffB = b.pointsFor - b.pointsAgainst;
    if (diffB !== diffA) return diffB - diffA;
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
    return a.name.localeCompare(b.name, 'et');
  });
}

// Paaripõhine pingerida paarismängu jaoks — paarilised mängivad kogu turniiri koos,
// nii et paari tulemus on lihtsalt selle paari mängude summa.
export function computeTeamStandings(tournament) {
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

  return Object.values(table).sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    const diffA = a.pointsFor - a.pointsAgainst;
    const diffB = b.pointsFor - b.pointsAgainst;
    if (diffB !== diffA) return diffB - diffA;
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
    return a.name.localeCompare(b.name, 'et');
  });
}
