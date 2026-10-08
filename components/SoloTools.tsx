'use client';
import { useState } from 'react';
import { Download, Upload, LoaderCircle } from 'lucide-react';
import { exportSolo, importSolo, validateSoloArchive } from '../lib/solo.ts';
import type { SoloArchive } from '../lib/solo.ts';

export default function SoloTools({ onImported }: { onImported: (id: string) => void }) {
    const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
    const [pending, setPending] = useState<SoloArchive | null>(null);
    const download = async () => {
        setBusy(true); setMessage('');
        try {
            const save = await exportSolo();
            const blob = new Blob([JSON.stringify(save)], { type: 'application/json' });
            const url = URL.createObjectURL(blob), link = document.createElement('a');
            link.href = url; link.download = `moyu-football-s${save.room.current_season}.json`;
            document.body.appendChild(link); link.click(); link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
            setMessage('存档已导出，包含球队、成长记录和全部比赛录像。');
        } catch (e) { setMessage(e instanceof Error ? e.message : '导出失败'); }
        finally { setBusy(false); }
    };
    const choose = async (file?: File) => {
        if (!file) return;
        setBusy(true); setMessage(''); setPending(null);
        try {
            if (file.size > 200 * 1024 * 1024) throw new Error('存档文件过大，请使用较早的备份');
            setPending(await validateSoloArchive(JSON.parse(await file.text())));
        } catch (e) { setMessage(e instanceof Error ? e.message : '存档读取失败'); }
        finally { setBusy(false); }
    };
    const load = async () => {
        if (!pending) return;
        setBusy(true); setMessage('');
        try { const room = await importSolo(pending); setPending(null); onImported(room.id); setMessage('存档已载入。'); }
        catch (e) { setMessage(e instanceof Error ? e.message : '导入失败'); }
        finally { setBusy(false); }
    };
    return <section className="panel solo-tools"><h3>单人存档</h3><p className="muted">每次操作自动保存。换设备或换浏览器时，导出文件再导入即可继续。</p>
        <div className="solo-tools-actions"><button className="quiet" disabled={busy} onClick={()=>void download()}><Download size={16}/>导出存档</button>
            <label className="quiet file-label"><Upload size={16}/>选择存档<input type="file" accept=".json,application/json" disabled={busy} onChange={e=>{ void choose(e.target.files?.[0]); e.target.value=''; }}/></label>
            {busy && <LoaderCircle size={16} className="spin"/>}</div>
        {pending && <div className="import-confirm"><p>将载入「{pending.room.clubs[0].name}」第{pending.room.current_season}季、第{pending.room.current_round}轮，替换当前单人存档。</p>
            <button className="primary" disabled={busy} onClick={()=>void load()}>确认载入</button><button className="quiet" disabled={busy} onClick={()=>setPending(null)}>取消</button></div>}
        {message && <p className="small" role="status">{message}</p>}
    </section>;
}
