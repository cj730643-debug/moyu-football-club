import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyCareer } from '../game/types.ts';
import type { Career, PlayerStat, ReplayEvent, Room } from '../game/types.ts';
import { evaluateLegacy } from '../game/legacy.ts';
import { decisiveScorer, simulateMatch } from '../game/match.ts';
import { applyAction, publicRoom } from '../game/state.ts';
import { fixture, A, B } from './fixture.ts';

const goal = (time: number, side: 'home' | 'away', player: string): ReplayEvent =>
    ({ time, type: 'GOAL', side, player, secondary: null, text: '进球', x: 100, y: 50 });
const stat = (extra: Partial<PlayerStat> = {}): PlayerStat => ({
    name: '球员', side: 'home', position: 'ST', goals: 0, assists: 0, shots: 0, saves: 0,
    passes: 0, completed: 0, tackles: 0, fouls: 0, offsides: 0, yellow: 0, red: 0,
    minutes: 90, rating: 7, fitness: 75, injured: 0, chances: 0, dribbles: 0, starts: true, ...extra,
});
function finish(input: Room, id: string, stats: Record<string, PlayerStat>, score: [number, number] = [1, 0]) {
    const r = structuredClone(input);
    r.matches.push({ id, season: r.current_season, round: r.current_round, home: r.clubs[0].id,
        away: r.clubs[1].id, state: 'GENERATED', score, duration: 5400, stats,
        replay_hash: 'immutable-' + id, engine_version: 'test', result_locked: true });
    r.view[id] = { [A]: 5400, [B]: 5400 };
    r.active_match = id;
    return applyAction(r, A, { type: 'settle', match_id: id });
}
test('the decisive scorer scores the winner’s goal exceeding the losing final total, not the last goal', () => {
    const events = [goal(10, 'home', 'first'), goal(20, 'away', 'loser'), goal(30, 'home', 'winner'), goal(40, 'home', 'last')];
    assert.equal(decisiveScorer(events, [3, 1]), 'winner');
    assert.equal(decisiveScorer(events, [3, 3]), null);
});
test('an away victory credits exactly its decisive goal and a goalless draw credits none', () => {
    assert.equal(decisiveScorer([goal(10, 'away', 'away'), goal(20, 'away', 'extra')], [0, 2]), 'away');
    assert.equal(decisiveScorer([], [0, 0]), null);
});
test('a complete simulated replay credits one decisive goal only when its actual score has a winner', async () => {
    const r = fixture(83);
    const replay = await simulateMatch(r.clubs[0], r.clubs[1], 732, 'decisive-full');
    const credited = Object.entries(replay.stats).filter(([, s]) => s.decisive_goals);
    assert.equal(credited.length, replay.result[0] === replay.result[1] ? 0 : 1);
    if (credited.length) {
        assert.equal(credited[0][0], decisiveScorer(replay.events, replay.result));
        assert.ok(credited[0][1].goals > 0);
    }
});
test('settlement credits decisive goals, injuries and unique club seasons once', () => {
    const r = fixture();
    const id = r.clubs[0].lineup[10];
    const a = finish(r, 'stats-1', { [id]: stat({ goals: 1, decisive_goals: 1, injured: 2 }) });
    const b = finish(a, 'stats-2', { [id]: stat({ goals: 1, decisive_goals: 1 }) });
    const p = b.clubs[0].players.find(p => p.id === id)!;
    const record = b.clubs[0].records![id];
    assert.equal(p.career.decisive_goals, 2);
    assert.equal(p.seasonStats.decisive_goals, 2);
    assert.equal(record.stats.decisive_goals, 2);
    assert.equal(record.stats.injuries, 1);
    assert.equal(record.stats.seasons, 1);
    const repeated = applyAction(b, B, { type: 'settle', match_id: 'stats-2' });
    assert.deepEqual(repeated.clubs, b.clubs);
    assert.deepEqual(repeated.matches, b.matches);
});
test('legacy match statistics without the new decisive field remain compatible', () => {
    const r = fixture();
    const id = r.clubs[0].lineup[10];
    const next = finish(r, 'old-stats', { [id]: stat({ goals: 1 }) });
    assert.equal(next.clubs[0].players.find(p => p.id === id)!.career.decisive_goals, 0);
    assert.equal(next.matches[0].replay_hash, 'immutable-old-stats');
});
test('an unused substitute cannot receive man of the match over a player who appeared', () => {
    const r = fixture();
    const starter = r.clubs[0].lineup[10];
    const bench = r.clubs[0].players.find(p => !r.clubs[0].lineup.includes(p.id))!.id;
    const next = finish(r, 'unused-best', { [starter]: stat({ rating: 7 }), [bench]: stat({ minutes: 0, rating: 10 }) });
    assert.equal(next.clubs[0].players.find(p => p.id === starter)!.career.man_of_match, 1);
    assert.equal(next.clubs[0].players.find(p => p.id === bench)!.career.man_of_match, 0);
});
test('a season title credits both personal and participating club records without inventing bench appearances', () => {
    const r = fixture();
    r.current_round = 10;
    const id = r.clubs[0].lineup[10];
    const next = finish(r, 'champion', { [id]: stat({ goals: 1, decisive_goals: 1 }) });
    const p = next.clubs[0].players.find(p => p.id === id)!;
    assert.equal(p.career.trophies, 1);
    assert.equal(p.seasonStats.trophies, 1);
    assert.equal(next.clubs[0].records![id].stats.trophies, 1);
    assert.ok(next.clubs[0].youth.every(p => p.club_seasons === 0 && p.career.seasons === 0));
});
test('all six contribution titles are attainable with service and role-appropriate contributions', () => {
    const contributions = (apps: number, extra: Partial<Career> = {}) => ({ ...emptyCareer(), appearances: apps, starts: apps, minutes: apps * 90, ...extra });
    const titles = [
        evaluateLegacy('ST', emptyCareer(), 1).title,
        evaluateLegacy('ST', contributions(10), 1).title,
        evaluateLegacy('ST', contributions(40, { goals: 12 }), 3).title,
        evaluateLegacy('CM', contributions(50, { assists: 30 }), 4).title,
        evaluateLegacy('GK', contributions(70, { clean_sheets: 40, trophies: 3 }), 7).title,
        evaluateLegacy('ST', contributions(120, { goals: 80, decisive_goals: 30, trophies: 7 }), 12).title,
    ];
    assert.deepEqual(titles, ['普通球员', '主力球员', '功勋球员', '俱乐部明星', '俱乐部传奇', '队史最佳之一']);
});
test('a long-serving unused founder cannot become a club legend', () => {
    assert.equal(evaluateLegacy('ST', { ...emptyCareer(), trophies: 20 }, 20, true).title, '普通球员');
});
test('transferred career goals and attributes cannot grant a title in a new club', () => {
    const r = fixture();
    const p = r.clubs[0].players[0];
    p.attrs.fill(100);
    p.career.goals = 500;
    p.career.appearances = 500;
    p.career.trophies = 30;
    const visible = publicRoom(r, A).clubs[0].players[0];
    assert.equal(visible.legacy!.title, '普通球员');
    assert.equal(visible.club_stats!.goals, 0);
});
test('a trade preserves origin contributions and resets destination tenure until its first season', () => {
    let r = fixture();
    r.state = 'OFFSEASON';
    const p = r.clubs[0].players[0], q = r.clubs[1].players[0];
    p.club_seasons = 5;
    r.clubs[0].records![p.id] = { name: p.original_nickname, position: p.position,
        stats: { ...emptyCareer(), appearances: 45, starts: 45, goals: 30 }, last_season: 1 };
    r = applyAction(r, A, { type: 'offer', player_id: p.id, exchange: q.id });
    r = applyAction(r, B, { type: 'accept_offer', offer_id: r.transfers[0].id });
    const incoming = publicRoom(r, B).clubs[1].players.find(x => x.id === p.id)!;
    assert.equal(incoming.club_seasons, 0);
    assert.equal(incoming.founding_player, false);
    assert.equal(incoming.legacy!.title, '普通球员');
    assert.equal(r.clubs[0].alumni![0].club_stats!.goals, 30);
    r = applyAction(r, A, { type: 'next_season', season: 1 });
    r = applyAction(r, B, { type: 'next_season', season: 1 });
    const playing = r.clubs[1].players.find(x => x.id === p.id)!;
    assert.equal(playing.club_seasons, 1);
    assert.equal(playing.club_tenure![r.clubs[0].id], 5);
});
test('returning players resume the original club tenure and contributions', () => {
    let r = fixture(); r.state = 'OFFSEASON';
    const p = r.clubs[0].players[0], q = r.clubs[1].players[0];
    p.club_seasons = 4;
    r = applyAction(r, A, { type: 'offer', player_id: p.id, exchange: q.id });
    r = applyAction(r, B, { type: 'accept_offer', offer_id: r.transfers[0].id });
    r = applyAction(r, B, { type: 'offer', player_id: p.id, exchange: q.id });
    r = applyAction(r, A, { type: 'accept_offer', offer_id: r.transfers[1].id });
    assert.equal(r.clubs[0].players.find(x => x.id === p.id)!.club_seasons, 4);
    assert.equal(publicRoom(r, A).clubs[0].players.find(x => x.id === p.id)!.founding_player, true);
});
test('retirement freezes its title, club contribution and completed tenure before replacement players join', () => {
    let r = fixture(); r.state = 'OFFSEASON'; r.current_season = 8;
    const p = r.clubs[0].players[0]; p.age = 39; p.club_seasons = 8;
    r.clubs[0].records![p.id] = { name: p.original_nickname, position: p.position,
        stats: { ...emptyCareer(), appearances: 75, starts: 75, minutes: 6750, goals: 60, decisive_goals: 20 }, last_season: 8 };
    r = applyAction(r, A, { type: 'next_season', season: 8 });
    r = applyAction(r, B, { type: 'next_season', season: 8 });
    const archive = publicRoom(r, A).clubs[0].alumni!.find(x => x.id === p.id)!;
    assert.equal(archive.retirement!.evaluation.title, '俱乐部传奇');
    assert.equal(archive.retirement!.season, 8);
    assert.equal(archive.club_seasons, 8);
    assert.equal(archive.club_stats!.decisive_goals, 20);
    assert.equal(archive.h, undefined);
    assert.ok(r.clubs[0].players.filter(x => x.id.includes('academy')).every(x => x.club_seasons === 1 && x.career.seasons === 1));
});
