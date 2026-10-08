import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createSoloRoom, respondComputer, SOLO_USER } from '../game/solo.ts';
import { applyAction } from '../game/state.ts';

const bundle = await build({
    stdin: { contents: `import { createRoot } from 'react-dom/client'; import { createElement } from 'react';
        import GameApp from './components/GameApp.tsx';
        export const mount = () => { const root=createRoot(document.getElementById('root'), {onUncaughtError:e=>globalThis.__errors.push(e)});
            root.render(createElement(GameApp)); return ()=>root.unmount(); };`,
        resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, platform: 'browser', format: 'iife', globalName: 'ClubUITest', target: 'es2022', jsx: 'automatic', write: false,
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'club-api', setup(b) {
        b.onResolve({filter:/lib\/client\.ts$/}, ()=>({path:'client', namespace:'test'}));
        b.onLoad({filter:/.*/, namespace:'test'}, ()=>({loader:'js', contents:`export const api = a=>globalThis.__api(a);
            export const currentSession=()=>({mode:'solo',user:{id:'${SOLO_USER}'}});
            export const enterSolo=async()=>{}; export const login=async()=>{}; export const signup=async()=>{}; export const currentRoomKey=()=>'room'; export const watchRoom=()=>()=>{}; export const logout=async()=>{};`}));
    } }],
});
const settle = async () => { for(let i=0;i<8;i++) await new Promise(r=>setTimeout(r,0)); };
async function setup({draft=false, ready=false}={}) {
    let room=createSoloRoom({type:'create',name:'按钮测试',short:'测试'}, 42);
    if(!draft) while(room.state==='DRAFT') {
        const a={type:'pick',turn:room.draft.turn,player_id:room.draft.candidates[0].id};
        room=respondComputer(applyAction(room,SOLO_USER,a,'教练'),a);
    }
    if(!draft) { room.clubs[0].ready=true; if(!ready) room.active_match='current-match'; }
    const calls=[], errors=[];
    const vc=new VirtualConsole(); vc.on('jsdomError',e=>errors.push(e));
    const dom=new JSDOM('<div id="root"></div>',{url:'https://game.test/',runScripts:'outside-only',virtualConsole:vc});
    const w=dom.window; w.localStorage.setItem('room',room.id); w.__errors=errors;
    w.__api=async a=>{
        calls.push(a);
        if(a.type==='list') return {username:'教练',rooms:[]};
        if(a.type==='solo_skip') return {result:[1,0]};
        if(a.type==='settle'||a.type==='cancel_ready') { room.active_match=null; room.clubs.forEach(c=>c.ready=false); room.revision++; }
        if(a.type==='tactics') { room.clubs[0].tactic=a.tactic; room.revision++; }
        return {room:structuredClone(room)};
    };
    w.eval(bundle.outputFiles[0].text); const unmount=w.ClubUITest.mount(); await settle();
    const click=async text=> { const buttons=[...w.document.querySelectorAll('button')];
        const button=buttons.find(b=>b.textContent.trim()===text); assert.ok(button,`Missing ${text}`); assert.equal(button.disabled,false,`${text} disabled`);
        button.dispatchEvent(new w.MouseEvent('click',{bubbles:true})); await settle(); };
    return {w,calls,errors,click,close:()=>{unmount();w.close();}};
}
test('locked lineup explains why and solo settlement unlocks tactics for the next match',async()=>{
    const h=await setup(); try {
        await h.click('阵容与战术');
        assert.match(h.w.document.querySelector('.lineup-lock').textContent,/本场比赛已开始/);
        await h.click('结算本场后调整');
        assert.deepEqual(h.calls.filter(a=>['solo_skip','settle'].includes(a.type)).map(a=>a.type),['solo_skip','settle']);
        assert.equal(h.w.document.querySelector('.lineup-lock'),null);
        await h.click('边路进攻');
        assert.ok(h.calls.some(a=>a.type==='tactics'&&a.tactic.attack==='边路进攻'));
        assert.deepEqual(h.errors.map(e=>e.message),[]);
    } finally {h.close();}
});
test('confirmed preparation has a visible cancel action and restores lineup controls',async()=>{
    const h=await setup({ready:true}); try {
        await h.click('阵容与战术'); await h.click('取消准备，继续调整');
        assert.equal(h.w.document.querySelector('.lineup-lock'),null); await h.click('自动排阵');
        assert.ok(h.calls.some(a=>a.type==='lineup')); assert.deepEqual(h.errors.map(e=>e.message),[]);
    } finally {h.close();}
});
test('draft navigation responds and settings can open before the team is complete',async()=>{
    const h=await setup({draft:true}); try {
        await h.click('球员名单'); assert.match(h.w.document.querySelector('main').textContent,/先选满6名核心球员/);
        await h.click('继续选人建队'); assert.ok(h.w.document.querySelector('.draft-cards'));
        await h.click('帮助与设置'); assert.ok(h.w.document.querySelector('.help-grid'));
        assert.deepEqual(h.errors.map(e=>e.message),[]);
    } finally {h.close();}
});
