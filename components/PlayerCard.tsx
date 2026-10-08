'use client';
import { useEffect, useRef, useState } from 'react';
import { X, LockKeyhole, ArrowUpRight } from 'lucide-react';
import type { Career, Player } from '../game/types.ts';
import { POSITIONS, FIELD_ATTRS, GK_ATTRS, TRAIT_MAP, ROUTES } from '../game/catalog.ts';
import { nickname, rating } from '../game/players.ts';
export function PositionLabel({ player }: {
    player: Player;
}) { return <span className="position-help" tabIndex={0}>{POSITIONS[player.position].name}<span className="tooltip">{POSITIONS[player.position].desc}</span></span>; }
export function Trait({ id }: {
    id: string;
}) { const t = TRAIT_MAP[id]; return <span tabIndex={0} className={'trait ' + (t?.color || 'white')}>{id}<span className="tooltip">{t?.desc}</span></span>; }
export function PlayerAvatar({ player, large = false }: {
    player: Player;
    large?: boolean;
}) { return <div className={'player-avatar ' + (large ? 'large' : '')} style={{ '--avatar-hue': String((player.original_nickname.charCodeAt(0) * 13) % 90 + 160) } as React.CSSProperties}><span className="avatar-shirt"/><span className="avatar-face">{nickname(player).slice(0, 1)}</span><span className="avatar-number">{player.founding_player ? '★' : '·'}</span></div>; }
export default function PlayerCard({ player, onPick, onDetail, selected = false }: {
    player: Player;
    onPick?: () => void;
    onDetail?: (p: Player) => void;
    selected?: boolean;
}) { const labels = player.position === 'GK' ? GK_ATTRS : FIELD_ATTRS; return <article className={'player-card ' + (selected ? 'selected' : '')}><div className="player-card-top"><span className="scout-tag">{player.founding_player ? '核心候选' : '球员档案'}</span><span className="card-ovr">{rating(player)}<small>位置评分</small></span></div><div className="card-portrait"><PlayerAvatar player={player} large/><span className="portrait-line"/></div><h3>{nickname(player)}</h3><div className="player-meta"><PositionLabel player={player}/><span>·</span><span>{player.age}岁</span><span>·</span><span>{player.height}cm</span></div><div className="potential"><span>潜力判断</span><b>{player.potential_range}</b></div><div className="attr-grid">{labels.map((label, i) => <div key={label}><span>{label}</span><b className={player.attrs[i] >= 78 ? 'good' : ''}>{player.attrs[i]}</b><i><em style={{ width: player.attrs[i] + '%' }}/></i></div>)}</div><div className="card-traits">{player.traits.map(t => <Trait key={t} id={t}/>)}{player.hidden_count > 0 && <span className="trait locked"><LockKeyhole size={11}/>待发现</span>}</div><p className="scout-comment">{player.logs[0]}</p>{onPick ? <button className="primary wide" onClick={onPick}>选入俱乐部 <ArrowUpRight size={15}/></button> : <button className="quiet wide" onClick={() => onDetail?.(player)}>查看球员档案 →</button>}</article>; }
const CAREER_LABELS: [string, keyof Career][] = [
    ['出场', 'appearances'], ['首发', 'starts'], ['分钟', 'minutes'], ['进球', 'goals'],
    ['制胜球', 'decisive_goals'], ['助攻', 'assists'], ['零封', 'clean_sheets'], ['全场最佳', 'man_of_match'],
    ['黄牌', 'yellow_cards'], ['红牌', 'red_cards'], ['伤病', 'injuries'], ['赛季', 'seasons'], ['冠军', 'trophies'],
];
export function PlayerDetail({ player, onClose, onTrain, onRename, locked }: {
    player: Player;
    onClose: () => void;
    onTrain?: (route: string) => void;
    onRename?: (name: string) => void;
    locked: boolean;
}) {
    const [name, setName] = useState(nickname(player));
    const dialog = useRef<HTMLElement>(null);
    const close = useRef(onClose);
    useEffect(() => { close.current = onClose; }, [onClose]);
    useEffect(() => {
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const controls = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
        ) || []).filter(element => element.getClientRects().length > 0);
        const first = controls()[0];
        (first || dialog.current)?.focus();
        const keydown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { event.preventDefault(); close.current(); }
            if (event.key !== 'Tab') return;
            const items = controls();
            const firstItem = items[0], lastItem = items[items.length - 1];
            if (!firstItem) { event.preventDefault(); dialog.current?.focus(); return; }
            if (!dialog.current?.contains(document.activeElement) || event.shiftKey && document.activeElement === firstItem) {
                event.preventDefault(); (event.shiftKey ? lastItem : firstItem).focus();
            } else if (!event.shiftKey && document.activeElement === lastItem) {
                event.preventDefault(); firstItem.focus();
            }
        };
        document.addEventListener('keydown', keydown);
        return () => {
            document.removeEventListener('keydown', keydown);
            document.body.style.overflow = previousOverflow;
            if (previous?.isConnected) previous.focus();
        };
    }, []);
    const evaluation = player.retirement?.evaluation || player.legacy;
    return <div className="modal-backdrop" onClick={onClose}>
        <section ref={dialog} tabIndex={-1} className="player-modal" role="dialog" aria-modal="true" aria-label="球员详情" onClick={e => e.stopPropagation()}>
            <button className="modal-close icon-button" onClick={onClose} aria-label="关闭"><X size={22}/></button>
            <div className="detail-heading">
                <PlayerAvatar player={player} large/>
                <div>
                    <div className="eyebrow">PLAYER PROFILE · {player.founding_player ? '建队元老' : '俱乐部球员'}</div>
                    <h2>{nickname(player)} <span className="muted">{rating(player)}</span></h2>
                    <p><PositionLabel player={player}/> · {player.age}岁 · {player.height}cm · {player.foot} · {player.body}</p>
                    <p className="muted">潜力 {player.potential_range} · {['🔥 火热', '🙂 正常', '😐 一般', '🥶 低迷'][player.form]} · 体力 {player.fitness} · {player.injury ? `伤停${player.injury}场` : '健康'}</p>
                </div>
            </div>
            {evaluation && <div className="legacy-panel">
                <div><span className="eyebrow">{player.retirement ? '退役评价' : '俱乐部贡献'}</span><strong>{evaluation.title}</strong></div>
                <p>{evaluation.reasons.join(' · ')}</p>
                <small className="muted">{player.retirement ? `第${player.retirement.season}季结束后，${player.retirement.age}岁退役。` : '称号随本队出场、效力年数和比赛贡献积累，退役时保存最终评价。'}</small>
            </div>}
            <div className="detail-columns">
                <div>
                    <h4>球员特点</h4>
                    <div className="card-traits">{player.traits.map(t => <Trait key={t} id={t}/>)}{player.hidden_count > 0 && <span className="trait locked">🔒 隐藏特点</span>}</div>
                    <h4>位置适应</h4>
                    <p>🟢 {POSITIONS[player.position].name} {player.adapted.map(p => <span key={p}> · 🟡 {POSITIONS[p].name}</span>)}</p>
                    <h4>培养方向</h4>
                    <select aria-label="培养方向" disabled={locked || !onTrain || Boolean(player.retirement)} value={player.training} onChange={e => onTrain?.(e.target.value)}>{ROUTES[player.position].map(r => <option key={r}>{r}</option>)}</select>
                    <p className="muted small">选择路线，成长由训练投入与比赛表现逐渐形成。</p>
                    {onRename && !player.retirement && <>
                        <h4>专属外号</h4>
                        <div className="input-row"><input aria-label="专属外号" value={name} maxLength={12} onChange={e => setName(e.target.value)}/><button className="quiet" onClick={() => onRename(name)}>保存</button></div>
                    </>}
                    <h4>成长与故事</h4>
                    <div className="growth-list">{player.logs.map((l, i) => <p key={i}>{l}</p>)}</div>
                </div>
                <div>
                    <h4>永久比赛档案</h4>
                    <p className="muted small">零封按门将出场计算；制胜球为胜方超过对手最终进球数的那一球。</p>
                    <table className="career-table">
                        <thead><tr><th scope="col">统计</th><th scope="col">赛季</th><th scope="col">生涯</th>{player.club_stats && <th scope="col">本队</th>}</tr></thead>
                        <tbody>{CAREER_LABELS.map(([label, key]) => <tr key={key}><th scope="row">{label}</th><td>{player.seasonStats[key]}</td><td>{player.career[key]}</td>{player.club_stats && <td>{player.club_stats[key]}</td>}</tr>)}</tbody>
                    </table>
                    <p className="muted small">在本俱乐部效力 {player.club_seasons} 季</p>
                </div>
            </div>
        </section>
    </div>;
}
