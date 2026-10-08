/** Real Supabase API acceptance. Uses two dedicated username accounts. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { ROUTES } from '../game/catalog.ts';
import { snakePicker } from '../game/state.ts';
import type { GameAction, Room, Replay, ReplayEvent, ReplayFrame } from '../game/types.ts';
for (const filename of ['.env.local', '.env.integration']) {
    try {
        for (const line of (await readFile(filename, 'utf8')).split('\n')) {
            const match = line.match(/^([A-Z_]+)=(.*)$/);
            if (match && !process.env[match[1]])
                process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
        }
    }
    catch { /* Environment variables also work in CI. */ }
}
const required = (key: string) => {
    const value = process.env[key];
    if (!value)
        throw new Error(`Set ${key}; test credentials are never shipped with the project.`);
    return value;
};
const url = required('NEXT_PUBLIC_SUPABASE_URL');
const key = required('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
type Session = {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user: {
        id: string;
    };
};
type Meta = Pick<Replay, 'match_id' | 'duration' | 'replay_hash' | 'lineups' | 'tactics' | 'engine_version'> & {
    frames: ReplayFrame[];
    events: ReplayEvent[];
    last_viewed_second: number;
    result: Replay['result'] | null;
    stats: Replay['stats'] | null;
    generating?: boolean;
};
class Client {
    private session!: Session;
    private expires = 0;
    constructor(private label: string) { }
    async login() {
        const username = process.env[`QA_${this.label}_USERNAME`];
        const response = await fetch(url + (username ? '/functions/v1/mfc-game' : '/auth/v1/token?grant_type=password'), {
            method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
            body: JSON.stringify(username
                ? { type: 'login_username', username, password: required(`QA_${this.label}_PASSWORD`) }
                : { email: required(`QA_${this.label}_EMAIL`), password: required(`QA_${this.label}_PASSWORD`) }),
        });
        assert.equal(response.status, 200, `${this.label}: use a valid dedicated test account`);
        this.session = await response.json() as Session;
        this.expires = Date.now() + this.session.expires_in * 1000;
    }
    get user() { return this.session.user.id; }
    async request<T>(action: GameAction): Promise<T> {
        if (Date.now() > this.expires - 60000)
            await this.login();
        const response = await fetch(url + '/functions/v1/mfc-game', {
            method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + this.session.access_token, 'Content-Type': 'application/json' },
            body: JSON.stringify(action),
        });
        const data = await response.json();
        if (!response.ok)
            throw new Error(`${action.type}: ${data.error || response.status}`);
        const text = JSON.stringify(data);
        for (const secret of ['true_potential', 'professionalism', 'injury_proneness', 'hidden_traits']) {
            assert.ok(!text.includes(secret), `hidden field leaked: ${secret}`);
        }
        return data as T;
    }
}
const a = new Client('A'), b = new Client('B');
await a.login();
await b.login();
assert.notEqual(a.user, b.user);
const checks: {
    test: string;
    passed: boolean;
    [key: string]: unknown;
}[] = [];
let room = (await a.request<{
    room: Room;
}>({ type: 'create', request_id: crypto.randomUUID(), name: '验收海风队', short: '海风', color: '#d8ed78' })).room;
const mutation = async (client: Client, type: string, extra: Record<string, unknown> = {}, request_id = crypto.randomUUID()) => {
    room = (await client.request<{
        room: Room;
    }>({ type, room_id: room.id, round: room.current_round, season: room.current_season, request_id, ...extra })).room;
};
const mark = (test: string, extra: Record<string, unknown> = {}) => { checks.push({ test, passed: true, ...extra }); console.log('PASS', test); };
await mutation(b, 'join', { code: room.join_code, name: '验收晚霞队', short: '晚霞', color: '#ec916f' });
mark('two real accounts create and join');
for (let turn = 0; turn < 12; turn++) {
    const client = snakePicker(turn) === 0 ? a : b;
    const request = crypto.randomUUID();
    const extra = { turn, player_id: room.draft.candidates[0].id };
    await mutation(client, 'pick', extra, request);
    if (turn === 0) {
        await mutation(client, 'pick', extra, request);
        assert.equal(room.draft.turn, 1);
    }
}
for (const club of room.clubs) {
    assert.equal(club.players.length, 18);
    assert.equal(club.players.filter(p => p.founding_player).length, 6);
}
mark('snake draft, duplicate request, two complete rosters');
await mutation(a, 'train', { player_id: room.clubs[0].players[0].id, route: ROUTES[room.clubs[0].players[0].position][1] });
await mutation(a, 'lineup', { formation: '4-4-2', auto: true });
await mutation(b, 'lineup', { formation: '4-2-3-1', auto: true });
await mutation(a, 'tactics', { tactic: { attack: '边路进攻', defense: '区域防守', mentality: '平衡' } });
await mutation(b, 'tactics', { tactic: { attack: '快速反击', defense: '低位防守', mentality: '保守' } });
mark('training, lineups and tactics');
async function watch() {
    const match = room.matches.find(m => m.id === room.active_match)!;
    assert.ok(match.result_locked);
    assert.equal(match.score, null);
    const frames: ReplayFrame[] = [], events: ReplayEvent[] = [];
    let previous = -1, finalA: Meta | undefined, finalB: Meta | undefined;
    for (let chunk = 0; chunk <= Math.floor(match.duration / 60); chunk++) {
        const request: GameAction = { type: chunk === 0 ? 'replay' : 'progress', match_id: match.id, room_id: room.id, chunk, second: chunk * 60 };
        const ma = await a.request<Meta>(request), mb = await b.request<Meta>(request);
        assert.equal(ma.replay_hash, mb.replay_hash);
        assert.deepEqual(ma.frames, mb.frames);
        assert.deepEqual(ma.events, mb.events);
        for (const frame of ma.frames) {
            assert.ok(frame.t > previous);
            previous = frame.t;
            assert.ok(frame.ball.every(v => v >= 0 && v <= 100));
            assert.ok(frame.p.every(p => p[1] >= 0 && p[1] <= 100 && p[2] >= 0 && p[2] <= 100));
        }
        if (chunk * 60 < match.duration) {
            assert.equal(ma.result, null);
            assert.equal(mb.result, null);
        }
        frames.push(...ma.frames);
        events.push(...ma.events);
        finalA = ma;
        finalB = mb;
        await pause(950); // Keep both viewers within the server's real-time playback bound.
    }
    if (finalA!.last_viewed_second < match.duration) {
        const request = { type: 'progress', match_id: match.id, room_id: room.id, chunk: Math.floor(match.duration / 60), second: match.duration };
        finalA = await a.request<Meta>(request);
        finalB = await b.request<Meta>(request);
    }
    assert.deepEqual(finalA!.result, finalB!.result);
    assert.deepEqual(finalA!.stats, finalB!.stats);
    assert.deepEqual(finalA!.result, ['home', 'away'].map(side => events.filter(e => e.type === 'GOAL' && e.side === side).length));
    assert.ok(events.some(e => e.type === 'HALF_TIME'));
    assert.ok(events.some(e => e.type === 'FULL_TIME'));
    assert.equal(frames.at(-1)!.t, match.duration);
    const receipt = crypto.randomUUID();
    await mutation(a, 'settle', { match_id: match.id }, receipt);
    const before = structuredClone(room.clubs);
    await mutation(a, 'settle', { match_id: match.id }, receipt);
    assert.deepEqual(room.clubs, before);
    mark(`season ${match.season} round ${match.round}: complete replay, same result, one growth settlement`, { frames: frames.length, events: events.length, score: finalA!.result, hash: finalA!.replay_hash });
}
for (let game = 0; game < 11; game++) {
    await mutation(a, 'ready');
    assert.equal(room.active_match, null);
    await mutation(b, 'ready');
    await watch();
    if (game === 9) {
        assert.equal(room.state, 'OFFSEASON');
        assert.equal(room.champions.length, 1);
        room = (await a.request<{
            room: Room;
        }>({ type: 'get', room_id: room.id })).room;
        assert.equal(room.clubs[0].youth.length, 3);
        const rb = (await b.request<{
            room: Room;
        }>({ type: 'get', room_id: room.id })).room;
        assert.equal(rb.clubs[1].youth.length, 3);
        await mutation(a, 'youth_sign', { player_id: room.clubs[0].youth[0].id });
        await mutation(a, 'offer', { player_id: room.clubs[0].players.find(p => p.position === 'ST')!.id, exchange: room.clubs[1].players.find(p => p.position === 'ST')!.id, money: 500 });
        const receipt = crypto.randomUUID(), offer = room.transfers.at(-1)!;
        await mutation(b, 'accept_offer', { offer_id: offer.id }, receipt);
        const before = structuredClone(room.clubs);
        await mutation(b, 'accept_offer', { offer_id: offer.id }, receipt);
        assert.deepEqual(before, room.clubs);
        await mutation(a, 'next_season');
        await mutation(b, 'next_season');
        assert.equal(room.current_season, 2);
        assert.equal(room.draft.turn, 12);
        mark('champion, youth, atomic transfer, second season without re-drafting');
    }
}
const first = room.matches[0];
const historic = await a.request<Meta>({ type: 'replay', room_id: room.id, match_id: first.id, chunk: 0 });
assert.equal(historic.replay_hash, first.replay_hash);
assert.deepEqual(historic.result, first.score);
mark('first season replay is unchanged after second season');
await mkdir('reports', { recursive: true });
await writeFile('reports/integration-results.json', JSON.stringify({ date: new Date().toISOString(), room: room.id, passed: checks.length, checks }, null, 2));
console.log(`Integration passed: ${checks.length} checks. This verifies the real API; browser/PixiJS verification remains a separate step.`);
