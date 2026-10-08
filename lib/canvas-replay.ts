import { POSITIONS } from '../game/catalog.ts';
import { nickname } from '../game/players.ts';
import type { Club, Player, ReplayEvent, ReplayFrame } from '../game/types.ts';

export function mountReplayCanvas(host: HTMLDivElement, home: Club, away: Club, players: { home: Player[]; away: Player[] },
    current: () => { frame: ReplayFrame | null; second: number; events: ReplayEvent[] }, hover: (text: string) => void): () => void {
    const canvas = document.createElement('canvas');
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = 1060 * ratio; canvas.height = 680 * ratio;
    canvas.style.width = '100%'; canvas.style.height = 'auto';
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', '俯瞰足球场：球员和足球按比赛录像运动');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('浏览器无法绘制比赛，请使用 Chrome 或 Edge');
    ctx.scale(ratio, ratio);
    host.replaceChildren(canvas);
    const roster = new Map([...players.home.map(p => [p.id, { p, color: home.color }] as const),
        ...players.away.map(p => [p.id, { p, color: away.color }] as const)]);
    let raf = 0, last = -1, hadFrame = false;
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
    const paint = () => {
        const { frame, second, events } = current();
        if (second !== last || last === -1 || !hadFrame && frame) {
            last = second; hadFrame = !!frame; field();
            if (frame) {
                const trail = events.findLast(e=>e.time<=second && second-e.time<1.5 && ['PASS','CROSS','SHOT'].includes(e.type));
                if (trail) { ctx.strokeStyle = trail.type==='SHOT'?'#e6cd8b99':'#b6cda399'; ctx.beginPath(); ctx.moveTo(40+trail.x*9.8,40+trail.y*6); ctx.lineTo(40+frame.ball[0]*9.8,40+frame.ball[1]*6); ctx.stroke(); }
                for (const [id,x,y,_fitness,removed] of frame.p) {
                    const entry = roster.get(id); if (!entry || removed) continue;
                    ctx.fillStyle=entry.color; ctx.strokeStyle='#101b15'; ctx.lineWidth=2;
                    ctx.beginPath(); ctx.arc(40+x*9.8,40+y*6,13,0,Math.PI*2); ctx.fill(); ctx.stroke();
                    ctx.fillStyle='#13221b'; ctx.font='700 12px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
                    ctx.fillText(nickname(entry.p)[0],40+x*9.8,40+y*6);
                }
                ctx.fillStyle='#f5f3e9'; ctx.strokeStyle='#0a1510'; ctx.lineWidth=1.4;
                ctx.beginPath(); ctx.arc(40+frame.ball[0]*9.8,40+frame.ball[1]*6,5,0,Math.PI*2); ctx.fill(); ctx.stroke();
            }
        }
        raf=requestAnimationFrame(paint);
    };
    const pointer = (event: PointerEvent) => {
        const frame = current().frame; if (!frame) return;
        const bounds = canvas.getBoundingClientRect();
        const x=(event.clientX-bounds.left)/bounds.width*1060, y=(event.clientY-bounds.top)/bounds.height*680;
        const dot=frame.p.find(p=>!p[4] && Math.hypot(x-(40+p[1]*9.8),y-(40+p[2]*6))<18);
        const entry=dot && roster.get(dot[0]);
        hover(entry && dot ? `${nickname(entry.p)} · ${POSITIONS[entry.p.position].name} · 体力${dot[3]} · ${entry.p.traits.slice(0,2).join(' / ')}` : '');
        canvas.style.cursor = entry ? 'pointer' : 'default';
    };
    canvas.addEventListener('pointermove',pointer); canvas.addEventListener('pointerdown',pointer);
    canvas.addEventListener('pointerleave',()=>hover(''));
    paint();
    return () => { cancelAnimationFrame(raf); canvas.remove(); };
}
