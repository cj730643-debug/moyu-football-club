import type { Position, Formation, TraitDef } from './types.ts';
export const POSITIONS: Record<Position, {
    name: string;
    desc: string;
    weights: number[];
    adapted: Position[];
}> = {
    GK: { name: '门将', desc: '守住球门，负责扑救、出击和从后场把球传出去。', weights: [.27, .24, .14, .12, .1, .08, .05], adapted: [] },
    CB: { name: '中后卫', desc: '守在球门前方，负责抢断、解围和阻止对方前锋。', weights: [.12, .03, .08, .07, .35, .25, .10], adapted: ['DM', 'FB'] },
    FB: { name: '边后卫', desc: '保护两条边路，也可以向前助攻。需要兼顾速度和防守。', weights: [.20, .03, .15, .10, .25, .10, .17], adapted: ['CB', 'W'] },
    DM: { name: '后腰', desc: '站在后卫前面，抢回球权，保护防线并帮助出球。', weights: [.07, .03, .15, .10, .30, .15, .20], adapted: ['CB', 'CM'] },
    CM: { name: '中场', desc: '负责传球、接应和连接前后场，是球队的传球枢纽。', weights: [.07, .05, .25, .20, .15, .08, .20], adapted: ['DM', 'AM'] },
    AM: { name: '前腰', desc: '在前锋身后创造进球机会，用最后一传撕开防线。', weights: [.10, .15, .30, .25, .03, .07, .10], adapted: ['CM', 'ST'] },
    W: { name: '边锋', desc: '在边路突破、传中或内切射门，适合速度和控球出色的球员。', weights: [.25, .15, .15, .25, .05, .05, .10], adapted: ['FB', 'ST'] },
    ST: { name: '前锋', desc: '主要负责射门和进球，通常站在球队最前面。', weights: [.20, .30, .07, .15, .03, .15, .10], adapted: ['W', 'AM'] }
};
export const FIELD_ATTRS = ['速度', '射门', '传球', '控球', '防守', '身体', '体能'];
export const GK_ATTRS = ['扑救', '反应', '出击', '出球', '控制', '身体', '体能'];
export const FORMATIONS: Record<Formation, Position[]> = {
    '4-3-3': ['GK', 'FB', 'CB', 'CB', 'FB', 'DM', 'CM', 'CM', 'W', 'ST', 'W'],
    '4-4-2': ['GK', 'FB', 'CB', 'CB', 'FB', 'W', 'CM', 'CM', 'W', 'ST', 'ST'],
    '4-2-3-1': ['GK', 'FB', 'CB', 'CB', 'FB', 'DM', 'DM', 'W', 'AM', 'W', 'ST'],
    '3-5-2': ['GK', 'CB', 'CB', 'CB', 'FB', 'DM', 'CM', 'AM', 'FB', 'ST', 'ST']
};
export const ROUTES: Record<Position, string[]> = { GK: ['门线守护者', '出击门将', '后场发动机'], CB: ['防守核心', '高空中卫', '出球中卫'], FB: ['防守边卫', '进攻边卫', '均衡边卫'], DM: ['防守屏障', '抢球机器', '后场组织者'], CM: ['组织中场', '全能中场', '前插中场'], AM: ['机会创造者', '影子前锋', '组织前腰'], W: ['爆破边锋', '内切得分手', '边路组织者'], ST: ['终结者', '支点中锋', '冲击型前锋'] };
const raw: [
    string,
    string,
    string,
    Partial<Record<string, number>>,
    number,
    string[]?
][] = [
    ['喜欢射门', 'style', 'white', { longShots: 1, finishing: 1 }, 55, ['精准射手']], ['精准射手', 'style', 'blue', { finishing: 2, composure: 1 }, 65, ['禁区杀手']], ['禁区杀手', 'style', 'purple', { finishing: 3, offTheBall: 2 }, 76, ['冷血终结者']],
    ['门前嗅觉', 'style', 'blue', { anticipation: 2, offTheBall: 2 }, 65], ['远射威胁', 'style', 'blue', { longShots: 3 }, 66], ['喜欢带球', 'style', 'white', { dribbling: 1 }, 55, ['突破手']], ['突破手', 'style', 'blue', { dribbling: 2, agility: 1 }, 65, ['爆破手']], ['爆破手', 'style', 'purple', { dribbling: 3, acceleration: 2 }, 77], ['内切威胁', 'style', 'blue', { finishing: 2, flair: 1 }, 67], ['狭小空间高手', 'style', 'purple', { firstTouch: 3, agility: 2 }, 77],
    ['稳定出球', 'style', 'white', { passing: 1, composure: 1 }, 55, ['快速出球', '长传调度']], ['长传调度', 'style', 'blue', { passing: 2, vision: 2 }, 66, ['手术刀']], ['快速出球', 'style', 'blue', { decisions: 2, passing: 1 }, 66, ['节拍器']], ['节拍器', 'style', 'purple', { decisions: 3, teamwork: 2 }, 77, ['中场大脑']], ['手术刀', 'style', 'purple', { vision: 3, passing: 2 }, 78, ['中场大脑']], ['最后一传', 'style', 'blue', { vision: 2, passing: 2 }, 68],
    ['积极跑动', 'style', 'white', { workRate: 2 }, 54, ['反击箭头', '压迫意识']], ['反击箭头', 'style', 'blue', { pace: 2, offTheBall: 1 }, 66, ['反击尖刀']], ['反击尖刀', 'style', 'purple', { acceleration: 3, offTheBall: 2 }, 78], ['肋部幽灵', 'style', 'purple', { offTheBall: 3, anticipation: 2 }, 78], ['后插上', 'style', 'blue', { offTheBall: 2, finishing: 1 }, 67], ['门前幽灵', 'style', 'purple', { offTheBall: 3, finishing: 2 }, 78],
    ['争顶好手', 'style', 'blue', { heading: 2, jumpingReach: 2 }, 67, ['空中霸主']], ['空中霸主', 'style', 'purple', { heading: 3, jumpingReach: 3 }, 78], ['背身支点', 'style', 'blue', { strength: 2, balance: 2 }, 67], ['积极拦截', 'style', 'white', { tackling: 1, workRate: 1 }, 55, ['抢断专家', '防守纪律']], ['抢断专家', 'style', 'blue', { tackling: 3 }, 66, ['预判高手']], ['防守纪律', 'style', 'blue', { positioning: 2, concentration: 2 }, 66, ['预判高手']], ['预判高手', 'style', 'purple', { anticipation: 3, positioning: 2 }, 78, ['防线统帅']], ['贴身防守', 'style', 'blue', { marking: 3 }, 65], ['封堵机器', 'style', 'purple', { positioning: 3, bravery: 2 }, 78], ['边路锁链', 'style', 'purple', { marking: 3, tackling: 2 }, 78], ['压迫意识', 'style', 'blue', { workRate: 2, anticipation: 1 }, 65, ['高压猎犬']], ['高压猎犬', 'style', 'purple', { workRate: 3, stamina: 2 }, 77], ['抢后立刻进攻', 'style', 'blue', { decisions: 2, vision: 1 }, 66],
    ['稳健扑救', 'style', 'white', { handling: 2 }, 55, ['门线反应']], ['门线反应', 'style', 'blue', { reflexes: 3 }, 66], ['单刀克星', 'style', 'purple', { oneOnOnes: 4 }, 78], ['高空统治', 'style', 'purple', { aerialReach: 3, commandOfArea: 2 }, 78], ['出击型门将', 'style', 'blue', { rushingOut: 3 }, 65], ['后场发动机', 'style', 'blue', { throwing: 3, passing: 2 }, 66],
    ['训练狂', 'personality', 'blue', { determination: 2 }, 0], ['职业球员', 'personality', 'white', { concentration: 1 }, 0], ['大心脏', 'personality', 'purple', { composure: 3 }, 0], ['神经刀', 'personality', 'blue', { flair: 3, concentration: -2 }, 0], ['领袖', 'personality', 'purple', { leadership: 3, teamwork: 1 }, 0], ['忠诚', 'personality', 'blue', { teamwork: 2 }, 0], ['好胜', 'personality', 'blue', { determination: 2, aggression: 1 }, 0], ['自信', 'personality', 'blue', { composure: 2 }, 0], ['散漫', 'personality', 'white', { workRate: -2, concentration: -2 }, 0], ['胆怯', 'personality', 'white', { bravery: -2, composure: -1 }, 0], ['刺头', 'personality', 'blue', { aggression: 3, teamwork: -2 }, 0], ['毛躁', 'personality', 'white', { decisions: -2 }, 0],
    ['爆发怪', 'body', 'purple', { acceleration: 3 }, 0], ['耐力怪', 'body', 'blue', { stamina: 3 }, 0], ['铁人', 'body', 'purple', { naturalFitness: 3 }, 0], ['强壮体质', 'body', 'blue', { strength: 3 }, 0], ['柔韧', 'body', 'blue', { agility: 2, balance: 2 }, 0], ['玻璃人', 'body', 'white', { naturalFitness: -2 }, 0], ['体能槽浅', 'body', 'white', { stamina: -3 }, 0], ['慢热', 'body', 'white', { acceleration: -1 }, 0], ['恢复慢', 'body', 'white', { naturalFitness: -3 }, 0],
    ['冷血终结者', 'legend', 'gold', { composure: 4, finishing: 3 }, 86], ['逆境之王', 'legend', 'gold', { determination: 4, bravery: 3 }, 86], ['关键先生', 'legend', 'gold', { composure: 4, decisions: 3 }, 87], ['双足怪', 'legend', 'gold', { technique: 4, crossing: 2 }, 86], ['足球智商', 'legend', 'gold', { decisions: 4, anticipation: 3 }, 88], ['永动机', 'legend', 'gold', { stamina: 4, workRate: 3 }, 86], ['一人一城', 'legend', 'gold', { leadership: 4, teamwork: 3 }, 83], ['防线统帅', 'legend', 'gold', { positioning: 4, leadership: 3 }, 87], ['中场大脑', 'legend', 'gold', { vision: 4, decisions: 3 }, 87], ['天生巨星', 'legend', 'gold', { flair: 4, composure: 2 }, 91], ['导师', 'personality', 'purple', { leadership: 3 }, 0]
];
const descriptions: Record<string, string> = { '训练狂': '训练投入更多，成长稍快，也需要休息。', '神经刀': '高光更亮眼，但临场发挥容易波动。', '玻璃人': '受伤风险较高；休息能降低风险，无法洗掉体质。', '散漫': '训练投入不足，长期职业路线有机会改善。', '胆怯': '压力下容易犹豫，长期出场和成功行动可以改善。', '慢热': '开场较慢进入状态，持续出场有机会改善。', '一人一城': '长期效力形成领导力和协作特点，元老身份本身没有加成。', '冷血终结者': '把强项集中在禁区终结与冷静选择。', '中场大脑': '更善于发现线路、判断传球时机。', '防线统帅': '读懂进攻线路，组织协作防守。', '永动机': '能维持长时间跑动和压迫，适合高位战术。' };
export const TRAITS: TraitDef[] = raw.map(([name, kind, color, effect, requires, next]) => ({ id: name, name, kind: kind as TraitDef['kind'], color: color as TraitDef['color'], effect, requires, next, desc: descriptions[name] || '在对应比赛动作中体现这个特点，成功行为和培养路线会推动形成。' }));
export const TRAIT_MAP = Object.fromEntries(TRAITS.map(t => [t.id, t]));
