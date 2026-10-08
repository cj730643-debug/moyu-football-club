import Engine from '../vendor/football-simulator/RealTimeEngine.ts';
import EnginePlayer from '../vendor/football-simulator/Player.ts';
import type { PlayerAttributes } from '../vendor/football-simulator/Player.ts';
import EngineTeam from '../vendor/football-simulator/Team.ts';
import { Position as EP } from '../vendor/football-simulator/enums/Position.ts';
import type { Tactics as EngineTactics, RealTimeMatchEvent, MatchSnapshot } from '../vendor/football-simulator/RealTimeEngine.ts';
import { nickname, publicPlayer } from './players.ts';
import { FORMATIONS, TRAIT_MAP } from './catalog.ts';
import { rng, scopeSeed, clamp, int } from './random.ts';
import type { Club, Player, Position, Replay, ReplayEvent, PlayerStat, Tactic, TeamStats } from './types.ts';
export const ENGINE_VERSION = 'football-simulator@39529b1+mfc.3';
export const SIM_VERSION = 'mfc-adapter.5-fair-recovery';
const roles: Record<Position, EP> = { GK: EP.GK, CB: EP.CB, FB: EP.LB, DM: EP.DM, CM: EP.CM, AM: EP.COM, W: EP.LW, ST: EP.ST };
function roleAt(pos: Position, index: number, all: Position[]) { const occurrence = all.slice(0, index).filter(p => p === pos).length; const count = all.filter(p => p === pos).length; if (pos === 'FB')
    return occurrence === 0 ? EP.LB : EP.RB; if (pos === 'CB' && count >= 2)
    return occurrence === 0 ? EP.LCB : occurrence === count - 1 ? EP.RCB : EP.CB; if (pos === 'W')
    return occurrence === 0 ? EP.LW : EP.RW; if (pos === 'CM' && count >= 2)
    return occurrence === 0 ? EP.LCM : EP.RCM; if (pos === 'DM' && count === 2)
    return occurrence === 0 ? EP.LDM : EP.RDM; if (pos === 'ST' && count === 2)
    return occurrence === 0 ? EP.LF : EP.RF; return roles[pos]; }
export function engineTactics(club: Club): Partial<EngineTactics> { const t = club.tactic; return { formation: club.formation, style: t.attack === '快速反击' ? 'counter' : t.attack === '中路渗透' ? 'possession' : 'direct', press: t.defense === '高位压迫' ? 80 : t.defense === '低位防守' ? 25 : 50, defensiveLine: t.defense === '高位压迫' ? 74 : t.defense === '低位防守' ? 28 : 52, compactness: t.defense === '低位防守' ? 76 : 56, focus: t.attack === '边路进攻' ? 'wide' : 'central', width: t.attack === '边路进攻' ? 74 : 47, tempo: t.attack === '快速反击' ? 78 : 50, mentality: t.mentality === '激进' ? 'attacking' : t.mentality === '保守' ? 'defensive' : 'balanced' }; }
export function adaptPlayer(p: Player, role: EP, number: number, random: () => number): EnginePlayer {
    const a = p.attrs.map(x => x / 5);
    const speed = p.position === 'GK' ? a[1] * .65 : a[0];
    const shot = p.position === 'GK' ? 5 : a[1];
    const passing = p.position === 'GK' ? a[3] : a[2];
    const control = p.position === 'GK' ? a[4] : a[3];
    const defense = p.position === 'GK' ? a[2] : a[4];
    const body = a[5], stamina = a[6];
    const attributes: PlayerAttributes = { aggression: 10, anticipation: (defense + control) / 2, bravery: body, composure: control, concentration: defense, decisions: (passing + control) / 2, determination: stamina, flair: control, leadership: 12, offTheBall: (speed + shot) / 2, positioning: defense, teamwork: passing, vision: passing, workRate: stamina, acceleration: speed, agility: (speed + control) / 2, balance: body, jumpingReach: (p.height - 145) / 3, naturalFitness: stamina, pace: speed, stamina, strength: body, corners: passing, crossing: passing, dribbling: control, finishing: shot, firstTouch: control, freeKickTaking: shot, heading: (shot + body) / 2, longShots: shot, longThrows: body, marking: defense, passing, penaltyTaking: shot, tackling: defense, technique: control, aerialReach: (p.height - 145) / 3, commandOfArea: p.position === 'GK' ? a[4] : 5, communication: 12, eccentricity: 5, handling: p.position === 'GK' ? a[0] : 3, oneOnOnes: p.position === 'GK' ? (a[0] + a[1]) / 2 : 3, reflexes: p.position === 'GK' ? a[1] : 3, rushingOut: p.position === 'GK' ? a[2] : 3, tendencyToPunch: 10, throwing: passing };
    const positionMap: Record<EP, Position> = { [EP.GK]: 'GK', [EP.LB]: 'FB', [EP.RB]: 'FB', [EP.LCB]: 'CB', [EP.CB]: 'CB', [EP.RCB]: 'CB', [EP.LDM]: 'DM', [EP.DM]: 'DM', [EP.RDM]: 'DM', [EP.CM]: 'CM', [EP.LCM]: 'CM', [EP.RCM]: 'CM', [EP.COM]: 'AM', [EP.LW]: 'W', [EP.RW]: 'W', [EP.ST]: 'ST', [EP.LF]: 'ST', [EP.RF]: 'ST' } as Record<EP, Position>;
    const familiar = p.position === positionMap[role] ? 1 : p.adapted.includes(positionMap[role]) ? .93 : .74;
    const volatility = p.form === 0 ? .065 : p.form === 3 ? .14 : .09;
    const performance = 1 + (random() - .5) * volatility * (p.h ? (110 - p.h.consistency) / 50 : 1) + (p.form === 0 ? .018 : p.form === 3 ? -.02 : 0);
    for (const key of Object.keys(attributes) as (keyof PlayerAttributes)[])
        attributes[key] *= familiar * performance;
    for (const trait of [...p.traits, ...(p.h?.hidden_traits || [])]) {
        if (['逆境之王', '关键先生'].includes(trait))
            continue;
        for (const [key, bonus] of Object.entries(TRAIT_MAP[trait]?.effect || {})) {
            const k = key as keyof PlayerAttributes;
            attributes[k] += (bonus || 0);
        }
    }
    if (p.h && p.h.injury_proneness > 65)
        attributes.naturalFitness -= 3;
    for (const key of Object.keys(attributes) as (keyof PlayerAttributes)[])
        attributes[key] = clamp(attributes[key], 1, 20);
    return new EnginePlayer({ name: nickname(p), number }, { height: p.height, weight: p.body === '强壮型' ? 90 : p.body === '高大型' ? 87 : 74 }, attributes, role);
}
const textMap: Record<string, string> = { match_start: '比赛开始', kickoff: '开球', pass: '传球', receive: '接应', dribble: '带球推进', interception: '截断传球', tackle: '抢断成功', shot: '起脚射门', save: '完成扑救', goal: '破门！', miss: '射门偏出', foul: '犯规', offside: '越位', yellow_card: '收到黄牌', red_card: '被红牌罚下', substitution: '被换下', injury: '出现伤情', half_time: '半场结束', full_time: '全场结束', aerial_duel: '争顶', blocked_shot: '封堵射门', corner: '角球', goal_kick: '球门球', free_kick: '任意球', penalty: '点球', goalkeeper_claim: '没收来球', goalkeeper_punch: '击出来球', recovery: '回收球权', second_ball: '争夺第二落点', throw_in: '界外球' };
function eventType(e: RealTimeMatchEvent) { if (e.type === 'pass' && (e.outcome?.includes('cross') || e.activeAttackPattern === 'cross'))
    return 'CROSS'; if (e.type === 'blocked_shot' || e.type === 'goalkeeper_punch')
    return 'CLEARANCE'; return e.type.toUpperCase(); }
export function stableStringify(value: unknown): string { if (value === null || typeof value !== 'object')
    return JSON.stringify(value); if (Array.isArray(value))
    return '[' + value.map(stableStringify).join(',') + ']'; return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([k, v]) => JSON.stringify(k) + ':' + stableStringify(v)).join(',') + '}'; }
export async function replayHash(replay: Omit<Replay, 'replay_hash'> | Replay) { const { replay_hash: _hash, ...data } = replay as Replay; const bytes = new TextEncoder().encode(stableStringify(data)); const hash = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join(''); }
export async function simulateMatch(home: Club, away: Club, seed: number, match_id: string, options: {
    tick?: number;
    length?: number;
    frames?: boolean;
} = {}): Promise<Replay> {
    const random = rng(seed);
    const idByObject = new Map<EnginePlayer, string>();
    const playerById = new Map<string, Player>();
    const build = (c: Club, isHome: boolean) => { const slots = FORMATIONS[c.formation]; const starters = c.lineup.map(id => c.players.find(p => p.id === id)!); if (starters.length !== 11 || starters.some(p => !p || p.injury > 0))
        throw new Error('首发无效'); const all = [...starters, ...c.players.filter(p => !c.lineup.includes(p.id) && p.injury === 0)]; return { all, team: new EngineTeam(isHome, c.name, all.map((p, i) => { const ep = adaptPlayer(p, i < 11 ? roleAt(slots[i], i, slots) : roles[p.position], i + 1, random); idByObject.set(ep, p.id); playerById.set(p.id, p); return ep; })) }; };
    const h = build(home, true), a = build(away, false);
    const engine = new Engine(h.team, a.team, { random, tickSeconds: options.tick || 1, matchLengthSeconds: options.length || 5400, homeTactics: engineTactics(home), awayTactics: engineTactics(away) });
    const engineIds = new Map<string, string>();
    for (const p of [...engine.state.players, ...engine.state.bench.home, ...engine.state.bench.away]) {
        const id = idByObject.get(p.player)!;
        engineIds.set(p.id, id);
        p.stamina = playerById.get(id)!.fitness;
    }
    const stats: Record<string, PlayerStat> = {};
    for (const [ep, id] of idByObject) {
        const p = playerById.get(id)!;
        stats[id] = { name: nickname(p), side: h.all.some(x => x.id === id) ? 'home' : 'away', position: p.position, goals: 0, decisive_goals: 0, assists: 0, shots: 0, saves: 0, passes: 0, completed: 0, tackles: 0, fouls: 0, offsides: 0, yellow: 0, red: 0, minutes: 0, rating: 6.3, fitness: 100, injured: 0, chances: 0, dribbles: 0, starts: (ep.info.number <= 11) };
    }
    const events: ReplayEvent[] = [], frames: Replay['frames'] = [];
    let lastFrame = -1;
    const possession = { home: 0, away: 0 };
    const statTicks: Record<string, number> = {};
    let lastTrait = 0;
    const lastPass: Partial<Record<'home' | 'away', {
        from: string;
        to: string;
        time: number;
    }>> = {};
    const consume = (s: MatchSnapshot, es: RealTimeMatchEvent[]) => {
        for (const e of es) {
            const id = e.player ? idByObject.get(e.player) || null : null;
            const secondary = e.secondaryPlayer ? idByObject.get(e.secondaryPlayer) || null : null;
            const p = id ? playerById.get(id) : null;
            let trait: string | undefined;
            if (p && s.time - lastTrait > 25 && ['goal', 'shot', 'pass', 'tackle', 'aerial_duel', 'dribble', 'save'].includes(e.type)) {
                const candidates = p.traits.filter(t => TRAIT_MAP[t]?.color === 'purple' || TRAIT_MAP[t]?.color === 'gold');
                trait = candidates.find(t => e.type === 'goal' || e.type === 'shot' ? TRAIT_MAP[t].effect.finishing || TRAIT_MAP[t].effect.longShots : e.type === 'pass' ? TRAIT_MAP[t].effect.vision : e.type === 'tackle' ? TRAIT_MAP[t].effect.tackling || TRAIT_MAP[t].effect.positioning : e.type === 'dribble' ? TRAIT_MAP[t].effect.dribbling || TRAIT_MAP[t].effect.acceleration : e.type === 'aerial_duel' ? TRAIT_MAP[t].effect.heading : TRAIT_MAP[t].effect.reflexes);
                if (trait)
                    lastTrait = s.time;
            }
            events.push({ time: e.time, type: eventType(e), side: e.teamSide || null, player: id, secondary, text: e.type === 'substitution' && secondary ? nickname(playerById.get(secondary)!) + '被换下，' + (p ? nickname(p) : '替补') + '登场' : (p ? nickname(p) + ' ' : '') + (textMap[e.type] || '组织调整'), x: Math.round(clamp(e.position.x / 105 * 100, 0, 100) * 10) / 10, y: Math.round(clamp(e.position.y / 68 * 100, 0, 100) * 10) / 10, ...(trait ? { trait } : {}), ...(e.chanceQuality ? { chance: e.chanceQuality } : {}) });
            const st = id ? stats[id] : null;
            if (st) {
                if (e.type === 'receive' && secondary && e.teamSide)
                    lastPass[e.teamSide] = { from: secondary, to: id!, time: e.time };
                if (e.type === 'goal') {
                    st.goals++;
                    const pass = lastPass[st.side];
                    const assist = secondary || (pass && pass.to === id && e.time - pass.time <= 15 ? pass.from : null);
                    if (assist && assist !== id && stats[assist]?.side === st.side)
                        stats[assist].assists++;
                }
                if (e.type === 'shot')
                    st.shots++;
                if (e.type === 'shot' && (e.chanceQuality || 0) > .23)
                    st.chances++;
                if (e.type === 'save')
                    st.saves++;
                if (e.type === 'pass')
                    st.passes++;
                if (e.type === 'receive' && secondary)
                    stats[secondary].completed++;
                if (e.type === 'tackle' || e.type === 'interception')
                    st.tackles++;
                if (e.type === 'foul')
                    st.fouls++;
                if (e.type === 'offside')
                    st.offsides++;
                if (e.type === 'yellow_card')
                    st.yellow++;
                if (e.type === 'red_card')
                    st.red++;
                if (e.type === 'dribble' && e.outcome?.includes('space'))
                    st.dribbles++;
                if (e.type === 'injury')
                    st.injured = e.outcome === 'forced' ? int(random, 3, 6) : e.outcome === 'minor' ? int(random, 1, 3) : 0;
            }
        }
        if (s.possession.teamSide)
            possession[s.possession.teamSide] += engine.tickSeconds;
        for (const p of s.players) {
            const id = engineIds.get(p.id)!;
            if (!id)
                continue;
            statTicks[id] = (statTicks[id] || 0) + engine.tickSeconds;
            stats[id].fitness = Math.round(p.stamina);
        }
        if (options.frames !== false && (s.time - lastFrame >= 1 || s.phase === 'full_time' || s.phase === 'half_time')) {
            lastFrame = s.time;
            frames.push({ t: s.time, ball: [Math.round(clamp(s.ball.x / 105 * 100, 0, 100) * 10) / 10, Math.round(clamp(s.ball.y / 68 * 100, 0, 100) * 10) / 10], p: s.players.map(p => [engineIds.get(p.id)!, Math.round(clamp(p.x / 105 * 100, 0, 100) * 10) / 10, Math.round(clamp(p.y / 68 * 100, 0, 100) * 10) / 10, Math.round(p.stamina), p.redCard ? 1 : 0]), phase: s.phase });
        }
    };
    consume(engine.start(), engine.events);
    engine.events = [];
    engine.snapshots = [];
    let contextual = false;
    while (engine.state.period !== 'ended') {
        const slice = engine.tick();
        consume(slice.snapshot, slice.events);
        engine.events = [];
        engine.snapshots = [];
        if (!contextual && engine.state.time >= 4500) {
            contextual = true;
            for (const sp of engine.state.players) {
                const p = playerById.get(engineIds.get(sp.id)!);
                if (!p)
                    continue;
                const trailing = sp.side === 'home' ? engine.state.score.home < engine.state.score.away : engine.state.score.away < engine.state.score.home;
                for (const trait of p.traits.filter(t => t === '关键先生' || t === '逆境之王' && trailing)) {
                    for (const [key, bonus] of Object.entries(TRAIT_MAP[trait].effect)) {
                        const k = key as keyof PlayerAttributes;
                        sp.attributes[k] = clamp(sp.attributes[k] + (bonus || 0), 1, 20);
                    }
                }
            }
        }
    }
    const final = engine.state;
    const decisive = decisiveScorer(events, [final.score.home, final.score.away]);
    if (decisive && stats[decisive]) stats[decisive].decisive_goals = 1;
    for (const [id, st] of Object.entries(stats)) {
        st.minutes = Math.round((statTicks[id] || 0) / 60);
        st.rating = Math.round(clamp(6.25 + st.goals * .85 + st.assists * .45 + st.saves * .09 + st.tackles * .025 + st.completed * .003 - st.yellow * .18 - st.red * .8 - (st.shots - st.goals) * .025 + ((st.side === 'home' ? final.score.home : final.score.away) > (st.side === 'home' ? final.score.away : final.score.home) ? .3 : 0), 3, 10) * 10) / 10;
    }
    const teamStats = (side: 'home' | 'away'): TeamStats => { const sts = Object.values(stats).filter(s => s.side === side); const sum = (k: keyof PlayerStat) => sts.reduce((n, s) => n + Number(s[k]), 0); return { possession: Math.round(possession[side] / Math.max(1, possession.home + possession.away) * 100), shots: sum('shots'), onTarget: sum('goals') + Object.values(stats).filter(s => s.side !== side).reduce((n, s) => n + s.saves, 0), chances: sum('chances'), passRate: Math.round(sum('completed') / Math.max(1, sum('passes')) * 100), tackles: sum('tackles'), fouls: sum('fouls'), offsides: sum('offsides'), yellow: sum('yellow'), red: sum('red') }; };
    const replay: Replay = { match_id, seed, engine_version: ENGINE_VERSION, simulation_version: SIM_VERSION, lineups: { home: h.all.map(publicPlayer), away: a.all.map(publicPlayer) }, tactics: { home: home.tactic, away: away.tactic }, events, frames, result: [final.score.home, final.score.away], duration: final.time, stats, replay_hash: '', team_stats: { home: teamStats('home'), away: teamStats('away') } };
    replay.replay_hash = await replayHash(replay);
    return replay;
}
export const matchSeed = (roomSeed: number, season: number, round: number) => scopeSeed(roomSeed, `match:${season}:${round}`);
export function decisiveScorer(events: ReplayEvent[], result: [number, number]): string | null {
    if (result[0] === result[1]) return null;
    const winner = result[0] > result[1] ? 'home' : 'away';
    const oppositionGoals = Math.min(...result);
    return events.filter(e => e.type === 'GOAL' && e.side === winner)[oppositionGoals]?.player || null;
}
export function visibleScore(events: ReplayEvent[], second: number): [
    number,
    number
] { return [events.filter(e => e.type === 'GOAL' && e.side === 'home' && e.time <= second).length, events.filter(e => e.type === 'GOAL' && e.side === 'away' && e.time <= second).length]; }
export function tacticLabel(t: Tactic) { return `${t.attack} · ${t.defense} · ${t.mentality}`; }
