import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, applyAction, snakePicker, publicRoom, validateLineup, generatedRoom, canProgress, standings } from '../game/state.ts';
import { generatePlayer, rating, addTrait, publicPlayer, progressPlayer, autoLineup } from '../game/players.ts';
import { POSITIONS, TRAITS, FORMATIONS } from '../game/catalog.ts';
import { rng, scopeSeed } from '../game/random.ts';
import { simulateMatch, replayHash, adaptPlayer, ENGINE_VERSION } from '../game/match.ts';
import { frameAt, scoreAt, bufferedUntil } from '../game/replay.ts';
import type { Room, Replay, PlayerStat } from '../game/types.ts';
import { fixture, A, B } from './fixture.ts';
import Engine from '../vendor/football-simulator/RealTimeEngine.ts';
import EngineTeam from '../vendor/football-simulator/Team.ts';
import { Position as EP } from '../vendor/football-simulator/enums/Position.ts';
test('rewinding after a late resume cannot play across unfetched replay chunks', () => {
    assert.equal(bufferedUntil(new Set([90, 91]), 0, 5500), 0);
    assert.equal(bufferedUntil(new Set([0, 90, 91]), 30, 5500), 59);
    assert.equal(bufferedUntil(new Set([0, 1, 90, 91]), 30, 5500), 119);
    assert.equal(bufferedUntil(new Set([90, 91]), 5400, 5500), 5500);
});
test('a veteran-only squad can finish a season without a young-player award crash', () => {
    let r = fixture();
    r.current_round = 10;
    r.clubs.forEach(c => c.players.forEach(p => { p.age = 30; }));
    r.matches.push({ id: 'veterans', season: 1, round: 10, home: r.clubs[0].id, away: r.clubs[1].id,
        state: 'GENERATED', score: [0, 0], duration: 5400, stats: {}, replay_hash: 'fixed', engine_version: 'test', result_locked: true });
    r.view.veterans = { [A]: 5400, [B]: 5400 };
    r.active_match = 'veterans';
    r = applyAction(r, A, { type: 'settle', match_id: 'veterans', request_id: 'veterans-settle' });
    assert.equal(r.state, 'OFFSEASON');
    assert.equal(r.champions[0].awards['最佳年轻球员'], '暂无符合球员');
    assert.equal(r.clubs[0].youth.length, 3);
});
test('a shot crossing the goal plane keeps its intersection rather than its overshoot', () => {
    const r = fixture();
    const teams = r.clubs.map((c, i) => new EngineTeam(i === 0, c.name, c.lineup.map((id, n) => adaptPlayer(c.players.find(p => p.id === id)!, n === 0 ? EP.GK : EP.ST, n + 1, rng(n + 1)))));
    const engine = new Engine(teams[0], teams[1], { random: rng(42), tickSeconds: 1 });
    engine.start();
    const shooter = engine.state.players.find(p => p.side === 'home' && p.role !== EP.GK)!;
    engine.state.ball.owner = null;
    engine.state.ball.x = 100;
    engine.state.ball.y = 32;
    engine.state.ball.velocity = { x: 20, y: 6 };
    engine.state.activeBallAction = { type: 'shot', from: shooter, teamSide: 'home', origin: { x: 100, y: 32 }, target: { x: 105, y: 33.5 }, quality: .8, inaccurate: false };
    (engine as unknown as {
        movePlayersAndBall(): void;
    }).movePlayersAndBall();
    assert.equal(engine.state.ball.x, 105);
    assert.equal(engine.state.ball.y, 33.5);
});
test('keeper exchange cannot leave either club below two keepers', () => {
    let r = fixture();
    r.state = 'OFFSEASON';
    r = applyAction(r, A, { type: 'offer', player_id: r.clubs[0].players.find(p => p.position === 'GK')!.id, exchange: r.clubs[1].players.find(p => p.position === 'ST')!.id, money: 0 });
    assert.throws(() => applyAction(r, B, { type: 'accept_offer', offer_id: r.transfers[0].id }), /2名门将/);
});
test('hidden physical risks reserve a legal trait slot and apply before discovery', () => {
    const used: string[] = [];
    for (let i = 0; i < 100; i++) {
        const p = generatePlayer(91, 'hidden-' + i, 'ST', true, used);
        for (const hidden of p.h!.hidden_traits) {
            const kind = TRAITS.find(t => t.id === hidden)!.kind;
            assert.equal(p.traits.filter(t => TRAITS.find(d => d.id === t)?.kind === kind).length, 0);
            const before = adaptPlayer(p, EP.ST, 9, rng(1));
            p.h!.hidden_traits = p.h!.hidden_traits.filter(t => t !== hidden);
            assert.ok(addTrait(p, hidden));
            const after = adaptPlayer(p, EP.ST, 9, rng(1));
            assert.deepEqual(before.attributes, after.attributes);
        }
    }
});
test('automatic selection gives an exhausted starter time to recover', () => {
    const c = fixture().clubs[0];
    const starter = c.players.find(p => p.id === c.lineup[1])!;
    starter.fitness = 0;
    const lineup = autoLineup(c);
    assert.ok(!lineup.includes(starter.id));
});
test('retired players remain in sanitized alumni and the academy preserves a playable squad', () => {
    let r = fixture();
    r.state = 'OFFSEASON';
    r.clubs[0].players[0].age = 39;
    const retired = r.clubs[0].players[0].id;
    r = applyAction(r, A, { type: 'next_season', season: 1 });
    r = applyAction(r, B, { type: 'next_season', season: 1 });
    assert.ok(!r.clubs[0].players.some(p => p.id === retired));
    assert.ok(r.clubs[0].alumni?.some(p => p.id === retired));
    assert.equal(r.clubs[0].players.length, 18);
    assert.ok(r.clubs[0].history.some(h => h.includes('退役')));
    assert.ok(!JSON.stringify(publicRoom(r, A)).includes('true_potential'));
});
const action = (room: Room, type: string, extra: Record<string, unknown> = {}) => ({ type, round: room.current_round, season: room.current_season, request_id: crypto.randomUUID(), ...extra });
test('seed scopes are reproducible and independent', () => { assert.equal(scopeSeed(42, 'draft'), scopeSeed(42, 'draft')); assert.notEqual(scopeSeed(42, 'draft'), scopeSeed(42, 'match')); assert.equal(rng(42)(), rng(42)()); });
test('snake order selects six each', () => { assert.deepEqual(Array.from({ length: 12 }, (_, i) => snakePicker(i)), [0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0]); });
test('room creation starts with one club and unique identity', () => { const r = createRoom(crypto.randomUUID(), 'ABC123', A, '教练', { type: 'create', name: '测试' }, 42); assert.equal(r.clubs.length, 1); assert.equal(r.state, 'WAITING_PLAYER'); });
test('third player cannot join a full room', () => { assert.throws(() => applyAction(fixture(), 'C', { type: 'join', name: '第三队' }), /满员/); });
test('wrong draft picker cannot choose', () => { let r = createRoom(crypto.randomUUID(), 'ABC123', A, '甲', { type: 'create' }, 42); r = applyAction(r, B, { type: 'join' }, '乙'); assert.throws(() => applyAction(r, B, { type: 'pick', turn: 0, player_id: r.draft.candidates[0].id }), /轮到朋友/); });
test('a stale pick cannot consume the next choice', () => { let r = createRoom(crypto.randomUUID(), 'ABC123', A, '甲', { type: 'create' }, 42); r = applyAction(r, B, { type: 'join' }, '乙'); const p = r.draft.candidates[0]; r = applyAction(r, A, { type: 'pick', turn: 0, player_id: p.id }); assert.throws(() => applyAction(r, A, { type: 'pick', turn: 0, player_id: p.id }), /更新/); });
test('same pick request is idempotent', () => { let r = createRoom(crypto.randomUUID(), 'ABC123', A, '甲', { type: 'create' }, 42); r = applyAction(r, B, { type: 'join' }, '乙'); const a = { type: 'pick', turn: 0, player_id: r.draft.candidates[0].id, request_id: 'same-pick' }; r = applyAction(r, A, a); assert.equal(applyAction(r, A, a).revision, r.revision); assert.equal(r.draft.picks.length, 1); });
test('reload retains exact draft and roster', () => { const r = fixture(); assert.deepEqual(JSON.parse(JSON.stringify(r)), r); });
test('draft completes with two 18-player squads and six founders', () => { const r = fixture(); for (const c of r.clubs) {
    assert.equal(c.players.length, 18);
    assert.equal(c.players.filter(p => p.founding_player).length, 6);
    assert.equal(c.players.filter(p => p.position === 'GK').length, 2);
    assert.equal(c.lineup.length, 11);
} assert.equal(r.state, 'SEASON'); });
test('random supporting squads stay close without mirroring', () => { const r = fixture(); const means = r.clubs.map(c => c.players.filter(p => !p.founding_player).reduce((n, p) => n + rating(p), 0) / 12); assert.ok(Math.abs(means[0] - means[1]) <= 1.1); assert.notDeepEqual(r.clubs[0].players.map(p => p.attrs), r.clubs[1].players.map(p => p.attrs)); });
test('1000 generated players have legal attributes and unique nicknames', () => { const used: string[] = []; for (let i = 0; i < 1000; i++) {
    const pos = Object.keys(POSITIONS)[i % 8] as keyof typeof POSITIONS;
    const p = generatePlayer(42, 'p' + i, pos, i % 2 === 0, used);
    assert.ok(p.attrs.every(a => a >= 1 && a <= 100));
    assert.ok(p.h!.true_potential <= 95);
    assert.equal(new Set(p.traits).size, p.traits.length);
} assert.equal(new Set(used).size, 1000); });
test('all position weights sum to one', () => { for (const p of Object.values(POSITIONS))
    assert.ok(Math.abs(p.weights.reduce((a, b) => a + b, 0) - 1) < 1e-10); });
test('striker rating uses the specified weights', () => { assert.equal(rating({ position: 'ST', attrs: [90, 80, 60, 70, 30, 80, 80] }), Math.round(90 * .2 + 80 * .3 + 60 * .07 + 70 * .15 + 30 * .03 + 80 * .15 + 80 * .1)); });
test('keeper rating uses keeper skills independently', () => { assert.equal(rating({ position: 'GK', attrs: [95, 95, 80, 20, 80, 80, 80] }), Math.round(95 * .27 + 95 * .24 + 80 * .14 + 20 * .12 + 80 * .1 + 80 * .08 + 80 * .05)); });
test('private player data never appears in serialized public objects', () => { const r = fixture(); const safe = JSON.stringify(publicRoom(r, A)); for (const forbidden of ['true_potential', 'professionalism', 'hidden_traits', 'injury_proneness', '"growth"', '"changes"'])
    assert.ok(!safe.includes(forbidden), forbidden); assert.equal(publicPlayer(r.clubs[0].players[0]).h, undefined); });
test('trait inventory includes at least 70 entries and 10 gold traits', () => { assert.ok(TRAITS.length >= 70); assert.ok(TRAITS.filter(t => t.kind === 'legend').length >= 10); });
test('style traits cap at two and personality and body cap at one', () => { const p = generatePlayer(42, 't', 'ST', true, []); p.traits = ['喜欢射门']; assert.ok(addTrait(p, '喜欢带球')); assert.equal(addTrait(p, '积极拦截'), false); p.traits = ['喜欢射门']; assert.ok(addTrait(p, '职业球员')); assert.equal(addTrait(p, '领袖'), false); assert.ok(addTrait(p, '铁人')); assert.equal(addTrait(p, '柔韧'), false); });
test('conflicting body traits never coexist', () => { const p = generatePlayer(42, 't', 'ST', true, []); p.traits = ['铁人']; assert.equal(addTrait(p, '玻璃人'), false); p.traits = ['耐力怪']; assert.equal(addTrait(p, '体能槽浅'), false); });
test('gold traits occupy a separate single slot', () => { const p = generatePlayer(42, 't', 'ST', true, []); p.traits = []; assert.ok(addTrait(p, '双足怪')); assert.equal(addTrait(p, '足球智商'), false); });
test('all four formations have 11 slots and one keeper', () => { for (const f of Object.values(FORMATIONS)) {
    assert.equal(f.length, 11);
    assert.equal(f.filter(x => x === 'GK').length, 1);
} });
test('all four automatic formations contain unique players', () => { const c = fixture().clubs[0]; for (const f of Object.keys(FORMATIONS) as (keyof typeof FORMATIONS)[]) {
    const ids = autoLineup(c, f);
    assert.equal(new Set(ids).size, 11);
    validateLineup(c, f, ids);
} });
test('duplicate, opponent, and injured lineups are rejected', () => { const r = fixture(), c = r.clubs[0]; assert.throws(() => validateLineup(c, '4-3-3', Array(11).fill(c.lineup[0])), /11/); assert.throws(() => validateLineup(c, '4-3-3', [r.clubs[1].players[0].id, ...c.lineup.slice(1)]), /不可出场/); c.players.find(p => p.id === c.lineup[1])!.injury = 2; assert.throws(() => validateLineup(c, c.formation, c.lineup), /不可出场/); });
test('a non-member cannot change another club', () => { assert.throws(() => applyAction(fixture(), 'C', { type: 'train', player_id: 'x' }), /成员/); });
test('training another owner player fails', () => { const r = fixture(); assert.throws(() => applyAction(r, A, action(r, 'train', { player_id: r.clubs[1].players[0].id, route: '终结者' })), /你的球员/); });
test('READY by only one player cannot generate a match', () => { let r = fixture(); r = applyAction(r, A, action(r, 'ready')); assert.equal(r.active_match, null); assert.equal(r.matches.length, 0); });
test('both READY produce one stable match identity', () => { let r = fixture(); r = applyAction(r, A, action(r, 'ready')); r = applyAction(r, B, action(r, 'ready')); const id = r.active_match; r = applyAction(r, B, action(r, 'ready')); assert.equal(r.matches.length, 1); assert.equal(r.active_match, id); });
test('READY locks training, lineup and tactics', () => { let r = fixture(); r = applyAction(r, A, action(r, 'ready')); assert.throws(() => applyAction(r, A, action(r, 'train', { player_id: r.clubs[0].players[0].id, route: '终结者' })), /锁定/); assert.throws(() => applyAction(r, A, action(r, 'lineup', { auto: true, formation: '4-4-2' })), /锁定/); });
test('READY may only be cancelled before both are ready', () => { let r = fixture(); r = applyAction(r, A, action(r, 'ready')); r = applyAction(r, A, action(r, 'cancel_ready')); assert.equal(r.clubs[0].ready, false); r = applyAction(r, A, action(r, 'ready')); r = applyAction(r, B, action(r, 'ready')); assert.throws(() => applyAction(r, A, action(r, 'cancel_ready')), /锁定/); });
test('unwatched final scores and statistics are hidden', () => { const r = fixture(); r.matches.push({ id: 'm', season: 1, round: 1, home: r.clubs[0].id, away: r.clubs[1].id, state: 'GENERATED', duration: 5400, score: [2, 1], stats: {}, replay_hash: 'hash', engine_version: 'e', result_locked: true }); r.view.m = { [A]: 3000, [B]: 5400 }; assert.equal(publicRoom(r, A).matches[0].score, null); assert.deepEqual(publicRoom(r, B).matches[0].score, [2, 1]); });
test('progress checks reject seeking and accept normal 4x playback', () => { assert.ok(canProgress(0, 720, 5400, 10000)); assert.equal(canProgress(0, 5400, 5400, 1000), false); assert.equal(canProgress(100, 90, 5400, 1000), false); });
test('visible score counts only already-played goals', () => { const e = [{ time: 100, type: 'GOAL', side: 'home' }, { time: 300, type: 'GOAL', side: 'away' }] as Replay['events']; assert.deepEqual(scoreAt(e, 200), [1, 0]); });
test('coordinates interpolate from replay without a second simulation', () => { const f = [{ t: 0, ball: [0, 0], p: [['x', 0, 0, 100, 0]], phase: 'open_play' }, { t: 1, ball: [10, 10], p: [['x', 10, 10, 99, 0]], phase: 'open_play' }] as Replay['frames']; assert.deepEqual(frameAt(f, .5)?.ball, [5, 5]); });
test('100 growth settlements stay within trait-change and attribute limits', () => { const p = generatePlayer(42, 'growth', 'ST', true, []); p.h!.true_potential = 95; const s = { goals: 2, shots: 5, minutes: 90, rating: 9, fitness: 80, tackles: 1, passes: 15, completed: 12, dribbles: 5, starts: true, assists: 1, injured: 0, yellow: 0, red: 0, saves: 0 } as PlayerStat; for (let i = 0; i < 100; i++)
    progressPlayer(p, s, i); assert.ok(p.h!.changes <= 2); assert.ok(p.attrs.every(a => a <= 100)); assert.ok(p.traits.length <= 5); });
test('permanent physical vulnerabilities are not washed away', () => { const p = generatePlayer(42, 'glass', 'W', true, []); p.traits = ['喜欢带球', '玻璃人']; p.h!.hidden_traits = []; for (let i = 0; i < 100; i++)
    progressPlayer(p, undefined, i); assert.ok(p.traits.includes('玻璃人')); });
test('a transfer requires the recipient and exact ownership', () => { const r = fixture(); r.state = 'OFFSEASON'; const a = action(r, 'offer', { player_id: r.clubs[0].players[0].id, exchange: r.clubs[1].players[0].id, money: 1000 }); const offered = applyAction(r, A, a); assert.throws(() => applyAction(offered, A, action(offered, 'accept_offer', { offer_id: offered.transfers[0].id })), /收到报价/); });
test('transfer acceptance swaps players and cash once', () => { let r = fixture(); r.state = 'OFFSEASON'; const p = r.clubs[0].players[0].id, q = r.clubs[1].players[0].id; r = applyAction(r, A, action(r, 'offer', { player_id: p, exchange: q, money: 1000 })); const accept = action(r, 'accept_offer', { offer_id: r.transfers[0].id }); r = applyAction(r, B, accept); assert.ok(r.clubs[0].players.some(p => p.id === q)); assert.ok(r.clubs[1].players.some(x => x.id === p)); assert.equal(r.clubs[0].cash, 14000); assert.equal(applyAction(r, B, accept).clubs[0].cash, 14000); });
test('negative or overdraft transfer money is rejected', () => { const r = fixture(); r.state = 'OFFSEASON'; assert.throws(() => applyAction(r, A, action(r, 'offer', { player_id: r.clubs[0].players[0].id, money: -1 })), /无效/); assert.throws(() => applyAction(r, A, action(r, 'offer', { player_id: r.clubs[0].players[0].id, money: 999999 })), /无效/); });
test('season standings use goals after points and difference', () => { const r = fixture(); r.clubs[0].points = r.clubs[1].points = 10; r.clubs[0].gf = 10; r.clubs[0].ga = 8; r.clubs[1].gf = 11; r.clubs[1].ga = 9; assert.equal(standings(r)[0].id, r.clubs[1].id); });
test('new seasons require both players and never repeat the draft', () => { let r = fixture(); r.state = 'OFFSEASON'; r = applyAction(r, A, action(r, 'next_season')); assert.equal(r.state, 'OFFSEASON'); r = applyAction(r, B, action(r, 'next_season')); assert.equal(r.state, 'SEASON'); assert.equal(r.current_season, 2); assert.equal(r.current_round, 1); assert.equal(r.draft.turn, 12); assert.equal(r.clubs[0].players.length, 18); });
test('the same seed repeats ten complete 90-minute matches with identical frames, events and hash', async () => {
    const r = fixture();
    const first = await simulateMatch(r.clubs[0], r.clubs[1], 99, 'deterministic-full');
    for (let run = 1; run < 10; run++) {
        assert.deepEqual(await simulateMatch(r.clubs[0], r.clubs[1], 99, 'deterministic-full'), first);
    }
    assert.equal(first.replay_hash, await replayHash(first));
    assert.equal(first.engine_version, ENGINE_VERSION);
    assert.ok(first.duration >= 5400);
    assert.equal(first.frames[0].p.length, 22);
    assert.ok(first.events.some(e => e.type === 'FULL_TIME'));
});
test('normal full match has complete 90-minute replay, halftime and legal coordinates', async () => { const r = fixture(); const replay = await simulateMatch(r.clubs[0], r.clubs[1], 123, 'full'); assert.ok(replay.duration >= 5400); assert.ok(replay.events.some(e => e.type === 'HALF_TIME')); assert.ok(replay.events.some(e => e.type === 'FULL_TIME')); assert.ok(replay.frames.every(f => f.ball.every(v => v >= 0 && v <= 100) && f.p.every(p => p[1] >= 0 && p[1] <= 100 && p[2] >= 0 && p[2] <= 100))); assert.deepEqual(scoreAt(replay.events, replay.duration), replay.result); });
test('locked generated results cannot be replaced or settled before both watched', async () => { let r = fixture(); r = applyAction(r, A, action(r, 'ready')); r = applyAction(r, B, action(r, 'ready')); const replay = await simulateMatch(r.clubs[0], r.clubs[1], 99, r.active_match!, { length: 600 }); r = generatedRoom(r, replay); const tampered = { ...replay, result: [99, 99] } as Replay; assert.deepEqual(generatedRoom(r, tampered).matches[0].score, replay.result); assert.throws(() => applyAction(r, A, action(r, 'settle', { match_id: replay.match_id })), /看完/); });
test('adapter changes keeper and specialized actions without universal buffs', () => { const p = generatePlayer(42, 'adapter', 'ST', true, []); p.traits = []; const a = adaptPlayer(p, 24, 9, rng(1)); p.traits = ['精准射手']; const b = adaptPlayer(p, 24, 9, rng(1)); assert.ok(b.attributes.finishing > a.attributes.finishing); assert.equal(a.attributes.pace, b.attributes.pace); });
