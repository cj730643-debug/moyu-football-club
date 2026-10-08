import type { Room, Club, Player, Position, GameAction, Replay, Formation, Tactic } from './types.ts';
import { emptyCareer } from './types.ts';
import { FORMATIONS, ROUTES } from './catalog.ts';
import { generatePlayer, completeSquads, autoLineup, publicPlayer, progressPlayer, nickname, rating, value } from './players.ts';
import { scopeSeed } from './random.ts';
import { evaluateLegacy } from './legacy.ts';
export const snakePicker = (turn: number) => Math.floor(turn / 2) % 2 === 0 ? turn % 2 : 1 - turn % 2;
const themes: Position[] = ['ST', 'CM', 'CB', 'W', 'DM', 'GK'];
const text = (v: unknown, max = 24) => { if (typeof v !== 'string' || !v.trim() || v.trim().length > max)
    throw new Error(`请输入1～${max}字的名称`); return v.trim(); };
const str = (v: unknown) => typeof v === 'string' ? v : '';
function fail(message: string): never { throw new Error(message); }
export function createClub(user_id: string, username: string, a: GameAction): Club { const color = typeof a.color === 'string' && /^#[\da-fA-F]{6}$/.test(a.color) ? a.color : '#a8c77a'; return { id: crypto.randomUUID(), user_id, username, name: text(a.name || '午休联队'), short: text(a.short || '午休', 4), color, secondary: typeof a.secondary === 'string' && /^#[\da-fA-F]{6}$/.test(a.secondary) ? a.secondary : '#f2ede4', badge: ['shield', 'circle', 'diamond'].includes(str(a.badge)) ? str(a.badge) : 'shield', players: [], formation: '4-3-3', lineup: [], tactic: { attack: '中路渗透', defense: '区域防守', mentality: '平衡' }, ready: false, offseason_ready: false, cash: 15000, points: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, trophies: 0, youth: [], history: [], records: {}, alumni: [] }; }
export function createRoom(id: string, code: string, user: string, username: string, a: GameAction, seed: number): Room { return { id, join_code: code, state: 'WAITING_PLAYER', current_season: 1, current_round: 1, revision: 0, host_user_id: user, guest_user_id: null, clubs: [createClub(user, username, a)], draft: { turn: 0, candidates: [], picks: [] }, matches: [], transfers: [], champions: [], seed, legacy_records_version: 1, career_seasons_version: 1, season_stats_version: 1, processed: [], view: {}, active_match: null, issued_nicknames: [], market: [] }; }
function candidates(room: Room) { const pos = themes[Math.floor(room.draft.turn / 2)]; room.draft.candidates = [0, 1, 2].map(i => generatePlayer(room.seed, `${room.id}-draft-${room.draft.turn}-${i}`, pos, true, room.issued_nicknames)); }
function own(room: Room, user: string) { return room.clubs.find(c => c.user_id === user) || fail('你不是这个房间的成员'); }
function canManage(room: Room, c: Club) { if (room.state !== 'SEASON')
    fail('请先完成选秀'); if (c.ready || room.active_match)
    fail('本轮已锁定，请先完成比赛'); }
function requiredRound(room: Room, a: GameAction) { if (a.round !== room.current_round || a.season !== room.current_season)
    fail('轮次已变化，已为你保留最新状态，请重新操作'); }
function isFounder(room: Room, c: Club, p: Player) {
    return p.founding_club_id ? p.founding_club_id === c.id
        : room.draft.picks.some(pick => pick.club === c.id && pick.player.id === p.id);
}
function rememberTenure(c: Club, p: Player) {
    (p.club_tenure ??= {})[c.id] = p.club_seasons;
}
function joinClub(c: Club, p: Player) {
    p.club_seasons = p.club_tenure?.[c.id] || 0;
    p.club_stats = undefined;
    p.legacy = undefined;
}
function archivePlayer(room: Room, c: Club, p: Player, retired = false) {
    p.founding_club_id ??= room.draft.picks.find(pick => pick.player.id === p.id)?.club;
    rememberTenure(c, p);
    const snapshot = structuredClone(p);
    snapshot.founding_player = isFounder(room, c, p);
    snapshot.club_stats = structuredClone(c.records?.[p.id]?.stats || emptyCareer());
    snapshot.legacy = evaluateLegacy(p.position, snapshot.club_stats, p.club_seasons, snapshot.founding_player);
    if (retired) snapshot.retirement = { season: room.current_season - 1, age: p.age, club_id: c.id, evaluation: snapshot.legacy };
    (c.alumni ??= []).push(snapshot);
    return snapshot;
}
export function validateLineup(c: Club, formation: Formation, lineup: string[]) { if (!FORMATIONS[formation] || lineup.length !== 11 || new Set(lineup).size !== 11)
    fail('首发必须是11名不同球员'); lineup.forEach((id, i) => { const p = c.players.find(x => x.id === id); if (!p || p.injury > 0)
    fail('首发含有不可出场球员'); if (i === 0 && p.position !== 'GK' || i !== 0 && p.position === 'GK')
    fail('门将必须安排在门将位置'); }); }
export function applyAction(input: Room, user: string, a: GameAction, username = '教练'): Room {
    const room = structuredClone(input);
    const receipt = user + ':' + str(a.request_id);
    if (a.request_id && room.processed.includes(receipt))
        return room;
    if (a.type === 'join') {
        if (room.clubs.some(c => c.user_id === user))
            return room;
        if (room.guest_user_id || room.state !== 'WAITING_PLAYER')
            fail('房间已经满员');
        room.guest_user_id = user;
        room.clubs.push(createClub(user, username, a));
        room.state = 'DRAFT';
        candidates(room);
    }
    else {
        const c = own(room, user);
        const mine = (id: unknown) => c.players.find(p => p.id === id) || fail('这不是你的球员');
        switch (a.type) {
            case 'pick': {
                if (room.state !== 'DRAFT')
                    fail('选秀已经结束');
                if (a.turn !== room.draft.turn)
                    fail('选人节点已更新');
                if (room.clubs[snakePicker(room.draft.turn)].user_id !== user)
                    fail('现在轮到朋友选人');
                const p = room.draft.candidates.find(p => p.id === a.player_id) || fail('球员已经不可选');
                p.founding_club_id = c.id;
                rememberTenure(c, p);
                c.players.push(p);
                room.draft.picks.push({ club: c.id, player: p });
                room.draft.turn++;
                if (room.draft.turn === 12) {
                    completeSquads(room);
                    room.clubs.forEach(club => club.players.forEach(player => rememberTenure(club, player)));
                    room.state = 'SEASON';
                    room.draft.candidates = [];
                }
                else
                    candidates(room);
                break;
            }
            case 'train':
                canManage(room, c);
                requiredRound(room, a);
                {
                    const p = mine(a.player_id);
                    const route = str(a.route);
                    if (!ROUTES[p.position].includes(route))
                        fail('培养路线无效');
                    p.training = route;
                }
                break;
            case 'rename':
                {
                    const p = mine(a.player_id);
                    p.custom_nickname = text(a.nickname, 12);
                }
                break;
            case 'lineup':
                canManage(room, c);
                requiredRound(room, a);
                {
                    const formation = a.formation as Formation;
                    if (!FORMATIONS[formation])
                        fail('阵型无效');
                    const lineup = a.auto ? autoLineup(c, formation) : (Array.isArray(a.lineup) ? a.lineup.filter((v): v is string => typeof v === 'string') : []);
                    validateLineup(c, formation, lineup);
                    c.formation = formation;
                    c.lineup = lineup;
                }
                break;
            case 'tactics':
                canManage(room, c);
                requiredRound(room, a);
                {
                    const t = a.tactic as Tactic;
                    if (!t || !['中路渗透', '边路进攻', '快速反击'].includes(t.attack) || !['低位防守', '区域防守', '高位压迫'].includes(t.defense) || !['保守', '平衡', '激进'].includes(t.mentality))
                        fail('战术无效');
                    c.tactic = t;
                }
                break;
            case 'ready':
                requiredRound(room, a);
                if (room.state !== 'SEASON')
                    fail('当前无法准备比赛');
                if (room.active_match)
                    break;
                validateLineup(c, c.formation, c.lineup);
                c.ready = true;
                if (room.clubs.every(c => c.ready)) {
                    const id = `${room.id}-s${room.current_season}-r${room.current_round}`;
                    room.active_match = id;
                    room.matches.push({ id, season: room.current_season, round: room.current_round, home: room.clubs[(room.current_round - 1) % 2].id, away: room.clubs[room.current_round % 2].id, state: 'GENERATING', score: null, duration: 0, replay_hash: '', engine_version: '', result_locked: false, stats: null });
                    room.view[id] = {};
                }
                break;
            case 'cancel_ready':
                requiredRound(room, a);
                if (room.active_match || room.clubs.every(c => c.ready))
                    fail('双方已准备，比赛已锁定');
                c.ready = false;
                break;
            case 'settle': {
                const m = room.matches.find(m => m.id === a.match_id) || fail('比赛不存在');
                if (m.state === 'FINISHED')
                    break;
                if (!m.result_locked || !m.score || !m.stats)
                    fail('比赛仍在生成');
                if (room.clubs.some(c => (room.view[m.id]?.[c.user_id] || 0) < m.duration))
                    fail('双方都看完比赛后会自动结算');
                settle(room, m.id);
                break;
            }
            case 'youth_sign':
                if (room.state !== 'OFFSEASON')
                    fail('青训在休赛期开放');
                {
                    const p = c.youth.find(p => p.id === a.player_id) || fail('新人不可签约');
                    if (c.players.length >= 24)
                        fail('球队最多24人，请先释放一名球员');
                    if (c.cash < 1000)
                        fail('签约需要1000资金');
                    c.cash -= 1000;
                    joinClub(c, p);
                    c.players.push(p);
                    c.youth = c.youth.filter(x => x.id !== p.id);
                    c.history.unshift('签下青训新人「' + nickname(p) + '」。');
                }
                break;
            case 'scout':
                if (room.state !== 'OFFSEASON')
                    fail('球探在休赛期开放');
                {
                    const p = [...c.youth, ...room.market].find(p => p.id === a.player_id) || fail('球员不可观察');
                    if (p.logs.some(l => l.startsWith('球探复核：')))
                        break;
                    if (c.cash < 300)
                        fail('球探复核需要300资金');
                    c.cash -= 300;
                    p.potential_range = p.h?.true_potential && p.h.true_potential >= 86 ? 'A～S' : p.h?.true_potential && p.h.true_potential >= 80 ? 'B～A' : 'C～B';
                    p.logs.unshift('球探复核：' + (p.h?.hidden_traits.length ? '发现一个尚未公开的特点，建议继续观察稳定性。' : '稳定性尚可，潜力判断已进一步缩窄。'));
                }
                break;
            case 'youth_discard':
                if (room.state !== 'OFFSEASON')
                    fail('现在不是休赛期');
                c.youth = c.youth.filter(p => p.id !== a.player_id);
                break;
            case 'buy':
                if (room.state !== 'OFFSEASON')
                    fail('市场只在休赛期开启');
                {
                    const p = room.market.find(p => p.id === a.player_id) || fail('球员已被签下');
                    if (c.players.length >= 24 || c.cash < p.market_value)
                        fail('球队名额或资金不足');
                    c.cash -= p.market_value;
                    joinClub(c, p);
                    c.players.push(p);
                    room.market = room.market.filter(p => p.id !== a.player_id);
                    c.history.unshift('从自由市场签下「' + nickname(p) + '」。');
                }
                break;
            case 'release':
                if (room.state !== 'OFFSEASON')
                    fail('请在休赛期调整球队');
                {
                    const p = mine(a.player_id);
                    if (c.players.length <= 18 || p.position === 'GK' && c.players.filter(p => p.position === 'GK').length <= 2)
                        fail('请保留18人班底和2名门将');
                    archivePlayer(room, c, p);
                    c.players = c.players.filter(x => x.id !== p.id);
                    p.market_value = value(p);
                    room.market.push(p);
                    c.lineup = autoLineup(c);
                }
                break;
            case 'offer':
                if (room.state !== 'OFFSEASON')
                    fail('交易只在休赛期开放');
                {
                    const p = mine(a.player_id);
                    const other = room.clubs.find(x => x.id !== c.id)!;
                    const exchange = a.exchange ? other.players.find(p => p.id === a.exchange) : null;
                    const money = Number(a.money || 0);
                    if (!Number.isInteger(money) || money < 0 || money > c.cash || a.exchange && !exchange)
                        fail('交易条件无效');
                    if (room.transfers.filter(t => t.from === c.id && t.state === 'PENDING').length >= 5)
                        fail('最多同时发出5份报价');
                    room.transfers.push({ id: crypto.randomUUID(), from: c.id, to: other.id, player: p.id, exchange: exchange?.id || null, money, state: 'PENDING' });
                }
                break;
            case 'accept_offer':
            case 'reject_offer':
                if (room.state !== 'OFFSEASON')
                    fail('当前不能处理交易');
                {
                    const t = room.transfers.find(t => t.id === a.offer_id) || fail('报价不存在');
                    if (t.to !== c.id)
                        fail('只有收到报价的俱乐部可以确认');
                    if (t.state !== 'PENDING')
                        break;
                    if (a.type === 'reject_offer') {
                        t.state = 'REJECTED';
                        break;
                    }
                    const from = room.clubs.find(c => c.id === t.from)!;
                    const p = from.players.find(p => p.id === t.player);
                    const exchanged = t.exchange ? c.players.find(p => p.id === t.exchange) : null;
                    if (!p || t.exchange && !exchanged || from.cash < t.money)
                        fail('球员归属或资金已经改变');
                    if (!exchanged && (from.players.length <= 18 || c.players.length >= 24))
                        fail('交易会使球队人数超出限制');
                    const fromKeepers = from.players.filter(p => p.position === 'GK').length - (p.position === 'GK' ? 1 : 0) + (exchanged?.position === 'GK' ? 1 : 0);
                    const toKeepers = c.players.filter(p => p.position === 'GK').length + (p.position === 'GK' ? 1 : 0) - (exchanged?.position === 'GK' ? 1 : 0);
                    if (fromKeepers < 2 || toKeepers < 2)
                        fail('双方都需要保留2名门将');
                    archivePlayer(room, from, p);
                    if (exchanged)
                        archivePlayer(room, c, exchanged);
                    from.players = from.players.filter(x => x.id !== p.id);
                    joinClub(c, p);
                    c.players.push(p);
                    if (exchanged) {
                        c.players = c.players.filter(x => x.id !== exchanged.id);
                        joinClub(from, exchanged);
                        from.players.push(exchanged);
                    }
                    from.cash -= t.money;
                    c.cash += t.money;
                    t.state = 'ACCEPTED';
                    from.lineup = autoLineup(from);
                    c.lineup = autoLineup(c);
                    from.history.unshift('与' + c.name + '完成「' + nickname(p) + '」交易。');
                    c.history.unshift('与' + from.name + '完成「' + nickname(p) + '」交易。');
                }
                break;
            case 'next_season':
                if (room.state !== 'OFFSEASON')
                    fail('还未结束本赛季');
                if (a.season !== room.current_season)
                    fail('赛季已更新');
                c.offseason_ready = true;
                if (room.clubs.every(c => c.offseason_ready)) {
                    room.current_season++;
                    room.current_round = 1;
                    room.state = 'SEASON';
                    room.transfers.filter(t => t.state === 'PENDING').forEach(t => t.state = 'REJECTED');
                    room.clubs.forEach(c => {
                        c.points = c.wins = c.draws = c.losses = c.gf = c.ga = 0;
                        c.offseason_ready = false;
                        c.youth = [];
                        c.players.forEach(p => { p.age++; });
                        retireVeterans(room, c);
                        c.players.forEach(p => {
                            p.club_seasons++;
                            rememberTenure(c, p);
                            p.career.seasons++;
                            p.seasonStats = { ...emptyCareer(), seasons: 1 };
                            p.fitness = 100;
                            p.injury = 0;
                            if (p.h) p.h.changes = 0;
                        });
                        c.lineup = autoLineup(c);
                    });
                }
                break;
            default: fail('不支持的操作');
        }
    }
    if (a.request_id)
        room.processed.push(receipt);
    room.processed = room.processed.slice(-3000);
    room.revision++;
    return room;
}
function settle(room: Room, matchId: string) {
    const m = room.matches.find(m => m.id === matchId)!;
    if (m.state === 'FINISHED')
        return;
    const result = m.score!;
    const home = room.clubs.find(c => c.id === m.home)!, away = room.clubs.find(c => c.id === m.away)!;
    home.gf += result[0];
    home.ga += result[1];
    away.gf += result[1];
    away.ga += result[0];
    if (result[0] === result[1]) {
        home.points++;
        away.points++;
        home.draws++;
        away.draws++;
    }
    else {
        const winner = result[0] > result[1] ? home : away, loser = winner === home ? away : home;
        winner.points += 3;
        winner.wins++;
        loser.losses++;
    }
    const best = Object.entries(m.stats!).filter(([, stat]) => stat.minutes > 0).sort(([, a], [, b]) => b.rating - a.rating)[0]?.[0];
    for (const c of room.clubs) {
        for (const p of c.players) {
            progressPlayer(p, m.stats![p.id], scopeSeed(room.seed, `growth:${m.season}:${m.round}`));
            if (p.id === best) {
                p.career.man_of_match++;
                p.seasonStats.man_of_match++;
            }
            if (p.position === 'GK' && m.stats![p.id]?.minutes && ((c.id === m.home ? result[1] : result[0]) === 0)) {
                p.career.clean_sheets++;
                p.seasonStats.clean_sheets++;
            }
            const st = m.stats![p.id];
            if (st?.minutes) {
                const record = (c.records ??= {})[p.id] ??= { name: nickname(p), position: p.position, stats: emptyCareer() };
                record.name = nickname(p);
                record.stats.appearances++;
                record.stats.starts += st.starts ? 1 : 0;
                record.stats.minutes += st.minutes;
                record.stats.goals += st.goals;
                record.stats.assists += st.assists;
                record.stats.decisive_goals += st.decisive_goals || 0;
                record.stats.man_of_match += p.id === best ? 1 : 0;
                record.stats.clean_sheets += p.position === 'GK' && (c.id === m.home ? result[1] : result[0]) === 0 ? 1 : 0;
                record.stats.yellow_cards += st.yellow;
                record.stats.red_cards += st.red;
                record.stats.injuries += st.injured > 0 ? 1 : 0;
                if (record.last_season !== m.season) {
                    record.stats.seasons++;
                    record.last_season = m.season;
                }
            }
        }
        c.cash += 400;
        c.ready = false;
        c.lineup = autoLineup(c);
        c.history.unshift(`第${m.season}季第${m.round}轮 · ${home.short} ${result[0]}:${result[1]} ${away.short}`);
    }
    m.state = 'FINISHED';
    room.active_match = null;
    if (room.current_round < 10)
        room.current_round++;
    else {
        finishSeason(room);
    }
}
export function standings(room: Room) { return [...room.clubs].sort((a, b) => b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || b.wins - a.wins); }
function retireVeterans(room: Room, c: Club) { const retired = c.players.filter(p => p.age >= 40); for (const p of retired) {
    const snapshot = archivePlayer(room, c, p, true);
    c.history.unshift('「' + nickname(p) + '」在' + p.age + '岁退役，获评「' + snapshot.legacy!.title + '」，' + p.club_seasons + '季的故事留在俱乐部档案。');
} c.players = c.players.filter(p => p.age < 40); let i = 0; while (c.players.length < 18 || c.players.filter(p => p.position === 'GK').length < 2) {
    const position = c.players.filter(p => p.position === 'GK').length < 2 ? 'GK' : themes[i % themes.length];
    const p = generatePlayer(room.seed, `${c.id}-academy-${room.current_season}-${i++}`, position, false, room.issued_nicknames, true);
    p.club_seasons = 0;
    p.career.seasons = 0;
    c.players.push(p);
    c.history.unshift('梯队补入「' + nickname(p) + '」，接过老将的球衣。');
} }
function finishSeason(room: Room) {
    room.state = 'OFFSEASON';
    const table = standings(room);
    const tied = table.length === 2 && table[0].points === table[1].points && table[0].gf - table[0].ga === table[1].gf - table[1].ga && table[0].gf === table[1].gf;
    const winner = table[0];
    const players = room.clubs.flatMap(c => c.players);
    const top = (key: keyof Player['seasonStats'], filter: (p: Player) => boolean = () => true) => {
        const best = [...players].filter(filter).sort((a, b) => b.seasonStats[key] - a.seasonStats[key])[0];
        return best ? nickname(best) : '暂无符合球员';
    };
    const awards = { 射手王: top('goals'), 助攻王: top('assists'), 最佳球员: top('man_of_match'), 最佳年轻球员: top('man_of_match', p => p.age <= 23), 最佳门将: top('clean_sheets', p => p.position === 'GK') };
    room.champions.push({ season: room.current_season, club: tied ? '共同冠军' : winner.id, awards });
    const unregistered = (p: Player) => { p.club_seasons = 0; p.career.seasons = 0; p.seasonStats = emptyCareer(); return p; };
    room.clubs.forEach(c => {
        if (tied || c.id === winner.id) {
            c.trophies++;
            c.cash += 2000;
            c.players.forEach(p => {
                p.career.trophies++;
                p.seasonStats.trophies++;
                const record = c.records?.[p.id];
                if (record && record.last_season === room.current_season) record.stats.trophies++;
            });
        } else c.cash += 1000;
        c.history.unshift(`第${room.current_season}季结束 · ${tied ? '共同冠军' : c.id === winner.id ? '赢得冠军' : '获得亚军'}`);
        c.youth = [0, 1, 2].map(i => unregistered(generatePlayer(room.seed, `${c.id}-youth-${room.current_season}-${i}`, themes[(room.current_season + i) % themes.length], false, room.issued_nicknames, true)));
    });
    room.market = [0, 1, 2, 3, 4, 5].map(i => unregistered(generatePlayer(room.seed, `${room.id}-free-${room.current_season}-${i}`, themes[i], false, room.issued_nicknames)));
}
export function generatedRoom(input: Room, replay: Replay): Room { const r = structuredClone(input); const m = r.matches.find(m => m.id === replay.match_id); if (!m)
    fail('比赛不存在'); if (m.result_locked)
    return r; m.state = 'GENERATED'; m.score = replay.result; m.duration = replay.duration; m.stats = replay.stats; m.replay_hash = replay.replay_hash; m.engine_version = replay.engine_version; m.result_locked = true; r.revision++; return r; }
export function publicRoom(input: Room, user: string): Room { const room = structuredClone(input); own(room, user); room.seed = 0; room.processed = []; room.issued_nicknames = []; room.clubs.forEach(c => {
    c.players = c.players.map(p => {
        const snapshot = publicPlayer(p);
        snapshot.founding_player = isFounder(room, c, p);
        snapshot.club_stats = structuredClone(c.records?.[p.id]?.stats || emptyCareer());
        snapshot.legacy = evaluateLegacy(p.position, snapshot.club_stats, p.club_seasons, snapshot.founding_player);
        return snapshot;
    });
    c.alumni = (c.alumni || []).map(p => {
        const snapshot = publicPlayer(p);
        snapshot.club_stats ??= structuredClone(c.records?.[p.id]?.stats || emptyCareer());
        snapshot.legacy ??= evaluateLegacy(p.position, snapshot.club_stats, p.club_seasons, isFounder(room, c, p));
        return snapshot;
    });
    c.youth = c.user_id === user ? c.youth.map(publicPlayer) : []; if (c.user_id !== user && c.ready) {
    c.lineup = [];
} }); room.draft.candidates = room.draft.candidates.map(publicPlayer); room.draft.picks = room.draft.picks.map(p => ({ ...p, player: publicPlayer(p.player) })); room.market = room.market.map(publicPlayer); room.matches.forEach(m => { if ((room.view[m.id]?.[user] || 0) < m.duration || !m.result_locked) {
    m.score = null;
    m.stats = null;
} }); return room; }
export function canProgress(old: number, next: number, duration: number, elapsedMs: number) { return Number.isFinite(next) && next >= old && next <= duration && next - old <= Math.max(0, elapsedMs) / 1000 * 72 + 3; }
export const teamStrength = (c: Club) => Math.round(c.players.reduce((n, p) => n + rating(p), 0) / Math.max(1, c.players.length));
