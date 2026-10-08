import { test } from 'node:test';
import assert from 'node:assert/strict';
import Engine from '../vendor/football-simulator/RealTimeEngine.ts';
import type { RealTimeMatchEvent } from '../vendor/football-simulator/RealTimeEngine.ts';
import Team from '../vendor/football-simulator/Team.ts';
import { Position } from '../vendor/football-simulator/enums/Position.ts';
import { adaptPlayer } from '../game/match.ts';
import { rng } from '../game/random.ts';
import { fixture } from './fixture.ts';

function contested(roll: number, homeSkill = 10, awaySkill = 10, awayDistance = 0) {
    const clubs = fixture().clubs;
    const teams = clubs.map((c, side) => new Team(side === 0, c.name, c.lineup.map((id, n) =>
        adaptPlayer(c.players.find(p => p.id === id)!, n === 0 ? Position.GK : Position.ST, n + 1, rng(n + 1)))));
    const engine = new Engine(teams[0], teams[1], { random: () => roll, tickSeconds: 1 });
    engine.start();
    engine.state.players.forEach(p => { p.x = 10; p.y = 10; });
    const home = engine.state.players.find(p => p.side === 'home' && p.role !== Position.GK)!;
    const away = engine.state.players.find(p => p.side === 'away' && p.role !== Position.GK)!;
    for (const [p, skill] of [[home, homeSkill], [away, awaySkill]] as const) {
        p.x = 50; p.y = 34;
        p.attributes.anticipation = p.attributes.firstTouch = p.attributes.acceleration = skill;
    }
    away.x += awayDistance;
    engine.state.ball.x = 50; engine.state.ball.y = 34; engine.state.ball.owner = null;
    engine.state.activeBallAction = null;
    const events = (engine as unknown as { detectLooseBallRecovery(): RealTimeMatchEvent[] }).detectLooseBallRecovery();
    return events[0]?.teamSide;
}
test('equal-distance recovery gives either side possession across uniform deterministic rolls', () => {
    const recovered = Array.from({ length: 32 }, (_, i) => contested((i + .5) / 32));
    assert.equal(recovered.filter(side => side === 'home').length, 16);
    assert.equal(recovered.filter(side => side === 'away').length, 16);
});
test('anticipation, first touch and acceleration improve contested recovery on either side', () => {
    assert.equal(contested(.6, 20, 5), 'home');
    assert.equal(contested(.6, 5, 20), 'away');
    assert.equal(contested(.6, 5, 20), contested(.6, 5, 20));
});
test('a closer arrival keeps possession ahead of a stronger but later player', () => {
    assert.equal(contested(.99, 5, 20, .1), 'home');
});
