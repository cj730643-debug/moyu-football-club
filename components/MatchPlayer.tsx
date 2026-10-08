'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, ShieldCheck, Maximize2, LoaderCircle } from 'lucide-react';
import type { Club, MatchSummary, ReplayFrame, ReplayEvent, Replay, PlayerStat } from '../game/types.ts';
import { api } from '../lib/client.ts';
import { frameAt, scoreAt, clock, bufferedUntil } from '../game/replay.ts';
import { nickname } from '../game/players.ts';
import { mountReplayCanvas } from '../lib/canvas-replay.ts';
import { POSITIONS } from '../game/catalog.ts';
interface PDisplay {
    x: number;
    y: number;
    alpha: number;
    eventMode: string;
    cursor: string;
    on: (name: string, callback: () => void) => void;
    destroy: () => void;
}
interface PContainer extends PDisplay {
    addChild: (...children: PDisplay[]) => void;
}
interface PGraphic extends PDisplay {
    rect: (x: number, y: number, w: number, h: number) => PGraphic;
    circle: (x: number, y: number, r: number) => PGraphic;
    moveTo: (x: number, y: number) => PGraphic;
    lineTo: (x: number, y: number) => PGraphic;
    fill: (color: number | string) => PGraphic;
    stroke: (style: {
        color: number | string;
        width: number;
        alpha?: number;
    }) => PGraphic;
    clear: () => PGraphic;
}
interface PText extends PDisplay {
    text: string;
    anchor: {
        set: (n: number) => void;
    };
}
interface PApp {
    init: (options: Record<string, unknown>) => Promise<void>;
    canvas: HTMLCanvasElement;
    stage: PContainer;
    ticker: {
        add: (cb: () => void) => void;
    };
    destroy: (remove: boolean, options: {
        children: boolean;
    }) => void;
}
interface Pixi {
    Application: new () => PApp;
    Container: new () => PContainer;
    Graphics: new () => PGraphic;
    Text: new (options: {
        text: string;
        style: Record<string, unknown>;
    }) => PText;
}
declare global {
    interface Window {
        PIXI?: Pixi;
    }
}
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
let pixiPromise: Promise<Pixi> | null = null;
function loadPixi() { if (window.PIXI)
    return Promise.resolve(window.PIXI); if (!pixiPromise)
    pixiPromise = new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = 'https://cdn.jsdelivr.net/npm/pixi.js@8.8.1/dist/pixi.min.js'; script.crossOrigin = 'anonymous'; script.onload = () => window.PIXI ? resolve(window.PIXI) : reject(new Error('比赛画面加载失败')); script.onerror = () => { pixiPromise = null; reject(new Error('比赛画面资源暂时无法加载，请重试')); }; document.head.appendChild(script); }); return pixiPromise; }
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
    const secondRef = useRef(0), maxWatched = useRef(0), speedRef = useRef(1), playingRef = useRef(false), metaRef = useRef<Meta | null>(null), active = useRef(true), saveBusy = useRef(false), lastSaveMark = useRef(0);
    const [second, setSecond] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1), [meta, setMeta] = useState<Meta | null>(null), [error, setError] = useState(''), [hover, setHover] = useState(''), [half, setHalf] = useState(false), [rendererReady, setRendererReady] = useState(false), [reload, setReload] = useState(0);
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
        let cancelled = false;
        let app: PApp | null = null;
        let raf = 0;
        let destroyNative: (() => void) | null = null;
        setRendererReady(false);
        const native = () => {
            if (cancelled || !canvasHost.current) return;
            destroyNative = mountReplayCanvas(canvasHost.current, home, away, meta.lineups,
                () => ({ frame: frameAt(frames.current, secondRef.current), second: secondRef.current, events: allEvents.current }), setHover);
            setRendererReady(true);
        };
        if (solo) {
            try { native(); }
            catch (e) { setError(e instanceof Error ? e.message : '比赛画面加载失败'); }
        }
        else void loadPixi().then(async (P) => {
            if (cancelled || !canvasHost.current)
                return;
            const instance = new P.Application();
            await instance.init({ width: 1060, height: 680, background: '#182b24', antialias: true, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true, preference: 'webgl' });
            if (cancelled) {
                instance.destroy(true, { children: true });
                return;
            }
            app = instance;
            canvasHost.current.replaceChildren(app.canvas);
            app.canvas.style.width = '100%';
            app.canvas.style.height = 'auto';
            const field = new P.Graphics();
            for (let i = 0; i < 10; i++)
                field.rect(40 + i * 98, 40, 98, 600).fill(i % 2 ? '#1b3028' : '#1e352c');
            field.rect(40, 40, 980, 600).stroke({ color: '#9ab3a1', width: 1.5, alpha: .5 });
            field.moveTo(530, 40).lineTo(530, 640).stroke({ color: '#9ab3a1', width: 1.5, alpha: .5 });
            field.circle(530, 340, 85).stroke({ color: '#9ab3a1', width: 1.5, alpha: .5 });
            field.circle(530, 340, 3).fill('#9ab3a1');
            field.rect(40, 182, 154, 316).stroke({ color: '#9ab3a1', width: 1.5, alpha: .5 });
            field.rect(866, 182, 154, 316).stroke({ color: '#9ab3a1', width: 1.5, alpha: .5 });
            field.rect(40, 257, 53, 166).stroke({ color: '#9ab3a1', width: 1.5, alpha: .5 });
            field.rect(967, 257, 53, 166).stroke({ color: '#9ab3a1', width: 1.5, alpha: .5 });
            field.rect(20, 308, 20, 64).stroke({ color: '#d4d9ce', width: 2 });
            field.rect(1020, 308, 20, 64).stroke({ color: '#d4d9ce', width: 2 });
            app.stage.addChild(field);
            const pieces = new Map<string, PContainer>();
            const list = [...meta.lineups.home.map(p => ({ p, c: home })), ...meta.lineups.away.map(p => ({ p, c: away }))];
            for (const { p, c } of list) {
                const piece = new P.Container();
                const dot = new P.Graphics().circle(0, 0, 13).fill(c.color).stroke({ color: '#17201c', width: 2 });
                const label = new P.Text({ text: nickname(p)[0], style: { fontFamily: 'sans-serif', fontSize: 12, fontWeight: '700', fill: '#13221b' } });
                label.anchor.set(.5);
                piece.addChild(dot, label);
                piece.eventMode = 'static';
                piece.cursor = 'pointer';
                piece.on('pointerover', () => { const f = frameAt(frames.current, secondRef.current)?.p.find(x => x[0] === p.id); setHover(`${nickname(p)} · ${POSITIONS[p.position].name} · 体力${f?.[3] ?? p.fitness} · ${p.traits.slice(0, 2).join(' / ')}`); });
                piece.on('pointerout', () => setHover(''));
                piece.on('pointertap', () => setHover(`${nickname(p)} · ${POSITIONS[p.position].name} · ${p.traits.join(' / ')}`));
                pieces.set(p.id, piece);
                piece.alpha = 0;
                app.stage.addChild(piece);
            }
            const trail = new P.Graphics(), ball = new P.Graphics().circle(0, 0, 5).fill('#f5f3e9').stroke({ color: '#0a1510', width: 1.4 });
            app.stage.addChild(trail, ball);
            let lastDraw = -1;
            app.ticker.add(() => {
                const f = frameAt(frames.current, secondRef.current);
                if (!f)
                    return;
                const present = new Set(f.p.map(p => p[0]));
                for (const [id, piece] of pieces)
                    piece.alpha = present.has(id) ? 1 : 0;
                for (const p of f.p) {
                    const piece = pieces.get(p[0]);
                    if (piece) {
                        piece.x = 40 + p[1] * 9.8;
                        piece.y = 40 + p[2] * 6;
                        piece.alpha = p[4] ? 0 : 1;
                    }
                }
                ball.x = 40 + f.ball[0] * 9.8;
                ball.y = 40 + f.ball[1] * 6;
                if (Math.floor(secondRef.current) !== lastDraw) {
                    lastDraw = Math.floor(secondRef.current);
                    trail.clear();
                    const e = [...allEvents.current].reverse().find(e => e.time <= secondRef.current && secondRef.current - e.time < 1.5 && ['PASS', 'CROSS', 'SHOT'].includes(e.type));
                    if (e)
                        trail.moveTo(40 + e.x * 9.8, 40 + e.y * 6).lineTo(ball.x, ball.y).stroke({ color: e.type === 'SHOT' ? '#e6cd8b' : '#b6cda3', width: 2, alpha: .5 });
                }
            });
            setRendererReady(true);
        }).catch(() => { if (!cancelled) { try { native(); } catch (e) { setError(e instanceof Error ? e.message : '比赛画面加载失败'); } } });
        let previous = performance.now();
        let lastUI = 0;
        let pausedHalf = false;
        const tick = (now: number) => {
            const elapsed = Math.min((now - previous) / 1000, .12);
            previous = now;
            if (playingRef.current && metaRef.current) {
                const max = bufferedUntil(loaded.current, secondRef.current, metaRef.current.duration);
                if (secondRef.current < max) {
                    secondRef.current = Math.min(max, secondRef.current + elapsed * 18 * speedRef.current);
                }
                const halftime = allEvents.current.find(e => e.type === 'HALF_TIME');
                if (!pausedHalf && halftime && secondRef.current >= halftime.time && maxWatched.current < halftime.time) {
                    pausedHalf = true;
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
        return () => { cancelled = true; cancelAnimationFrame(raf); destroyNative?.(); app?.destroy(true, { children: true }); };
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
    return <section className="match-layout"><div className="match-main panel"><div className="match-top"><span className="eyebrow">完整比赛 · 第{match.season}季 / 第{match.round}轮</span><span className="verified"><ShieldCheck size={13}/>{solo ? '单人比赛录像' : '唯一官方录像'}</span></div><div className="scoreboard"><div><i style={{ background: home.color }}/>{home.short}</div><strong>{score[0]} <span>:</span> {score[1]}</strong><div>{away.short}<i style={{ background: away.color }}/></div></div><div className="match-clock">{clock(second)} <span>{second >= Number(meta?.duration) ? '全场结束' : half ? '中场休息' : playing ? '比赛进行中' : '待播放'}</span></div><div className="canvas-wrap"><div className="canvas-host" ref={canvasHost}/>{!rendererReady && <div className="canvas-loading" role="status">{error ? '球场画面暂时无法显示，请点击下方重试。' : <><LoaderCircle className="spin"/> {solo ? '正在载入球场与比赛录像…' : '正在载入球场与官方录像…'}</>}</div>}</div>{hover && <div className="pitch-hover">{hover}</div>}{trait && <div className="trait-callout">{trait.trait} <small>{trait.text}</small></div>}
 <div className="player-controls"><button className="icon-button" onClick={toggle} disabled={!rendererReady || !meta || second >= meta.duration} aria-label={playing ? '暂停' : '播放'}>{playing ? <Pause size={20}/> : <Play size={20}/>}</button><button className="icon-button" onClick={() => { secondRef.current = 0; setSecond(0); playingRef.current = false; setPlaying(false); void fetchChunk(0); }} aria-label="重新观看"><RotateCcw size={17}/></button><div className="play-progress"><i style={{ width: (meta ? second / meta.duration * 100 : 0) + '%' }}/></div><span className="mono">{clock(second)} / {clock(meta?.duration || 5400)}</span><select aria-label="播放倍速" value={speed} onChange={e => { setSpeed(Number(e.target.value)); speedRef.current = Number(e.target.value); }}>{[1, 2, 4].map(v => <option key={v} value={v}>{v}×</option>)}</select><button className="icon-button" aria-label="全屏" onClick={() => void canvasHost.current?.parentElement?.requestFullscreen()}><Maximize2 size={17}/></button></div>
 {solo && meta && second < meta.duration && <button className="quiet solo-skip" onClick={() => void skip()}>直接查看赛果 <ShieldCheck size={14}/></button>}
 <div className="match-bottom"><span>以18个比赛秒 / 秒播放，倍速只改变观看速度</span><span>已保存至 {clock(maxWatched.current)}</span></div>{error && <div className="error">{error} <button onClick={() => { setError(''); setReload(v => v + 1); }}>重试</button></div>}
 {half && <div className="halftime-overlay"><span className="eyebrow">HALF TIME</span><h3>喝口水，下半场见。</h3><p>{home.short} {score[0]} : {score[1]} {away.short}</p><p className="muted">已记录 {shownEvents.filter(e => e.type === 'SHOT').length} 次近期射门 · 场上平均体力 {f ? Math.round(f.p.reduce((n, p) => n + p[3], 0) / f.p.length) : '—'}</p><button className="primary" onClick={() => { setHalf(false); playingRef.current = true; setPlaying(true); }}>继续下半场 <Play size={15}/></button></div>}
 </div><aside className="match-aside"><div className="panel"><div className="section-label">场边记录<span className={playing ? 'live-dot' : ''}/></div><div className="event-log">{shownEvents.length ? shownEvents.map((e, i) => <div key={e.time + '-' + i} className={e.type === 'GOAL' ? 'goal-event' : ''}><time>{clock(e.time)}</time><span>{e.text}</span></div>) : <p className="muted">哨声响起后，故事就开始了。</p>}</div></div><div className="panel"><div className="section-label">比赛概览</div>{summaryStats ? (['possession', 'shots', 'onTarget', 'chances', 'passRate', 'tackles', 'fouls', 'offsides', 'yellow', 'red'] as const).map((key, i) => <div className="stat-row" key={key}><b>{summaryStats.home[key]}{key === 'possession' || key === 'passRate' ? '%' : ''}</b><span>{['控球', '射门', '射正', '关键机会', '传球成功', '抢断', '犯规', '越位', '黄牌', '红牌'][i]}</span><b>{summaryStats.away[key]}{key === 'possession' || key === 'passRate' ? '%' : ''}</b></div>) : <><p className="muted small">{home.tactic.attack} / {away.tactic.attack}</p><div className="stat-row"><b>{allEvents.current.filter(e => e.time <= second && e.type === 'SHOT' && e.side === 'home').length}</b><span>射门</span><b>{allEvents.current.filter(e => e.time <= second && e.type === 'SHOT' && e.side === 'away').length}</b></div><p className="small muted">{possessionFrames.length} 帧比赛已播放。完整统计将在终场后公开。</p></>}</div><div className="replay-stamp"><ShieldCheck size={20}/><div>{solo ? '你与电脑，一场球队故事。' : '两位教练，同一场比赛。'}<small>录像 {meta?.replay_hash?.slice(0, 12) || '正在生成'} · 永久保存</small></div></div></aside></section>;
}
