'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, ShieldCheck, Maximize2, LoaderCircle } from 'lucide-react';
import type { Club, MatchSummary, ReplayFrame, ReplayEvent, Replay, PlayerStat } from '../game/types.ts';
import { api } from '../lib/client.ts';
import { frameAt, scoreAt, clock, bufferedUntil, playbackSecond, advanceReplay, MATCH_PLAY_SECONDS } from '../game/replay.ts';
import { mountReplayCanvas } from '../lib/canvas-replay.ts';
type Meta = Pick<Replay, 'duration' | 'lineups' | 'tactics' | 'replay_hash' | 'engine_version'> & {
    last_viewed_second: number;
    frames: ReplayFrame[];
    events: ReplayEvent[];
    result: [
        number,
        number
    ] | null;
    stats: Record<string, PlayerStat> | null;
    team_stats: Replay['team_stats'] | null;
    generating?: boolean;
};
export default function MatchPlayer({ match, home, away, roomId, onFinished, solo = false }: {
    solo?: boolean;
    match: MatchSummary;
    home: Club;
    away: Club;
    roomId: string;
    onFinished: () => void;
}) {
    const canvasHost = useRef<HTMLDivElement>(null);
    const frames = useRef<ReplayFrame[]>([]), allEvents = useRef<ReplayEvent[]>([]);
    const loaded = useRef(new Set<number>()), loading = useRef(new Set<number>());
    const retryAt = useRef(new Map<number, number>());
    const halfTaken = useRef(false);
    const secondRef = useRef(0), maxWatched = useRef(0), playingRef = useRef(false), metaRef = useRef<Meta | null>(null), active = useRef(true), saveBusy = useRef(false), lastSaveMark = useRef(0);
    const [second, setSecond] = useState(0), [playing, setPlaying] = useState(false), [meta, setMeta] = useState<Meta | null>(null), [error, setError] = useState(''), [hover, setHover] = useState(''), [half, setHalf] = useState(false), [rendererReady, setRendererReady] = useState(false), [reload, setReload] = useState(0);
    const fetchChunk = useCallback(async (index: number) => { if (loaded.current.has(index) || loading.current.has(index) || Date.now() < (retryAt.current.get(index) || 0) || index > Math.floor((metaRef.current?.duration || 5400) / 60))
        return; loading.current.add(index); try {
        const chunk = await api<Meta>({ type: 'replay', room_id: roomId, match_id: match.id, chunk: index });
        if (chunk.generating)
            return;
        loaded.current.add(index);
        frames.current = [...frames.current, ...chunk.frames].sort((a, b) => a.t - b.t);
        allEvents.current = [...allEvents.current, ...chunk.events].sort((a, b) => a.time - b.time);
        if (!metaRef.current) {
            metaRef.current = chunk;
            setMeta(chunk);
            secondRef.current = chunk.last_viewed_second;
            maxWatched.current = chunk.last_viewed_second;
            setSecond(chunk.last_viewed_second);
        }
    }
    catch (e) {
        loaded.current.delete(index);
        retryAt.current.set(index, Date.now() + 800);
        if (active.current && !(e instanceof Error && e.message.includes('future replay')))
            setError(e instanceof Error ? e.message : '录像加载失败');
    }
    finally {
        loading.current.delete(index);
    } }, [roomId, match.id]);
    useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
    useEffect(() => { let cancelled = false; void api<Meta>({ type: 'replay', room_id: roomId, match_id: match.id, chunk: 0 }).then(async (m) => { if (cancelled)
        return; metaRef.current = m; setMeta(m); secondRef.current = m.last_viewed_second; maxWatched.current = m.last_viewed_second; lastSaveMark.current = performance.now(); setSecond(m.last_viewed_second); frames.current = []; allEvents.current = []; loaded.current.clear(); loading.current.clear(); retryAt.current.clear(); const idx = Math.floor(m.last_viewed_second / 60); await fetchChunk(idx); await fetchChunk(Math.min(idx + 1, Math.floor(m.duration / 60))); }).catch(e => setError(e.message)); return () => { cancelled = true; }; }, [roomId, match.id, fetchChunk]);
    const saveProgress = useCallback(async () => { if (saveBusy.current || !metaRef.current || secondRef.current <= maxWatched.current)
        return; const eligible = Math.min(secondRef.current, maxWatched.current + Math.min((performance.now() - lastSaveMark.current) / 1000, 15) * 70); if (eligible <= maxWatched.current)
        return; saveBusy.current = true; try {
        const updated = await api<Meta>({ type: 'progress', room_id: roomId, match_id: match.id, second: Math.min(eligible, metaRef.current.duration), chunk: Math.floor(eligible / 60) });
        maxWatched.current = updated.last_viewed_second;
        lastSaveMark.current = performance.now();
        if (updated.result) {
            metaRef.current = { ...metaRef.current, ...updated };
            if (active.current)
                setMeta(metaRef.current);
            onFinished();
        }
    }
    catch (e) {
        if (active.current)
            setError(e instanceof Error ? e.message : '观看进度保存失败');
    }
    finally {
        saveBusy.current = false;
    } }, [match.id, roomId, onFinished]);
    useEffect(() => { const id = setInterval(() => void saveProgress(), 1000); const visibility = () => { if (document.visibilityState === 'hidden')
        void saveProgress(); }; document.addEventListener('visibilitychange', visibility); return () => { clearInterval(id); document.removeEventListener('visibilitychange', visibility); void saveProgress(); }; }, [saveProgress]);
    useEffect(() => {
        if (!meta)
            return;
        let raf = 0;
        let destroyNative: (() => void) | null = null;
        setRendererReady(false);
        try {
            if (canvasHost.current) {
                destroyNative = mountReplayCanvas(canvasHost.current, home, away, meta.lineups,
                    () => ({ frame: frameAt(frames.current, secondRef.current), second: secondRef.current, events: allEvents.current }), setHover);
                setRendererReady(true);
            }
        } catch (e) { setError(e instanceof Error ? e.message : '比赛画面加载失败'); }
        let previous = performance.now();
        let lastUI = 0;
        halfTaken.current = secondRef.current >= meta.duration / 2;
        const tick = (now: number) => {
            const elapsed = Math.min((now - previous) / 1000, .25);
            previous = now;
            if (playingRef.current && metaRef.current) {
                const max = bufferedUntil(loaded.current, secondRef.current, metaRef.current.duration);
                if (secondRef.current < max) {
                    secondRef.current = Math.min(max, advanceReplay(secondRef.current, elapsed, metaRef.current.duration));
                }
                const halftime = metaRef.current.duration / 2;
                if (!halfTaken.current && secondRef.current >= halftime) {
                    secondRef.current = halftime;
                    halfTaken.current = true;
                    playingRef.current = false;
                    setPlaying(false);
                    setHalf(true);
                }
                if (secondRef.current >= metaRef.current.duration) {
                    playingRef.current = false;
                    setPlaying(false);
                    void saveProgress();
                }
                const idx = Math.floor(secondRef.current / 60);
                void fetchChunk(idx);
                void fetchChunk(idx + 1);
                if (secondRef.current % 60 > 30)
                    void fetchChunk(idx + 2);
            }
            if (now - lastUI > 120) {
                setSecond(secondRef.current);
                lastUI = now;
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => { cancelAnimationFrame(raf); destroyNative?.(); };
        // Renderer identity follows the match; progress and polling do not rebuild it.
    }, [Boolean(meta), match.id, reload]);
    const skip = async () => {
        if (!solo || saveBusy.current || !metaRef.current) return;
        saveBusy.current = true; playingRef.current = false; setPlaying(false); setHalf(false);
        try {
            const updated = await api<Meta>({ type: 'solo_skip', room_id: roomId, match_id: match.id });
            metaRef.current = { ...metaRef.current, ...updated }; setMeta(metaRef.current);
            maxWatched.current = updated.last_viewed_second; secondRef.current = updated.duration; setSecond(updated.duration);
            await fetchChunk(Math.floor(updated.duration / 60)); onFinished();
        } catch (e) { setError(e instanceof Error ? e.message : '结算失败'); }
        finally { saveBusy.current = false; }
    };
    const toggle = () => { playingRef.current = !playingRef.current; setPlaying(playingRef.current); };
    const score = meta?.result && second >= meta.duration ? meta.result : scoreAt(allEvents.current, second);
    const shownEvents = allEvents.current.filter(e => e.time <= second && ['GOAL', 'SHOT', 'SAVE', 'YELLOW_CARD', 'RED_CARD', 'SUBSTITUTION', 'INJURY', 'OFFSIDE', 'HALF_TIME', 'FULL_TIME'].includes(e.type)).slice(-9).reverse();
    const trait = allEvents.current.findLast(e => e.trait && e.time <= second && second - e.time < 18);
    const possessionFrames = frames.current.filter(f => f.t <= second);
    const f = frameAt(frames.current, second);
    const summaryStats = meta?.team_stats;
    const displaySecond = playbackSecond(second, meta?.duration || match.duration);
    const halfName = displaySecond < MATCH_PLAY_SECONDS / 2 ? '上半场' : '下半场';
    return <section className="match-layout"><div className="match-main panel"><div className="match-top"><span className="eyebrow">完整比赛 · 第{match.season}季 / 第{match.round}轮</span><span className="verified"><ShieldCheck size={13}/>{solo ? '单人比赛录像' : '唯一官方录像'}</span></div><div className="scoreboard"><div><i style={{ background: home.color }}/>{home.short}</div><strong>{score[0]} <span>:</span> {score[1]}</strong><div>{away.short}<i style={{ background: away.color }}/></div></div><div className="match-clock">{clock(displaySecond)} <span>{second >= Number(meta?.duration) ? '全场结束' : half ? '中场休息' : playing ? halfName + '进行中' : halfName + ' · 待播放'}</span></div><div className="canvas-wrap"><div className="canvas-host" ref={canvasHost}/>{!rendererReady && <div className="canvas-loading" role="status">{error ? '球场画面暂时无法显示，请点击下方重试。' : <><LoaderCircle className="spin"/> {solo ? '正在载入球场与比赛录像…' : '正在载入球场与官方录像…'}</>}</div>}</div>{hover && <div className="pitch-hover">{hover}</div>}{trait && <div className="trait-callout">{trait.trait} <small>{trait.text}</small></div>}
 <div className="player-controls"><button className="icon-button" onClick={toggle} disabled={!rendererReady || !meta || second >= meta.duration} aria-label={playing ? '暂停' : '播放'}>{playing ? <Pause size={20}/> : <Play size={20}/>}</button><button className="icon-button" onClick={() => { secondRef.current = 0; halfTaken.current = false; setHalf(false); setSecond(0); playingRef.current = false; setPlaying(false); void fetchChunk(0); }} aria-label="重新观看"><RotateCcw size={17}/></button><div className="play-progress"><i style={{ width: (meta ? second / meta.duration * 100 : 0) + '%' }}/></div><span className="mono">{clock(displaySecond)} / 06:00</span><span className="match-pace">每半场 3 分钟</span><button className="icon-button" aria-label="全屏" onClick={() => void canvasHost.current?.parentElement?.requestFullscreen()}><Maximize2 size={17}/></button></div>
 {solo && meta && second < meta.duration && <button className="quiet solo-skip" onClick={() => void skip()}>直接查看赛果 <ShieldCheck size={14}/></button>}
 <div className="match-bottom"><span>全场 6 分钟 · 中场暂停休息 · 头顶显示体力</span><span>已保存至 {clock(playbackSecond(maxWatched.current, meta?.duration || match.duration))}</span></div>{error && <div className="error">{error} <button onClick={() => { setError(''); setReload(v => v + 1); }}>重试</button></div>}
 {half && <div className="halftime-overlay"><span className="eyebrow">HALF TIME</span><h3>喝口水，下半场见。</h3><p>{home.short} {score[0]} : {score[1]} {away.short}</p><p className="muted">已记录 {shownEvents.filter(e => e.type === 'SHOT').length} 次近期射门 · 场上平均体力 {f ? Math.round(f.p.reduce((n, p) => n + p[3], 0) / f.p.length) : '—'}</p><button className="primary" onClick={() => { setHalf(false); playingRef.current = true; setPlaying(true); }}>继续下半场 <Play size={15}/></button></div>}
 </div><aside className="match-aside"><div className="panel"><div className="section-label">场边记录<span className={playing ? 'live-dot' : ''}/></div><div className="event-log">{shownEvents.length ? shownEvents.map((e, i) => <div key={e.time + '-' + i} className={e.type === 'GOAL' ? 'goal-event' : ''}><time>{clock(playbackSecond(e.time, meta?.duration || match.duration))}</time><span>{e.text}</span></div>) : <p className="muted">哨声响起后，故事就开始了。</p>}</div></div><div className="panel"><div className="section-label">比赛概览</div>{summaryStats ? (['possession', 'shots', 'onTarget', 'chances', 'passRate', 'tackles', 'fouls', 'offsides', 'yellow', 'red'] as const).map((key, i) => <div className="stat-row" key={key}><b>{summaryStats.home[key]}{key === 'possession' || key === 'passRate' ? '%' : ''}</b><span>{['控球', '射门', '射正', '关键机会', '传球成功', '抢断', '犯规', '越位', '黄牌', '红牌'][i]}</span><b>{summaryStats.away[key]}{key === 'possession' || key === 'passRate' ? '%' : ''}</b></div>) : <><p className="muted small">{home.tactic.attack} / {away.tactic.attack}</p><div className="stat-row"><b>{allEvents.current.filter(e => e.time <= second && e.type === 'SHOT' && e.side === 'home').length}</b><span>射门</span><b>{allEvents.current.filter(e => e.time <= second && e.type === 'SHOT' && e.side === 'away').length}</b></div><p className="small muted">{possessionFrames.length} 帧比赛已播放。完整统计将在终场后公开。</p></>}</div><div className="replay-stamp"><ShieldCheck size={20}/><div>{solo ? '你与电脑，一场球队故事。' : '两位教练，同一场比赛。'}<small>录像 {meta?.replay_hash?.slice(0, 12) || '正在生成'} · 永久保存</small></div></div></aside></section>;
}
