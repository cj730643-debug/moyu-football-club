import { POSITIONS, ROUTES, TRAIT_MAP, FORMATIONS } from './catalog.ts';
import { rng, scopeSeed, int, clamp } from './random.ts';
import { emptyCareer } from './types.ts';
import type { Attrs, Player, Position, Club, Room, PlayerStat, Formation } from './types.ts';
const names = ['闪电', '铁塔', '教授', '狐狸', '猎犬', '刀锋', '门神', '邮差', '船长', '小熊', '火炮', '冰人', '猎鹰', '坦克', '木匠', '黑骑士', '卷毛', '红胡子', '老钟', '小霸王', '飞翼', '影子', '铁闸', '岩壁', '医生', '厨子', '扑克脸', '长腿', '笑面虎', '圆脸', '火花', '望远镜', '石头', '雨燕', '指南针', '引擎', '罗盘', '桥梁', '钟摆', '刺猬', '壁虎', '猫头鹰', '扳手', '铅笔', '风车', '灯塔', '北极星', '扫帚', '墨镜', '豹子', '木盾', '流星', '海豹', '冰箱', '电池', '魔术师', '老虎', '鲸鱼', '榔头', '信使'];
const prefixes = ['小', '冷面', '红发', '钢铁', '飞天', '金牌', '慢悠悠', '黑帽', '白眉', '新来的', '南城', '北街'];
export const nickname = (p: Player) => p.custom_nickname || p.original_nickname;
export function rating(p: Pick<Player, 'attrs' | 'position'>, position: Position = p.position) { return Math.round(p.attrs.reduce((n, v, i) => n + v * POSITIONS[position].weights[i], 0)); }
export function fit(p: Player, position: Position) { return p.position === position ? '擅长' : p.adapted.includes(position) ? '可以胜任' : '不适合'; }
export function potentialBand(n: number) { return n >= 91 ? 'S' : n >= 86 ? 'A+' : n >= 80 ? 'A' : n >= 73 ? 'B' : n >= 65 ? 'C' : 'D'; }
export function value(p: Player) { const r = rating(p); return Math.round((r - 35) * 85 * (p.age < 22 ? 1.35 : p.age > 31 ? .65 : 1) * (p.potential_range.includes('S') ? 1.25 : 1) * (1 + p.traits.filter(t => TRAIT_MAP[t]?.color === 'purple' || TRAIT_MAP[t]?.color === 'gold').length * .13)); }
export function generatePlayer(seed: number, id: string, position: Position, core: boolean, used: string[], youth = false): Player {
    const random = rng(scopeSeed(seed, id));
    let name = names[int(random, 0, names.length - 1)];
    let tries = 0;
    while (used.includes(name)) {
        name = (prefixes[Math.floor(tries / names.length) % prefixes.length] || '') + names[tries % names.length] + (tries >= names.length * prefixes.length ? Math.floor(tries / names.length) : '');
        tries++;
    }
    used.push(name);
    const base = core ? int(random, 67, 77) : youth ? int(random, 50, 60) : int(random, 57, 66);
    const attrs = POSITIONS[position].weights.map(w => clamp(base + Math.round((w - .14) * 48) + int(random, -6, 6), 38, 89)) as Attrs;
    const potential = clamp(Math.max(base + 2, core ? int(random, 77, 94) : int(random, 68, 91)), 55, 95);
    const basic: Record<Position, string> = { GK: '稳健扑救', CB: '积极拦截', FB: '积极跑动', DM: '积极拦截', CM: '稳定出球', AM: '稳定出球', W: '喜欢带球', ST: '喜欢射门' };
    const body = ['轻巧型', '均衡型', '强壮型', '高大型'][int(random, 0, 3)];
    const traits = [basic[position]];
    if (random() < .65)
        traits.push(['职业球员', '好胜', '自信', '训练狂', '散漫', '胆怯', '忠诚'][int(random, 0, 6)]);
    if (random() < .55)
        traits.push(['爆发怪', '耐力怪', '强壮体质', '柔韧'][int(random, 0, 3)]);
    const hidden_traits = random() < .65 ? [['玻璃人', '神经刀', '铁人', '恢复慢', '体能槽浅', '慢热', '刺头'][int(random, 0, 6)]] : [];
    for (const hidden of hidden_traits) {
        const kind = TRAIT_MAP[hidden]?.kind;
        for (let i = traits.length - 1; i >= 0; i--)
            if (TRAIT_MAP[traits[i]]?.kind === kind)
                traits.splice(i, 1);
    }
    const p: Player = { id, original_nickname: name, custom_nickname: '', position, adapted: [...POSITIONS[position].adapted], attrs, age: youth ? int(random, 16, 19) : int(random, 18, 31), height: body === '高大型' ? int(random, 189, 201) : int(random, 168, 188), foot: random() < .12 ? '双脚' : random() < .3 ? '左脚' : '右脚', body, potential_range: potential >= 86 ? 'A～S' : potential >= 77 ? 'B～A' : 'C～B', traits, hidden_count: hidden_traits.length, form: 1, fitness: 100, injury: 0, training: ROUTES[position][0], founding_player: core, market_value: 0, career: { ...emptyCareer(), seasons: 1 }, seasonStats: { ...emptyCareer(), seasons: 1 }, logs: ['球探：' + (position === 'GK' ? '扑救和出球各有特点，需要比赛检验。' : body === '高大型' ? '身体条件突出，转身和灵活性值得观察。' : '有鲜明的球风，稳定性还需要观察。')], club_seasons: 1, h: { true_potential: potential, professionalism: int(random, 45, 90), consistency: int(random, 45, 90), injury_proneness: hidden_traits.includes('玻璃人') ? 85 : int(random, 15, 50), hidden_traits, progress: {}, changes: 0, growth: 0, seed: scopeSeed(seed, id) } };
    p.market_value = value(p);
    return p;
}
export function addTrait(p: Player, id: string) {
    const t = TRAIT_MAP[id];
    if (!t || p.traits.includes(id))
        return false;
    const slots = t.kind === 'style' ? 2 : 1;
    if (p.traits.filter(x => TRAIT_MAP[x]?.kind === t.kind).length >= slots)
        return false;
    const conflict: Record<string, string[]> = { '铁人': ['玻璃人', '恢复慢'], '耐力怪': ['体能槽浅'], '玻璃人': ['铁人'], '体能槽浅': ['耐力怪'], '职业球员': ['散漫'], '自信': ['胆怯'], '散漫': ['职业球员'], '胆怯': ['自信'] };
    if ((conflict[id] || []).some(x => p.traits.includes(x)))
        return false;
    p.traits.push(id);
    return true;
}
export function autoLineup(club: Club, formation: Formation = club.formation) { const available = club.players.filter(p => p.injury === 0); const ids: string[] = []; for (const pos of FORMATIONS[formation]) {
    const candidates = available.filter(p => !ids.includes(p.id) && (pos === 'GK' ? p.position === 'GK' : p.position !== 'GK'));
    candidates.sort((a, b) => { const s = (p: Player) => (p.position === pos ? 1 : p.adapted.includes(pos) ? .9 : .68) * rating(p, pos) * (.7 + .3 * p.fitness / 100); return s(b) - s(a); });
    if (!candidates.length)
        throw new Error('健康球员不足，请等待恢复');
    ids.push(candidates[0].id);
} return ids; }
export function completeSquads(room: Room) {
    const filler: Position[] = ['GK', 'CB', 'CB', 'FB', 'FB', 'FB', 'FB', 'CM', 'CM', 'AM', 'W', 'ST'];
    room.clubs.forEach(c => { filler.forEach((pos, i) => c.players.push(generatePlayer(room.seed, `${c.id}-squad-${i}`, pos, false, room.issued_nicknames))); c.lineup = autoLineup(c); });
    const averages = room.clubs.map(c => c.players.filter(p => !p.founding_player).reduce((a, p) => a + rating(p), 0) / 12);
    const diff = averages[0] - averages[1];
    if (Math.abs(diff) > 1) {
        const weaker = room.clubs[diff > 0 ? 1 : 0];
        weaker.players.filter(p => !p.founding_player).forEach(p => { p.attrs = p.attrs.map(a => clamp(a + Math.round(Math.abs(diff)))) as Attrs; p.market_value = value(p); });
    }
}
export function progressPlayer(p: Player, stat: PlayerStat | undefined, seed: number) {
    p.seasonStats.seasons = 1;
    const h = p.h;
    if (!h)
        return;
    const random = rng(scopeSeed(seed, p.id));
    const played = Boolean(stat && stat.minutes > 0);
    const initial = rating(p);
    const target = p.training;
    const style = target.includes('终结') || target.includes('得分') || target.includes('前插') || target.includes('影子') ? '喜欢射门' : target.includes('爆破') || target.includes('冲击') ? '喜欢带球' : target.includes('防守') || target.includes('抢球') || target.includes('高空') ? '积极拦截' : target.includes('压迫') ? '积极跑动' : p.position === 'GK' ? '稳健扑救' : '稳定出球';
    const weighted = POSITIONS[p.position].weights.map((w, i) => w * (style === '喜欢射门' && i === 1 ? 2 : style === '喜欢带球' && (i === 0 || i === 3) ? 1.7 : style === '积极拦截' && i === 4 ? 2 : style === '稳定出球' && i === 2 ? 2 : 1));
    const ageFactor = p.age <= 20 ? 1.6 : p.age <= 24 ? 1.2 : p.age <= 28 ? .8 : p.age <= 31 ? .45 : .2;
    const effort = p.traits.includes('训练狂') ? 1.35 : p.traits.includes('散漫') ? .55 : 1;
    h.growth += (h.true_potential - initial > 0 ? .28 : 0) * ageFactor * effort * (h.professionalism / 75) * (played ? 1.3 : .8) * (p.injury > 0 ? .2 : 1);
    if (h.growth >= 1 && initial < h.true_potential) {
        let roll = random() * weighted.reduce((a, b) => a + b, 0);
        const i = weighted.findIndex(w => (roll -= w) <= 0);
        p.attrs[i] = clamp(p.attrs[i] + 1);
        h.growth -= 1;
        p.logs.unshift(`培养「${target}」有了积累，技术取得进步。`);
    }
    if (p.age >= 32 && random() < .13) {
        const i = p.position === 'GK' ? 5 : 0;
        p.attrs[i] = clamp(p.attrs[i] - 1);
        p.logs.unshift('老将身体状态略有变化，经验与技术依旧重要。');
    }
    if (played && stat) {
        for (const [key, num] of Object.entries({ appearances: 1, starts: stat.starts ? 1 : 0, minutes: stat.minutes, goals: stat.goals, assists: stat.assists, decisive_goals: stat.decisive_goals || 0, clean_sheets: 0, yellow_cards: stat.yellow, red_cards: stat.red, injuries: stat.injured > 0 ? 1 : 0 })) {
            p.career[key as keyof typeof p.career] += num;
            p.seasonStats[key as keyof typeof p.career] += num;
        }
        p.form = stat.rating >= 8 ? 0 : stat.rating >= 6.5 ? 1 : stat.rating >= 5.7 ? 2 : 3;
        p.fitness = clamp(stat.fitness + (p.traits.includes('恢复慢') ? 15 : 27), 0, 100);
        p.injury = Math.max(p.injury, stat.injured);
    }
    else {
        p.fitness = clamp(p.fitness + 35, 0, 100);
    }
    if (p.injury > 0 && !stat?.injured)
        p.injury--;
    const behavior = stat ? (style === '喜欢射门' ? stat.shots + stat.goals * 3 : style === '喜欢带球' ? stat.dribbles : style === '积极拦截' ? stat.tackles : stat.completed / 15) : 0;
    const success = stat ? (style === '喜欢射门' ? stat.goals / Math.max(1, stat.shots) : style === '稳定出球' ? stat.completed / Math.max(1, stat.passes) : Math.min(1, behavior / 5)) : 0;
    h.progress[style] = (h.progress[style] || 0) + (played ? 3 + Math.min(8, behavior) * (0.7 + success) : 1) * ageFactor * effort;
    const existing = p.traits.find(x => x === style || TRAIT_MAP[style]?.next?.includes(x) || TRAIT_MAP[x]?.next?.some(n => n === style));
    const next = existing ? TRAIT_MAP[existing]?.next?.find(n => rating(p) >= TRAIT_MAP[n].requires && (!['style', 'legend'].includes(TRAIT_MAP[n].kind) || TRAIT_MAP[n].kind !== 'legend' || (stat?.goals || 0) >= 1 && h.true_potential >= 86)) : style;
    if (next && h.progress[style] >= 65 && h.changes < 2 && rating(p) >= TRAIT_MAP[next].requires) {
        const oldIndex = existing ? p.traits.indexOf(existing) : -1;
        const old = oldIndex >= 0 ? p.traits.splice(oldIndex, 1)[0] : null;
        if (addTrait(p, next)) {
            h.changes++;
            h.progress[style] = 0;
            p.logs.unshift(`特点形成：【${next}】${old ? '（从【' + old + '】进化）' : ''}`);
        }
        else if (old)
            p.traits.splice(oldIndex, 0, old);
    }
    if (played && p.career.appearances % 3 === 0 && h.hidden_traits.length) {
        const t = h.hidden_traits.shift()!;
        if (addTrait(p, t))
            p.logs.unshift(`经过比赛观察，发现了隐藏特点：【${t}】。`);
        p.hidden_count = h.hidden_traits.length;
    }
    if (p.career.appearances >= 6)
        p.potential_range = potentialBand(h.true_potential - 3) + '～' + potentialBand(h.true_potential);
    if (h.changes < 2 && p.career.appearances >= 8 && random() < .12) {
        const negative = p.traits.find(t => ['胆怯', '散漫', '毛躁', '慢热'].includes(t));
        if (negative) {
            p.traits = p.traits.filter(t => t !== negative);
            h.changes++;
            p.logs.unshift(`长期训练和比赛经验改善了【${negative}】。`);
        }
    }
    p.market_value = value(p);
    p.logs = p.logs.slice(0, 40);
}
export function publicPlayer(p: Player): Player { const { h: _h, ...safe } = p; return safe; }
