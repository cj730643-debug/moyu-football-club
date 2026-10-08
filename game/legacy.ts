import type { Career, LegacyEvaluation, LegacyTitle, Position } from './types.ts';

// Club contributions only. Attributes, potential and transfer value never affect this title.
export function evaluateLegacy(position: Position, stats: Career, tenure: number, founder = false): LegacyEvaluation {
    const production = position === 'GK'
        ? stats.clean_sheets * 2.2
        : position === 'CM' || position === 'AM' || position === 'DM'
            ? stats.assists * 1.7 + stats.goals * 1.1
            : stats.goals * 1.4 + stats.assists * 1.2;
    const score = Math.round(Math.max(0, stats.appearances * .8 + stats.starts * .2
        + stats.minutes / 900 + production + stats.man_of_match * 2.5
        + stats.trophies * 6 + stats.decisive_goals * 3 + Math.min(tenure, 25) * 2.3
        + (founder && stats.appearances >= 10 ? 5 : 0) - stats.red_cards * 1.5));
    let title: LegacyTitle = '普通球员';
    if (stats.appearances >= 10 && stats.starts >= 8) title = '主力球员';
    if (stats.appearances >= 30 && tenure >= 3 && score >= 65) title = '功勋球员';
    if (stats.appearances >= 40 && tenure >= 4 && score >= 115) title = '俱乐部明星';
    if (stats.appearances >= 60 && tenure >= 6 && score >= 175) title = '俱乐部传奇';
    if (stats.appearances >= 100 && tenure >= 10 && score >= 300) title = '队史最佳之一';
    const reasons = [`为本队出场${stats.appearances}场，首发${stats.starts}场，效力${tenure}季`];
    if (stats.trophies) reasons.push(`随本队夺冠${stats.trophies}次`);
    if (position === 'GK' && stats.clean_sheets) reasons.push(`保持零封${stats.clean_sheets}场`);
    if (stats.goals || stats.assists) reasons.push(`贡献${stats.goals}球、${stats.assists}次助攻`);
    if (stats.decisive_goals) reasons.push(`打入${stats.decisive_goals}粒制胜球`);
    if (stats.man_of_match) reasons.push(`当选全场最佳${stats.man_of_match}次`);
    if (founder) reasons.push('从建队选秀开始陪伴俱乐部');
    return { title, score, reasons, rules_version: 'mfc-legacy.1' };
}
