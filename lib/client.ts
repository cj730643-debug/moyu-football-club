import type { GameAction } from '../game/types.ts';
import { SOLO_USER } from '../game/solo.ts';
export interface Session {
    mode?: 'solo';
    access_token: string;
    refresh_token: string;
    expires_at: number;
    user: {
        id: string;
        user_metadata?: {
            username?: string;
        };
    };
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const storage = 'mfc.auth.v1';
export function currentSession(): Session | null { try {
    if (localStorage.getItem('mfc.mode') === 'menu') return null;
    if (localStorage.getItem('mfc.mode') === 'solo') return { mode: 'solo', access_token: '', refresh_token: '', expires_at: Number.MAX_SAFE_INTEGER,
        user: { id: SOLO_USER, user_metadata: { username: '午休教练' } } };
    return JSON.parse(localStorage.getItem(storage) || 'null');
}
catch {
    return null;
} }
export function saveSession(s: Session | null) { if (s)
    localStorage.setItem(storage, JSON.stringify(s));
else
    localStorage.removeItem(storage); localStorage.setItem('mfc.mode', 'online'); window.dispatchEvent(new Event('mfc-session')); }
async function auth(path: string, body: unknown) { if (!url || !key)
    throw new Error('请先配置 Supabase 环境变量'); const res = await fetch(url + '/auth/v1/' + path, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const data = await res.json(); if (!res.ok)
    throw new Error(data.msg || data.error_description || data.message || '登录失败'); if (data.access_token) {
    data.expires_at = Math.floor(Date.now() / 1000) + data.expires_in;
    saveSession(data);
} return data; }
async function usernameAuth(type: string, username: string, password: string): Promise<Session> {
    if (!url || !key) throw new Error('联机服务未配置，单人模式可以直接开始');
    const response = await fetch(url + '/functions/v1/mfc-game', { method: 'POST',
        headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, username, password }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || data.message || '登录失败');
    if (!data.access_token || !data.user?.id) throw new Error('登录未完成，请重试');
    data.expires_at = Math.floor(Date.now() / 1000) + data.expires_in;
    saveSession(data);
    return data;
}
export const login = (username: string, password: string) => username.includes('@')
    ? auth('token?grant_type=password', { email: username, password }) : usernameAuth('login_username', username, password);
export const signup = (username: string, password: string) => usernameAuth('register_username', username, password);
export function currentRoomKey() { return currentSession()?.mode === 'solo' ? 'mfc.solo.room' : 'mfc.current.room'; }
export async function enterSolo(name = '午休联队') {
    const { startSolo } = await import('./solo.ts');
    const room = await startSolo({ type: 'create', name, short: name.slice(0, 2) });
    localStorage.setItem('mfc.solo.room', room.id);
    localStorage.setItem('mfc.mode', 'solo');
    window.dispatchEvent(new Event('mfc-session'));
}
let refreshing: Promise<Session> | null = null;
export async function getSession() { const s = currentSession(); if (!s)
    throw new Error('请先登录'); if (s.expires_at < Date.now() / 1000 + 90) {
    if (!refreshing)
        refreshing = auth('token?grant_type=refresh_token', { refresh_token: s.refresh_token }).finally(() => { refreshing = null; });
    return refreshing;
} return s; }
export async function logout() { const s = currentSession(); if (s?.mode === 'solo') {
    localStorage.setItem('mfc.mode', 'menu'); window.dispatchEvent(new Event('mfc-session')); return;
} saveSession(null); if (s)
    await fetch(url + '/auth/v1/logout', { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + s.access_token } }).catch(() => { }); }
export async function api<T>(a: GameAction): Promise<T> { const s = await getSession();
    if (s.mode === 'solo') { const { soloAPI } = await import('./solo.ts'); return soloAPI<T>(a); }
    const res = await fetch(url + '/functions/v1/mfc-game', { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify(a) }); const data = await res.json(); if (!res.ok)
    throw new Error(data.error || data.message || '操作失败'); return data as T; }
export function watchRoom(roomId: string, onChange: () => void) {
    if (currentSession()?.mode === 'solo') {
        const focus = () => onChange();
        window.addEventListener('focus', focus);
        return () => window.removeEventListener('focus', focus);
    }
    let socket: WebSocket | null = null;
    let stopped = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    void getSession().then(s => { if (stopped)
        return; socket = new WebSocket(url.replace(/^http/, 'ws') + `/realtime/v1/websocket?apikey=${encodeURIComponent(key)}&vsn=1.0.0`); let ref = 1; socket.onopen = () => { socket!.send(JSON.stringify({ topic: 'realtime:mfc:' + roomId, event: 'phx_join', payload: { config: { broadcast: { self: false }, presence: { key: '' }, postgres_changes: [{ event: '*', schema: 'public', table: 'mfc_room_signal', filter: 'room_id=eq.' + roomId }] }, access_token: s.access_token }, ref: String(ref++) })); heartbeat = setInterval(() => { if (socket?.readyState === 1)
        socket.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(ref++) })); }, 25000); }; socket.onmessage = e => { try {
        const msg = JSON.parse(e.data);
        if (msg.event === 'postgres_changes')
            onChange();
    }
    catch { } }; }).catch(() => { });
    const fallback = setInterval(onChange, 12000);
    const focus = () => onChange();
    window.addEventListener('focus', focus);
    return () => { stopped = true; socket?.close(); if (heartbeat)
        clearInterval(heartbeat); clearInterval(fallback); window.removeEventListener('focus', focus); };
}
