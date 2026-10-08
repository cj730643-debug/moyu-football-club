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
