export function scopeSeed(seed: number, scope: string): number { let h = seed >>> 0; for (const c of scope) {
    h = Math.imul(h ^ c.charCodeAt(0), 16777619);
} return h >>> 0; }
export function rng(seed: number) { let s = seed >>> 0; return () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function int(random: () => number, a: number, b: number) { return a + Math.floor(random() * (b - a + 1)); }
export const clamp = (n: number, a = 1, b = 100) => Math.max(a, Math.min(b, n));
