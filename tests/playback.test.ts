import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceReplay, playbackSecond, smoothPitchPoint } from '../game/replay.ts';

test('regulation and added-time recordings both last six viewing minutes, with equal halves', () => {
    for (const duration of [5400, 5597, 5823]) {
        let time = 0;
        for (let i=0; i<1800; i++) time = advanceReplay(time, .1, duration);
        assert.ok(Math.abs(playbackSecond(time, duration)-180)<1e-8);
        for (let i=0; i<1800; i++) time = advanceReplay(time, .1, duration);
        assert.ok(Math.abs(playbackSecond(time, duration)-360)<1e-8);
        assert.equal(advanceReplay(duration-1, 1, duration), duration);
    }
});

test('large recorded position changes move at a bounded visual speed instead of teleporting', () => {
    const start = { x: 100, y: 100 }, target = { x: 900, y: 500 };
    const next = smoothPitchPoint(start, target, 1/60, 120);
    assert.ok(Math.hypot(next.x-start.x,next.y-start.y) <= 2.000001);
    assert.ok(next.x > start.x && next.y > start.y);
    assert.deepEqual(smoothPitchPoint(start, target, 0, 120), start);
    assert.deepEqual(smoothPitchPoint(start, start, 1/60, 120), start);
});

test('owned balls stay attached and explicit loose balls are never assigned to nearby players', async () => {
    const { ballOwner, heldBallPoint, frameAt } = await import('../game/replay.ts');
    const players: import('../game/types.ts').ReplayFrame['p'] = [['owner', 30, 40, 90, 0], ['other', 80, 80, 90, 0]];
    const base = { t: 0, phase: 'open_play', p: players, ball: [30, 40] as [number,number] };
    assert.equal(ballOwner({...base, owner: 'owner'}), 'owner');
    assert.equal(ballOwner({...base, owner: null}), null);
    assert.equal(ballOwner(base), 'owner');
    assert.equal(ballOwner({...base, ball: [50,50]}), null);
    assert.equal(ballOwner({...base, owner: 'missing'}), null);
    const held = heldBallPoint({x:100,y:200}, true);
    assert.ok(Math.hypot(held.x-100,held.y-200) < 15);
    assert.deepEqual(heldBallPoint({x:100,y:200},false),{x:90,y:210});
    const frame = frameAt([{...base,owner:'owner'}, {...base,t:1,owner:null,ball:[60,40]}], .5)!;
    assert.equal(ballOwner(frame),'owner');
    assert.equal(ballOwner(frameAt([{...base,owner:'owner'}, {...base,t:1,owner:null,ball:[60,40]}],1)!),null);
});

test('possession transfers stay continuous and bad or off-pitch coordinates remain visible', async () => {
    const {flightBallPoint,visibleBallPoint}=await import('../game/replay.ts');
    const previous={x:100,y:200},target={x:900,y:600};
    const next=flightBallPoint(previous,target,1/60);
    assert.ok(Math.hypot(next.x-previous.x,next.y-previous.y)<=7.000001);
    assert.deepEqual(flightBallPoint(previous,target,0),previous);
    assert.deepEqual(visibleBallPoint({x:NaN,y:Infinity},previous),previous);
    assert.deepEqual(visibleBallPoint({x:-100,y:800},previous),{x:25,y:655});
});
