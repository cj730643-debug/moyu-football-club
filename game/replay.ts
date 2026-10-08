import type { ReplayEvent, ReplayFrame } from './types.ts';
/** A restored late chunk must never make a missing earlier chunk look playable. */
export function bufferedUntil(chunks: ReadonlySet<number>, second: number, duration: number) {
    let index = Math.floor(second / 60);
    if (!chunks.has(index))
        return second;
    while (chunks.has(index))
        index++;
    return Math.min(duration, index * 60 - 1);
}
export function scoreAt(events: ReplayEvent[], second: number): [
    number,
    number
] { return [events.filter(e => e.type === 'GOAL' && e.side === 'home' && e.time <= second).length, events.filter(e => e.type === 'GOAL' && e.side === 'away' && e.time <= second).length]; }
export function frameAt(frames: ReplayFrame[], second: number): ReplayFrame | null { if (!frames.length)
    return null; let lo = 0, hi = frames.length - 1; while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (frames[mid].t <= second)
        lo = mid;
    else
        hi = mid - 1;
} const a = frames[lo], b = frames[lo + 1]; if (!b || b.t === a.t)
    return a; const f = Math.max(0, Math.min(1, (second - a.t) / (b.t - a.t))); return { t: second, phase: a.phase, ball: [a.ball[0] + (b.ball[0] - a.ball[0]) * f, a.ball[1] + (b.ball[1] - a.ball[1]) * f], p: a.p.map(p => { const q = b.p.find(q => q[0] === p[0]); if (!q)
        return p; return [p[0], p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f, p[3], p[4]]; }) }; }
export const clock = (second: number) => `${Math.floor(second / 60).toString().padStart(2, '0')}:${Math.floor(second % 60).toString().padStart(2, '0')}`;
