'use client';
import { useState } from 'react';
import { ArrowUpRight, CirclePlay, LoaderCircle, Sprout, Users } from 'lucide-react';
import { enterSolo, login, signup } from '../lib/client.ts';

export default function StartScreen({ onDone }: { onDone: () => void }) {
    const [online, setOnline] = useState(false), [register, setRegister] = useState(false);
    const [username, setUsername] = useState(''), [password, setPassword] = useState('');
    const [name, setName] = useState('午休联队'), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const start = async () => {
        setBusy(true); setError('');
        try { await enterSolo(name.trim() || '午休联队'); onDone(); }
        catch (e) { setError(e instanceof Error ? e.message : '无法打开存档'); }
        finally { setBusy(false); }
    };
    const submit = async (e: React.FormEvent) => {
        e.preventDefault(); setBusy(true); setError('');
        try { if (register) await signup(username, password); else await login(username, password); onDone(); }
        catch (e) { setError(e instanceof Error ? e.message : '登录失败'); }
        finally { setBusy(false); }
    };
    return <div className="auth-layout"><div className="auth-story">
        <span className="eyebrow">A SMALL CLUB. A LONG STORY.</span>
        <h1>把午休，<br/>变成主场<span>。</span></h1>
        <p>不认识球星也没关系。<br/>选好记的外号，慢慢养出自己的球队。</p>
        <div className="auth-pitch"><div className="pitch-circle"/><div className="pitch-midline"/>
            {(['闪', '教', '塔', '狐', '犬']).map((n, i) => <span key={n} style={{ left: [22,42,68,76,30][i]+'%', top: [38,62,32,70,77][i]+'%', background: i%2 ? '#87abb9' : '#a8c77a' }}>{n}</span>)}<i/>
        </div><div className="auth-features"><span><CirclePlay size={16}/> 单人直接开玩</span><span><Sprout size={16}/> 原创球员成长</span><span><Users size={16}/> 好友异步联机</span></div>
    </div><section className="auth-card panel">
        <div className="eyebrow">选择你的主场</div><h2>教练，球队在等你。</h2>
        <p className="muted">一个人也能开赛，电脑教练随时奉陪。</p>
        <div className="solo-entry"><div><CirclePlay size={24}/><span><b>单人模式</b><small>免注册 · 自动存档 · 可快速结算</small></span></div>
            <label>新球队名称<input aria-label="新单人球队名称" maxLength={24} value={name} onChange={e=>setName(e.target.value)} disabled={busy}/></label>
            <button className="primary wide" disabled={busy} onClick={()=>void start()}>{busy ? <LoaderCircle size={16} className="spin"/> : <CirclePlay size={16}/>} 开始 / 继续单人游戏 <ArrowUpRight size={16}/></button>
            <p className="small muted">已有存档会继续原来的球队。单人存档保存在当前浏览器。</p>
        </div><button className="quiet wide" disabled={busy} onClick={()=>{ setOnline(v=>!v); setError(''); }}><Users size={16}/>{online ? '收起好友联机' : '和朋友一起玩'}</button>
        {online && <div className="online-entry"><p className="small muted">只需用户名和密码，注册后立即进入。</p>
            <div className="auth-tabs"><button disabled={busy} className={!register?'active':''} onClick={()=>setRegister(false)}>登录</button><button disabled={busy} className={register?'active':''} onClick={()=>setRegister(true)}>注册</button></div>
            <form onSubmit={submit}><label>用户名<input required minLength={2} maxLength={register?20:100} autoComplete="username" placeholder="中文外号也可以" value={username} onChange={e=>setUsername(e.target.value)} disabled={busy}/></label>
                <label>密码<input type="password" required minLength={8} maxLength={128} autoComplete={register?'new-password':'current-password'} placeholder="至少8位" value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/></label>
                <button className="primary wide" disabled={busy}>{busy?<LoaderCircle size={16} className="spin"/>:register?'注册并进入':'进入好友联机'}<ArrowUpRight size={16}/></button>
            </form></div>}
        {error && <p className="error" role="alert">{error}</p>}
    </section></div>;
}
