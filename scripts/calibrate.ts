import { writeFileSync } from 'node:fs';
import { fixture } from '../tests/fixture.ts';
import { simulateMatch, ENGINE_VERSION, SIM_VERSION } from '../game/match.ts';
import { autoLineup } from '../game/players.ts';
import { scopeSeed } from '../game/random.ts';
import type { Formation, Tactic } from '../game/types.ts';

const count = Number(process.argv[2] || 160);
const tick = Number(process.argv[3] || 1);
if (!Number.isInteger(count) || count < 4 || count > 10000 || count % 4 || ![.5, 1].includes(tick)) {
    throw new Error('Use a count divisible by 4 (4–10000) and a tick of 0.5 or 1.');
}
const group = () => ({ games: 0, goals: 0, shots: 0, homeGoals: 0, awayGoals: 0, homeShots: 0, awayShots: 0, homeWins: 0, awayWins: 0, draws: 0, scoreless: 0 });
const balanced = group(), strong = group();
const cpuMs: number[] = [];
const results = { count, tick, engine_version: ENGINE_VERSION, simulation_version: SIM_VERSION,
    fixtures: 0, extreme: 0, reds: 0, injuries: 0, strongerHomeGames: 0, strongerAwayGames: 0,
    strongerHomeWins: 0, strongerAwayWins: 0, upsets: 0, balanced, strong };
const formations: Formation[] = ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2'];
const tactics: Tactic[] = [
    { attack: '中路渗透', defense: '区域防守', mentality: '平衡' },
    { attack: '边路进攻', defense: '高位压迫', mentality: '激进' },
    { attack: '快速反击', defense: '低位防守', mentality: '保守' },
];
for (let i = 0; i < count; i++) {
    const pair = Math.floor(i / 2);
    const fixtureIndex = Math.floor(pair / 2);
    const r = fixture(scopeSeed(71, 'fixture:' + fixtureIndex));
    const clubs = r.clubs;
    const boosted = pair % 2 === 1;
    clubs.forEach((c, index) => {
        c.formation = formations[(fixtureIndex + index * 2) % formations.length];
        c.tactic = tactics[(fixtureIndex + index) % tactics.length];
        if (boosted && index === 0) c.players.forEach(p => p.attrs = p.attrs.map(v => Math.min(100, v + 15)) as typeof p.attrs);
        c.lineup = autoLineup(c);
    });
    const strongerHome = i % 2 === 0;
    const [home, away] = strongerHome ? clubs : [clubs[1], clubs[0]];
    const start = process.cpuUsage();
    const replay = await simulateMatch(home, away, scopeSeed(71, 'paired:' + pair), 'batch-' + i, { frames: false, tick });
    const cpu = process.cpuUsage(start);
    cpuMs.push((cpu.user + cpu.system) / 1000);
    const [h, a] = replay.result;
    const selected = boosted ? strong : balanced;
    selected.games++;
    selected.goals += h + a;
    selected.shots += replay.team_stats.home.shots + replay.team_stats.away.shots;
    selected.homeGoals += h;
    selected.awayGoals += a;
    selected.homeShots += replay.team_stats.home.shots;
    selected.awayShots += replay.team_stats.away.shots;
    selected.homeWins += h > a ? 1 : 0;
    selected.awayWins += a > h ? 1 : 0;
    selected.draws += h === a ? 1 : 0;
    selected.scoreless += h + a === 0 ? 1 : 0;
    results.extreme += h + a >= 8 ? 1 : 0;
    results.reds += replay.team_stats.home.red + replay.team_stats.away.red;
    results.injuries += replay.events.filter(e => e.type === 'INJURY').length;
    if (boosted) {
        if (strongerHome) { results.strongerHomeGames++; results.strongerHomeWins += h > a ? 1 : 0; }
        else { results.strongerAwayGames++; results.strongerAwayWins += a > h ? 1 : 0; }
        results.upsets += (strongerHome ? h < a : a < h) ? 1 : 0;
    }
    if ((i + 1) % 20 === 0) console.log('Simulated', i + 1, '/', count);
}
results.fixtures = count / 4;
cpuMs.sort((a, b) => a - b);
const totalGoals = balanced.goals + strong.goals, totalShots = balanced.shots + strong.shots;
const report = { ...results, meanGoals: totalGoals / count, meanShots: totalShots / count,
    scorelessRate: (balanced.scoreless + strong.scoreless) / count,
    strongerWinRate: (results.strongerHomeWins + results.strongerAwayWins) / strong.games,
    upsetRate: results.upsets / strong.games,
    cpu_mean_ms: cpuMs.reduce((n, value) => n + value, 0) / count,
    cpu_p95_ms: cpuMs[Math.ceil(cpuMs.length * .95) - 1],
    cpu_max_ms: cpuMs.at(-1),
    method: `${count / 4} seeded rosters at n=${count}; varied formations and tactics; paired swapped home/away; half have one club +15 attributes; no frames; not a proof of balance.` };
if (process.argv[4]) writeFileSync(process.argv[4], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
