import { applyAction, generatedRoom, publicRoom } from '../game/state.ts';
import { COMPUTER_USER, createSoloRoom, respondComputer, SOLO_USER } from '../game/solo.ts';
import type { GameAction, Replay, Room } from '../game/types.ts';
import { BrowserSoloStore } from './solo-store.ts';
import type { SoloStore } from './solo-store.ts';

export interface SoloArchive { game: 'moyu-football'; mode: 'solo'; version: 1; room: Room; replays: Replay[] }

export class SoloCampaign {
    private cachedReplay: Replay | null = null;
    private tail: Promise<unknown> = Promise.resolve();
    constructor(private readonly store: SoloStore) {}
    private serial<T>(operation: () => Promise<T>): Promise<T> {
        const run = async (): Promise<T> => {
            if (typeof navigator !== 'undefined' && navigator.locks)
                return await navigator.locks.request('mfc.solo.campaign', async () => await operation());
            return operation();
        };
        const pending = this.tail.then(run, run);
        this.tail = pending.catch(() => {});
        return pending;
    }
    async start(action: GameAction = { type: 'create', name: '午休联队', short: '午休' }): Promise<Room> {
        return this.serial(async () => {
            const old = await this.store.loadRoom();
            if (old) return publicRoom(old, SOLO_USER);
            const random = new Uint32Array(1);
            crypto.getRandomValues(random);
            const room = createSoloRoom(action, random[0]);
            await this.store.saveRoom(room);
            return publicRoom(room, SOLO_USER);
        });
    }
    private async replay(id: string): Promise<Replay> {
        if (this.cachedReplay?.match_id === id) return this.cachedReplay;
        const replay = await this.store.loadReplay(id);
        if (!replay) throw new Error('找不到比赛录像，请重新打开存档');
        this.cachedReplay = replay;
        return replay;
    }
    async api<T>(action: GameAction): Promise<T> {
        return this.serial(async () => {
            const room = await this.store.loadRoom();
            if (action.type === 'list') return { username: '午休教练', rooms: room ? [{ id: room.id, join_code: 'SOLO', state: room.state, season: room.current_season, clubs: room.clubs.map(c => c.name) }] : [] } as T;
            if (!room) throw new Error('请先开始单人游戏');
            if (action.room_id && action.room_id !== room.id) throw new Error('存档已切换，请重新进入游戏');
            if (action.type === 'get') return { room: publicRoom(room, SOLO_USER) } as T;
            if (['replay', 'progress', 'solo_skip'].includes(action.type)) {
                const match = room.matches.find(m => m.id === action.match_id);
                if (!match?.result_locked) throw new Error('比赛录像还未生成');
                const replay = await this.replay(match.id);
                const chunk = action.type === 'solo_skip' ? Math.floor(replay.duration / 60) : Number(action.chunk || 0);
                if (!Number.isInteger(chunk) || chunk < 0 || chunk > Math.floor(replay.duration / 60)) throw new Error('录像片段无效');
                let watched = room.view[match.id]?.[SOLO_USER] || 0;
                if (action.type !== 'replay') {
                    const second = action.type === 'solo_skip' ? replay.duration : Number(action.second);
                    if (!Number.isFinite(second) || second < 0 || second > replay.duration) throw new Error('观看进度无效');
                    const revision = room.revision;
                    watched = Math.max(watched, second);
                    room.view[match.id] = { ...room.view[match.id], [SOLO_USER]: watched, [COMPUTER_USER]: replay.duration };
                    room.revision++;
                    await this.store.saveRoom(room, undefined, revision);
                }
                const ended = watched >= replay.duration;
                return { duration: replay.duration, lineups: replay.lineups, tactics: replay.tactics,
                    replay_hash: replay.replay_hash, engine_version: replay.engine_version,
                    last_viewed_second: watched,
                    frames: replay.frames.filter(f => Math.floor(f.t / 60) === chunk),
                    events: replay.events.filter(e => Math.floor(e.time / 60) === chunk),
                    result: ended ? replay.result : null, stats: ended ? replay.stats : null,
                    team_stats: ended ? replay.team_stats : null } as T;
            }
            let updated = applyAction(room, SOLO_USER, action, '午休教练');
            if (updated.revision === room.revision) return { room: publicRoom(updated, SOLO_USER) } as T;
            updated = respondComputer(updated, action);
            let replay: Replay | undefined;
            if (updated.active_match && !updated.matches.find(m => m.id === updated.active_match)?.result_locked) {
                // Only this local campaign imports the simulator. Online results still come from the server.
                const { simulateMatch, matchSeed } = await import('../game/match.ts');
                const m = updated.matches.find(m => m.id === updated.active_match)!;
                replay = await simulateMatch(updated.clubs.find(c => c.id === m.home)!, updated.clubs.find(c => c.id === m.away)!,
                    matchSeed(updated.seed, updated.current_season, updated.current_round), m.id);
                updated = generatedRoom(updated, replay);
                updated.view[m.id][COMPUTER_USER] = replay.duration;
            }
            await this.store.saveRoom(updated, replay, room.revision);
            if (replay) this.cachedReplay = replay;
            if (typeof window !== 'undefined') window.dispatchEvent(new Event('mfc-solo-changed'));
            return { room: publicRoom(updated, SOLO_USER) } as T;
        });
    }
    async export(): Promise<SoloArchive> {
        return this.serial(async () => {
            const room = await this.store.loadRoom();
            if (!room) throw new Error('还没有单人存档');
            return { game: 'moyu-football', mode: 'solo', version: 1, room, replays: await this.store.allReplays() };
        });
    }
    async import(value: unknown): Promise<Room> {
        return this.serial(async () => {
            const archive = await validateSoloArchive(value);
            await this.store.replace(archive.room, archive.replays);
            this.cachedReplay = null;
            return publicRoom(archive.room, SOLO_USER);
        });
    }
}

export async function validateSoloArchive(value: unknown): Promise<SoloArchive> {
    const archive = value as SoloArchive | null;
    const room = archive?.room;
    if (!archive || archive.game !== 'moyu-football' || archive.mode !== 'solo' || archive.version !== 1 || !room ||
        room.host_user_id !== SOLO_USER || room.guest_user_id !== COMPUTER_USER ||
        !['DRAFT', 'SEASON', 'OFFSEASON'].includes(room.state) || !Number.isInteger(room.seed) ||
        !Number.isInteger(room.revision) || !Number.isInteger(room.current_round) || room.current_round < 1 || room.current_round > 10 ||
        !Number.isInteger(room.current_season) || room.current_season < 1 || !Array.isArray(room.clubs) || room.clubs.length !== 2 ||
        room.clubs[0].user_id !== SOLO_USER || room.clubs[1].user_id !== COMPUTER_USER ||
        !Array.isArray(room.matches) || !Array.isArray(archive.replays) || !Array.isArray(room.draft?.candidates) ||
        !Array.isArray(room.processed) || !room.view || !Array.isArray(room.market) || !Array.isArray(room.transfers))
        throw new Error('这不是可用的摸鱼足球单人存档');
    for (const club of room.clubs) {
        if (!Array.isArray(club.players) || club.players.length > 24 || !Array.isArray(club.youth) ||
            !Array.isArray(club.history) || !Array.isArray(club.lineup) || !club.tactic || !Number.isFinite(club.cash))
            throw new Error('球队存档不完整');
        for (const p of [...club.players, ...club.youth]) {
            if (!Array.isArray(p.attrs) || p.attrs.length !== 7 || p.attrs.some(n => !Number.isFinite(n) || n < 1 || n > 100) ||
                !p.h || !p.career || !p.seasonStats || !Array.isArray(p.traits) || !Array.isArray(p.logs))
                throw new Error('球员存档不完整');
        }
    }
    const ids = new Set(archive.replays.map(r => r.match_id));
    if (ids.size !== archive.replays.length) throw new Error('存档含重复比赛');
    const { replayHash } = await import('../game/match.ts');
    for (const m of room.matches) {
        if (!m.result_locked) throw new Error('比赛存档未完成');
        const replay = archive.replays.find(r => r.match_id === m.id);
        if (!replay || replay.duration !== m.duration || replay.replay_hash !== m.replay_hash ||
            !Array.isArray(replay.frames) || replay.frames.length < 2 || !Array.isArray(replay.events) ||
            replay.result[0] !== m.score?.[0] || replay.result[1] !== m.score?.[1] || await replayHash(replay) !== replay.replay_hash)
            throw new Error('比赛录像不完整或已损坏');
    }
    if (archive.replays.length !== room.matches.length || room.active_match && !ids.has(room.active_match))
        throw new Error('存档录像与赛季不一致');
    return archive;
}

const campaign = new SoloCampaign(new BrowserSoloStore());
export const soloAPI = <T>(action: GameAction) => campaign.api<T>(action);
export const startSolo = (action?: GameAction) => campaign.start(action);
export const exportSolo = () => campaign.export();
export const importSolo = (value: unknown) => campaign.import(value);
