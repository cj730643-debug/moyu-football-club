import { FORMATIONS, ROUTES } from './catalog.ts';
import { autoLineup, fit, publicPlayer, rating } from './players.ts';
import { scopeSeed } from './random.ts';
import { applyAction, createRoom, snakePicker } from './state.ts';
import type { Club, Formation, GameAction, Player, Room } from './types.ts';

export const SOLO_USER = '00000000-0000-4000-8000-000000000001';
export const COMPUTER_USER = '00000000-0000-4000-8000-000000000002';

export function createSoloRoom(action: GameAction, seed: number): Room {
    const room = createRoom(crypto.randomUUID(), 'SOLO', SOLO_USER, '午休教练', action, seed);
    return applyAction(room, COMPUTER_USER, { type: 'join', name: '晚风俱乐部', short: '晚风', color: '#86b9ce', badge: 'circle' }, '电脑教练');
}

// The computer makes decisions from the same visible information as the player.
export function computerChoice(players: Player[]): Player {
    if (!players.length) throw new Error('电脑没有可选择的球员');
    return [...players].sort((a, b) => visibleValue(b) - visibleValue(a) || a.id.localeCompare(b.id))[0];
}
function visibleValue(player: Player): number {
    const p = publicPlayer(player);
    const potential = p.potential_range.includes('S') ? 6 : p.potential_range.includes('A') ? 3 : 0;
    return rating(p) + potential - Math.max(0, p.age - 25) * .3;
}
function act(room: Room, action: GameAction): Room {
    return applyAction(room, COMPUTER_USER, { ...action, season: room.current_season, round: room.current_round });
}

function prepareComputer(input: Room): Room {
    let room = input;
    const computer = room.clubs.find(c => c.user_id === COMPUTER_USER)!;
    if (computer.ready) return room;
    const score = (formation: Formation) => {
        const club: Club = { ...computer, formation };
        const lineup = autoLineup(club);
        return lineup.reduce((n, id, i) => {
            const p = publicPlayer(club.players.find(p => p.id === id)!);
            return n + rating(p) + (fit(p, FORMATIONS[formation][i]) === '擅长' ? 5 : 0) + p.fitness * .04;
        }, 0);
    };
    const formation = (Object.keys(FORMATIONS) as Formation[]).sort((a, b) => score(b) - score(a))[0];
    room = act(room, { type: 'lineup', formation, auto: true });
    const style = scopeSeed(room.seed, 'computer:' + room.current_season + ':' + room.current_round) % 3;
    room = act(room, { type: 'tactics', tactic: {
        attack: ['中路渗透', '边路进攻', '快速反击'][style],
        defense: style === 2 ? '低位防守' : '区域防守', mentality: '平衡',
    } });
    for (const p of computer.players) {
        const routes = ROUTES[p.position];
        const route = routes[scopeSeed(room.seed, p.id + ':training') % routes.length];
        if (p.training !== route) room = act(room, { type: 'train', player_id: p.id, route });
    }
    return act(room, { type: 'ready' });
}

export function respondComputer(input: Room, action: GameAction): Room {
    let room = input;
    while (room.state === 'DRAFT' && room.clubs[snakePicker(room.draft.turn)].user_id === COMPUTER_USER) {
        room = act(room, { type: 'pick', turn: room.draft.turn, player_id: computerChoice(room.draft.candidates).id });
    }
    if (room.state === 'SEASON' && action.type === 'ready' && !room.active_match)
        room = prepareComputer(room);
    if (room.state === 'SEASON' && action.type === 'settle') {
        room = applyAction(room, SOLO_USER, { type: 'lineup', formation: room.clubs[0].formation,
            auto: true, season: room.current_season, round: room.current_round });
    }
    if (room.state === 'OFFSEASON') {
        let c = room.clubs.find(c => c.user_id === COMPUTER_USER)!;
        if (!c.offseason_ready) {
            if (c.youth.length && c.cash >= 1000 && c.players.length < 24)
                room = act(room, { type: 'youth_sign', player_id: computerChoice(c.youth).id });
            room = act(room, { type: 'next_season' });
        }
        c = room.clubs.find(c => c.user_id === COMPUTER_USER)!;
        for (const offer of room.transfers.filter(t => t.to === c.id && t.state === 'PENDING')) {
            const from = room.clubs.find(x => x.id === offer.from)!;
            const received = from.players.find(p => p.id === offer.player);
            const given = c.players.find(p => p.id === offer.exchange);
            const fair = !!received && visibleValue(received) + offer.money / 300 >= (given ? visibleValue(given) : 0) * .97;
            try { room = act(room, { type: fair ? 'accept_offer' : 'reject_offer', offer_id: offer.id }); }
            catch { room = act(room, { type: 'reject_offer', offer_id: offer.id }); }
        }
    }
    return room;
}
