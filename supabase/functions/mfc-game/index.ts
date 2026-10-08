import { applyAction, createRoom, publicRoom } from '../../../game/state.ts';
import { simulateMatch, matchSeed } from '../../../game/match.ts';
import { TRAITS } from '../../../game/catalog.ts';
import { usernameAuth } from './account-auth.ts';
import type { Room, GameAction, ReplayFrame, ReplayEvent } from '../../../game/types.ts';
declare const Deno: {
    env: {
        get: (key: string) => string | undefined;
    };
    serve: (handler: (req: Request) => Promise<Response>) => void;
};
const url = Deno.env.get('SUPABASE_URL')!;
const admin = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
type DBResult = {
    conflict?: boolean;
    busy?: boolean;
    done?: boolean;
    token?: string;
    room?: Room;
    [key: string]: unknown;
};
async function rpc<T>(action: string, user: string, data: unknown): Promise<T> { const res = await fetch(url + '/rest/v1/rpc/mfc_rpc', { method: 'POST', headers: { apikey: admin, Authorization: 'Bearer ' + admin, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_action: action, p_user: user, p_data: data }) }); const json = await res.json(); if (!res.ok)
    throw new Error(json.message || '数据保存失败'); return json as T; }
async function ensureMatch(room: Room, user: string) {
    if (!room.active_match)
        return;
    const summary = room.matches.find(m => m.id === room.active_match);
    if (!summary || summary.result_locked)
        return;
    const seed = matchSeed(room.seed, room.current_season, room.current_round);
    const claimed = await rpc<DBResult>('claim', user, { room_id: room.id, match_id: room.active_match, seed });
    if (!claimed.token || !claimed.room)
        return;
    const c = claimed.room.clubs;
    const home = c.find(c => c.id === summary.home)!, away = c.find(c => c.id === summary.away)!;
    try {
        const replay = await simulateMatch(home, away, seed, summary.id);
        const chunks = Array.from({ length: Math.floor(replay.duration / 60) + 1 }, (_, index) => ({ index, frames: [] as ReplayFrame[], events: [] as ReplayEvent[] }));
        for (const frame of replay.frames)
            chunks[Math.floor(frame.t / 60)].frames.push(frame);
        for (const event of replay.events)
            chunks[Math.floor(event.time / 60)].events.push(event);
        for (let i = 0; i < chunks.length; i += 12)
            await rpc('stage_chunks', user, { room_id: room.id, match_id: summary.id, token: claimed.token, chunks: chunks.slice(i, i + 12) });
        await rpc('complete', user, { room_id: room.id, match_id: summary.id, token: claimed.token, replay: { ...replay, frames: [], events: [] }, chunk_count: chunks.length, frame_count: replay.frames.length, event_count: replay.events.length });
    }
    catch (error) {
        await rpc('release_claim', user, { room_id: room.id, match_id: summary.id, token: claimed.token }).catch(() => { });
        throw error;
    }
}
Deno.serve(async (req) => {
    if (req.method === 'OPTIONS')
        return new Response('ok', { headers });
    if (req.method !== 'POST')
        return new Response(JSON.stringify({ error: '仅支持POST' }), { status: 405, headers });
    try {
        const authorization = req.headers.get('Authorization');
        if (!authorization?.startsWith('Bearer '))
            return new Response(JSON.stringify({ error: '请先登录' }), { status: 401, headers });
        const raw = await req.text();
        if (raw.length > 20000) throw new Error('请求过大');
        const a = JSON.parse(raw) as GameAction;
        if (!a || typeof a.type !== 'string') throw new Error('操作无效');
        if (a.type === 'register_username' || a.type === 'login_username') {
            const session = await usernameAuth(req, { ...a, type: a.type }, { url, admin, anon });
            return new Response(JSON.stringify(session), { headers });
        }
        const auth = await fetch(url + '/auth/v1/user', { headers: { apikey: anon, Authorization: authorization } });
        if (!auth.ok)
            return new Response(JSON.stringify({ error: '登录已过期，请重新登录' }), { status: 401, headers });
        const user = await auth.json() as {
            id: string;
            user_metadata?: {
                username?: string;
            };
        };
        const profile = await rpc<{
            username: string;
        }>('profile', user.id, { username: user.user_metadata?.username });
        let result: unknown;
        if (a.type === 'list') {
            result = { rooms: await rpc('list', user.id, {}), username: profile.username };
        }
        else if (a.type === 'create') {
            if (typeof a.request_id !== 'string' || a.request_id.length < 8 || a.request_id.length > 100) throw new Error('请求标识无效');
            const random = new Uint32Array(1);
            crypto.getRandomValues(random);
            const code = crypto.randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase();
            const room = createRoom(crypto.randomUUID(), code, user.id, profile.username, a, random[0]);
            result = { room: publicRoom(await rpc<Room>('create', user.id, { room, request_id: a.request_id }), user.id) };
        }
        else if (a.type === 'replay' || a.type === 'progress') {
            result = await rpc(a.type, user.id, { room_id: a.room_id, match_id: a.match_id, chunk: a.chunk, second: a.second });
        }
        else if (a.type === 'catalog') {
            result = { traits: TRAITS };
        }
        else {
            let room = await rpc<Room>(a.type === 'join' ? 'join_load' : 'load', user.id, a.type === 'join' ? { code: typeof a.code === 'string' ? a.code.toUpperCase() : '' } : { room_id: a.room_id });
            if (a.type !== 'get') {
                if (typeof a.request_id !== 'string' || a.request_id.length < 8 || a.request_id.length > 100)
                    throw new Error('请求标识无效');
                for (let i = 0; i < 4; i++) {
                    const updated = applyAction(room, user.id, a, profile.username);
                    if (updated.revision === room.revision)
                        break;
                    const saved = await rpc<Room & DBResult>('commit', user.id, { room_id: room.id, revision: room.revision, request_id: a.request_id, room: updated, join: a.type === 'join' });
                    if (!saved.conflict) {
                        room = saved;
                        break;
                    }
                    room = await rpc<Room>('load', user.id, { room_id: room.id });
                    if (i === 3)
                        throw new Error('朋友也在操作，请稍后再试');
                }
            }
            await ensureMatch(room, user.id);
            room = await rpc<Room>('load', user.id, { room_id: room.id });
            result = { room: publicRoom(room, user.id), username: profile.username };
        }
        return new Response(JSON.stringify(result), { headers });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : '操作失败';
        return new Response(JSON.stringify({ error: message.includes('duplicate key') ? '用户名或房间码重复，请换一个再试' : message }), { status: 400, headers });
    }
});
