import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Replay, Room, GameAction } from '../game/types.ts';
import { COMPUTER_USER, computerChoice, createSoloRoom, SOLO_USER } from '../game/solo.ts';
import { SoloCampaign, validateSoloArchive } from '../lib/solo.ts';
import type { SoloStore } from '../lib/solo-store.ts';
import { accountAddress, accountName, accountPassword } from '../game/account.ts';

class MemoryStore implements SoloStore {
    room: Room | null = null;
    replays = new Map<string, Replay>();
    fail = false;
    async loadRoom() { return structuredClone(this.room); }
    async loadReplay(id: string) { return structuredClone(this.replays.get(id) || null); }
    async saveRoom(room: Room, replay?: Replay, revision?: number) {
        if (this.fail) throw new Error('disk full');
        if (revision !== undefined) assert.equal(this.room?.revision, revision);
        this.room = structuredClone(room);
        if (replay) this.replays.set(replay.match_id, structuredClone(replay));
    }
    async allReplays() { return structuredClone([...this.replays.values()]); }
    async replace(room: Room, replays: Replay[]) { this.room=structuredClone(room); this.replays=new Map(structuredClone(replays).map(r=>[r.match_id,r])); }
}
const command = (room: Room, type: string, fields: Record<string, unknown> = {}): GameAction => ({ type, room_id: room.id,
    round: room.current_round, season: room.current_season, request_id: crypto.randomUUID(), ...fields });
async function action(game: SoloCampaign, room: Room, type: string, fields: Record<string,unknown> = {}) {
    return (await game.api<{room:Room}>(command(room,type,fields))).room;
}
async function finishDraft(game: SoloCampaign, start: Room) {
    let room=start;
    while(room.state==='DRAFT') {
        assert.equal(room.clubs[Math.floor(room.draft.turn/2)%2===0 ? room.draft.turn%2 : 1-room.draft.turn%2].user_id,SOLO_USER);
        room=await action(game,room,'pick',{turn:room.draft.turn,player_id:room.draft.candidates[0].id});
    }
    return room;
}

test('usernames accept Chinese and normalize width, spaces and letter case without taking an email',async()=>{
    assert.deepEqual(accountName('  ＡＢc_教练  '),{display:'ABc_教练',key:'abc_教练'});
    assert.deepEqual(accountName('摸鱼'),{display:'摸鱼',key:'摸鱼'});
    for(const value of ['','a','someone@example.com','名字 空格','😀😀',{},'x'.repeat(21)]) assert.throws(()=>accountName(value));
    assert.throws(()=>accountPassword('1234567')); assert.equal(accountPassword('12345678'),'12345678');
    assert.equal(await accountAddress(accountName('Morning').key),await accountAddress(accountName('ＭＯＲＮＩＮＧ').key));
    assert.notEqual(await accountAddress('morning'),await accountAddress('evening'));
});

test('computer decisions ignore private potential and personality',()=>{
    const room=createSoloRoom({type:'create'},42);
    const before=computerChoice(room.draft.candidates).id;
    room.draft.candidates.forEach(p=>{p.h!.true_potential=100-p.h!.true_potential;p.h!.professionalism=1;p.h!.consistency=99;});
    assert.equal(computerChoice(room.draft.candidates).id,before);
});

test('single-player finishes ten real matches, survives reloads, signs youth and starts season two',async()=>{
    const store=new MemoryStore(); let game=new SoloCampaign(store);
    let room=await game.start({type:'create',name:'独自摸鱼',short:'摸鱼'});
    const id=room.id;
    room=await action(game,room,'pick',{turn:room.draft.turn,player_id:room.draft.candidates[1].id});
    assert.equal(room.draft.turn,3);
    game=new SoloCampaign(store);
    assert.equal((await game.start()).id,id);
    room=await finishDraft(game,await game.start());
    assert.deepEqual(room.clubs.map(c=>c.players.length),[18,18]);
    assert.equal(room.clubs[1].user_id,COMPUTER_USER);
    assert.ok(!JSON.stringify(room).includes('true_potential'));
    let firstHash=''; let frameCount=0;
    for(let round=1;round<=10;round++) {
        room=await action(game,room,'ready');
        const m=room.matches.at(-1)!;
        assert.equal(m.round,round); assert.ok(m.result_locked); assert.equal(m.score,null);
        const replay=await store.loadReplay(m.id); assert.ok(replay); assert.ok(replay.duration>=5400); frameCount+=replay.frames.length;
        const readyRevision=room.revision;
        game=new SoloCampaign(store);
        room=(await game.api<{room:Room}>({type:'get',room_id:id})).room;
        assert.equal(room.revision,readyRevision); assert.equal(room.matches.at(-1)!.replay_hash,replay.replay_hash);
        if(round===1) {
            firstHash=replay.replay_hash;
            await game.api({type:'progress',room_id:id,match_id:m.id,second:100,chunk:1});
            await game.api({type:'progress',room_id:id,match_id:m.id,second:50,chunk:0});
            const meta=await game.api<{last_viewed_second:number,result:null}>({type:'replay',room_id:id,match_id:m.id,chunk:1});
            assert.equal(meta.last_viewed_second,100); assert.equal(meta.result,null);
            await assert.rejects(game.api({type:'progress',room_id:id,match_id:m.id,second:1000,chunk:-1}));
            assert.equal((await store.loadRoom())!.view[m.id][SOLO_USER],100);
        }
        const done=await game.api<{result:number[]}>({type:'solo_skip',room_id:id,match_id:m.id});
        assert.deepEqual(done.result,replay.result);
        room=await action(game,room,'settle',{match_id:m.id});
        const settledRevision=room.revision;
        room=await action(game,room,'settle',{match_id:m.id});
        assert.equal(room.matches.filter(m=>m.state==='FINISHED').length,round);
        assert.equal(room.clubs[0].wins+room.clubs[0].draws+room.clubs[0].losses,round);
        assert.ok(room.revision>=settledRevision);
    }
    assert.equal(room.state,'OFFSEASON'); assert.equal(room.champions.length,1);
    assert.equal(room.clubs[0].youth.length,3); assert.equal(room.clubs[1].players.length,19);
    assert.equal(room.clubs[1].offseason_ready,true); assert.ok(frameCount>54000);
    const youth=room.clubs[0].youth[0].id;
    room=await action(game,room,'youth_sign',{player_id:youth});
    const archive=await game.export();
    const restored=new SoloCampaign(new MemoryStore());
    await restored.import(JSON.parse(JSON.stringify(archive)));
    const again=await restored.export();
    assert.equal(again.replays[0].replay_hash,firstHash); assert.equal(again.room.id,id);
    room=await action(restored,room,'next_season');
    assert.equal(room.current_season,2); assert.equal(room.current_round,1); assert.equal(room.state,'SEASON');
    assert.equal(room.clubs[0].players.find(p=>p.id===youth)!.career.seasons,1);
    room=await action(restored,room,'ready');
    assert.equal(room.matches.length,11); assert.equal(room.matches[0].replay_hash,firstHash);
    const corrupted=structuredClone(archive); corrupted.replays[0].result[0]++;
    await assert.rejects(validateSoloArchive(corrupted),/损坏/);
    const online=structuredClone(archive); online.mode='online' as 'solo';
    await assert.rejects(validateSoloArchive(online),/单人存档/);
});

test('a failed save leaves the previous draft recoverable and stale room IDs cannot alter it',async()=>{
    const store=new MemoryStore(); const game=new SoloCampaign(store); const room=await game.start();
    store.fail=true;
    await assert.rejects(action(game,room,'pick',{turn:0,player_id:room.draft.candidates[0].id}),/disk full/);
    store.fail=false;
    assert.equal((await game.start()).draft.turn,0);
    await assert.rejects(game.api({type:'pick',room_id:'different-room',turn:0,player_id:room.draft.candidates[0].id}),/存档已切换/);
});
