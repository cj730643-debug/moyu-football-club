import { smoothPitchPoint, ballOwner, heldBallPoint, type PitchPoint } from '../game/replay.ts';
import { POSITIONS } from '../game/catalog.ts';
import { nickname } from '../game/players.ts';
import type { Club, Player, ReplayEvent, ReplayFrame } from '../game/types.ts';

export function mountReplayCanvas(host: HTMLDivElement, home: Club, away: Club, players: { home: Player[]; away: Player[] },
    current: () => { frame: ReplayFrame | null; second: number; events: ReplayEvent[] }, hover: (text: string) => void): () => void {
    const canvas = document.createElement('canvas');
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = 1060 * ratio; canvas.height = 680 * ratio;
    canvas.style.width = '100%'; canvas.style.height = 'auto';
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', '俯瞰足球场：球员平滑移动，头顶体力槽随比赛消耗');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('浏览器无法绘制比赛，请使用 Chrome 或 Edge');
    ctx.scale(ratio, ratio);
    host.replaceChildren(canvas);
    const roster = new Map<string, { p: Player; color: string; home: boolean }>([...players.home.map(p => [p.id, { p, color: home.color, home: true }] as const),
        ...players.away.map(p => [p.id, { p, color: away.color, home: false }] as const)]);
    let raf = 0, last = -1, hadFrame = false, previousTime = performance.now();
    const positions = new Map<string, PitchPoint>();
    let ball: PitchPoint | null = null;
    const field = () => {
        ctx.fillStyle = '#182b24'; ctx.fillRect(0, 0, 1060, 680);
        for (let i=0; i<10; i++) { ctx.fillStyle = i%2 ? '#1b3028' : '#1e352c'; ctx.fillRect(40+i*98,40,98,600); }
        ctx.strokeStyle = '#9ab3a188'; ctx.lineWidth = 1.5;
        ctx.strokeRect(40,40,980,600); ctx.beginPath(); ctx.moveTo(530,40); ctx.lineTo(530,640); ctx.stroke();
        ctx.beginPath(); ctx.arc(530,340,85,0,Math.PI*2); ctx.stroke();
        ctx.strokeRect(40,182,154,316); ctx.strokeRect(866,182,154,316);
        ctx.strokeRect(40,257,53,166); ctx.strokeRect(967,257,53,166);
        ctx.strokeStyle='#d4d9ce'; ctx.lineWidth=2; ctx.strokeRect(20,308,20,64); ctx.strokeRect(1020,308,20,64);
    };
    const paint = (now = performance.now()) => {
        const elapsed = Math.min(.1, Math.max(0, (now - previousTime) / 1000));
        previousTime = now;
        const { frame, second, events } = current();
        if (second !== last || last === -1 || !hadFrame && frame) {
            const reset = !hadFrame || second < last || Math.abs(second - last) > 10;
            if (reset) { positions.clear(); ball = null; }
            last = second; hadFrame = !!frame; field();
            if (frame) {
                for (const [id,x,y,fitness,removed] of frame.p) {
                    const entry = roster.get(id); if (!entry || removed) continue;
                    const target = { x: 40+x*9.8, y: 40+y*6 };
                    const previous = positions.get(id);
                    const point = previous ? smoothPitchPoint(previous, target, elapsed, 120) : target;
                    positions.set(id, point);
                    ctx.fillStyle=entry.color; ctx.strokeStyle='#101b15'; ctx.lineWidth=2;
                    ctx.beginPath(); ctx.arc(point.x,point.y,13,0,Math.PI*2); ctx.fill(); ctx.stroke();
                    ctx.fillStyle='#13221b'; ctx.font='700 12px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
                    ctx.fillText(nickname(entry.p)[0],point.x,point.y);
                    const stamina = Math.max(0, Math.min(100, fitness));
                    ctx.fillStyle = '#0a1510'; ctx.fillRect(point.x-16,point.y-24,32,6);
                    ctx.fillStyle = stamina > 60 ? '#a8d875' : stamina > 30 ? '#e0bd65' : '#e57c73';
                    ctx.fillRect(point.x-15,point.y-23,30*stamina/100,4);
                }
                const owner = ballOwner(frame);
                const ownerPoint = owner ? positions.get(owner) : null;
                const ownerEntry = owner ? roster.get(owner) : null;
                const rawBall = { x: 40 + frame.ball[0] * 9.8, y: 40 + frame.ball[1] * 6 };
                if (ownerPoint && ownerEntry) {
                    // Both pieces share one position. Independent smoothing made the ball float off the dribbler.
                    ball = heldBallPoint(ownerPoint, ownerEntry.home);
                } else {
                    ball = ball ? smoothPitchPoint(ball, rawBall, elapsed, 420) : rawBall;
                    const trail = events.findLast(e => e.time <= second && second-e.time < 3 && ['PASS','CROSS','SHOT'].includes(e.type));
                    const origin = trail?.player ? positions.get(trail.player) : null;
                    if (trail && origin) {
                        ctx.strokeStyle = trail.type==='SHOT' ? '#e6cd8b55' : '#b6cda333'; ctx.lineWidth=1;
                        ctx.beginPath(); ctx.moveTo(origin.x,origin.y); ctx.lineTo(ball.x,ball.y); ctx.stroke();
                    }
                }
                ctx.fillStyle='#f5f3e9'; ctx.strokeStyle='#0a1510'; ctx.lineWidth=1.4;
                ctx.beginPath(); ctx.arc(ball.x,ball.y,5,0,Math.PI*2); ctx.fill(); ctx.stroke();
            }
        }
        raf=requestAnimationFrame(paint);
    };
    const pointer = (event: PointerEvent) => {
        const frame = current().frame; if (!frame) return;
        const bounds = canvas.getBoundingClientRect();
        const x=(event.clientX-bounds.left)/bounds.width*1060, y=(event.clientY-bounds.top)/bounds.height*680;
        const dot=frame.p.find(p=>{ const point=positions.get(p[0]); return !p[4] && point && Math.hypot(x-point.x,y-point.y)<18; });
        const entry=dot && roster.get(dot[0]);
        hover(entry && dot ? `${nickname(entry.p)} · ${POSITIONS[entry.p.position].name} · 体力${dot[3]} · ${entry.p.traits.slice(0,2).join(' / ')}` : '');
        canvas.style.cursor = entry ? 'pointer' : 'default';
    };
    canvas.addEventListener('pointermove',pointer); canvas.addEventListener('pointerdown',pointer);
    canvas.addEventListener('pointerleave',()=>hover(''));
    paint();
    return () => { cancelAnimationFrame(raf); canvas.remove(); };
}
