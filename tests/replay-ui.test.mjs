import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createSoloRoom, respondComputer, SOLO_USER } from '../game/solo.ts';
import { applyAction } from '../game/state.ts';

// Exercise the real React commit and Canvas mount, where renderer-only tests
// cannot detect a loading node being removed twice.
const bundle = await build({
    stdin: {
        contents: `import { createRoot } from 'react-dom/client';
            import { createElement } from 'react';
            import MatchPlayer from './components/MatchPlayer.tsx';
            export function mount(props) {
                const root = createRoot(document.getElementById('root'), {
                    onUncaughtError: error => globalThis.__replayErrors.push(error)
                });
                root.render(createElement(MatchPlayer, props));
                return () => root.unmount();
            }`,
        resolveDir: process.cwd(), loader: 'tsx',
    },
    bundle: true, platform: 'browser', format: 'iife', globalName: 'ReplayUITest',
    target: 'es2022', jsx: 'automatic', write: false,
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'replay-api', setup(builder) {
        builder.onResolve({ filter: /lib\/client\.ts$/ }, () => ({ path: 'replay-api', namespace: 'test' }));
        builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
            contents: 'export const api = action => globalThis.__replayAPI(action);', loader: 'js',
        }));
    } }],
});

function fixture(resume = 0) {
    let room = createSoloRoom({ type: 'create', name: '回放回归', short: '回归' }, 42);
    while (room.state === 'DRAFT') {
        const action = { type: 'pick', turn: room.draft.turn, player_id: room.draft.candidates[0].id };
        room = respondComputer(applyAction(room, SOLO_USER, action, '教练'), action);
    }
    const home = room.clubs[0], away = room.clubs[1];
    const lineups = { home: home.lineup.map(id => home.players.find(p => p.id === id)),
        away: away.lineup.map(id => away.players.find(p => p.id === id)) };
    const players = [...lineups.home, ...lineups.away];
    const frame = t => ({ t, phase: 'PLAY', ball: [50 + t % 8, 50],
        p: players.map((p, i) => [p.id, 20 + i * 2, 25 + i, 90, false]) });
    const meta = { duration: 5400, last_viewed_second: resume, lineups,
        tactics: { home: home.tactic, away: away.tactic },
        replay_hash: 'same-locked-replay', engine_version: 'test', result: null,
        stats: null, team_stats: null };
    return { room, home, away, frame, meta, match: { id: 'match-ui', season: 1, round: 1,
        home: home.id, away: away.id, state: 'GENERATED', result_locked: true, duration: 5400 } };
}

async function settleDOM() {
    for (let i = 0; i < 8; i++) await new Promise(resolve => setTimeout(resolve, 0));
}

async function setup({ solo = true, resume = 0, canvasFails = false } = {}) {
    const errors = [], calls = [], draws = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => errors.push(error));
    const dom = new JSDOM('<!doctype html><div id="root"></div>', {
        url: 'https://game.test/', runScripts: 'outside-only', virtualConsole,
    });
    const w = dom.window;
    const rafs = new Map(); let rafID = 0, now = 0;
    w.requestAnimationFrame = callback => { rafs.set(++rafID, callback); return rafID; };
    w.cancelAnimationFrame = id => rafs.delete(id);
    Object.defineProperty(w.performance, 'now', { value: () => now });
    let drawingUnavailable = canvasFails;
    w.HTMLCanvasElement.prototype.getContext = () => drawingUnavailable ? null : new Proxy({}, {
        get: (_target, method) => (...args) => draws.push([method, ...args]),
        set: () => true,
    });
    if (!solo) {
        const append = w.document.head.appendChild.bind(w.document.head);
        w.document.head.appendChild = child => {
            const result = append(child);
            if (child.tagName === 'SCRIPT') w.queueMicrotask(() => child.dispatchEvent(new w.Event('error')));
            return result;
        };
    }
    const f = fixture(resume); let finished = 0;
    w.__replayErrors = errors;
    w.__replayAPI = async action => {
        calls.push(action);
        const chunk = action.chunk || 0;
        return { ...f.meta, frames: [f.frame(chunk * 60), f.frame(Math.min(5400, chunk * 60 + 59))], events: [],
            ...(action.type === 'solo_skip' ? { last_viewed_second: 5400, result: [1, 0], frames: [f.frame(5400)] } : {}) };
    };
    w.eval(bundle.outputFiles[0].text);
    const unmount = w.ReplayUITest.mount({ solo, match: f.match, home: f.home, away: f.away,
        roomId: f.room.id, onFinished: () => { finished++; } });
    await settleDOM();
    const click = async selector => {
        const button = w.document.querySelector(selector);
        assert.ok(button, `Missing button: ${selector}`);
        button.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
        await settleDOM();
    };
    return { w, errors, calls, draws, click, finished: () => finished, enableCanvas: () => { drawingUnavailable = false; },
        advance: async ms => { now += ms; const pending = [...rafs]; rafs.clear(); pending.forEach(([, callback]) => callback(now)); await settleDOM(); },
        close: () => { unmount(); dom.window.close(); } };
}

test('single-player pitch mounts, plays, pauses and reveals the stored result without removing the React screen', async () => {
    const h = await setup();
    try {
        assert.deepEqual(h.errors.map(error => error.message), []);
        assert.ok(h.w.document.querySelector('canvas'));
        assert.equal(h.w.document.querySelector('.canvas-loading'), null);
        assert.ok(h.draws.some(([method]) => method === 'strokeRect'));
        await h.click('[aria-label="播放"]');
        await h.advance(150); await h.advance(150);
        const played = h.w.document.querySelector('.match-clock').textContent;
        assert.match(played, /00:04/);
        await h.click('[aria-label="暂停"]'); await h.advance(150);
        assert.equal(h.w.document.querySelector('.match-clock').textContent.replace('待播放', '比赛进行中'), played);
        await h.click('.solo-skip');
        assert.equal(h.finished(), 1);
        assert.match(h.w.document.querySelector('.scoreboard').textContent, /1\s*:\s*0/);
        assert.match(h.w.document.querySelector('.match-clock').textContent, /全场结束/);
        assert.deepEqual(h.errors.map(error => error.message), []);
    } finally { h.close(); }
});

test('a restored single-player match opens at its saved minute and can be replayed from kickoff', async () => {
    const h = await setup({ resume: 122 });
    try {
        assert.deepEqual(h.errors.map(error => error.message), []);
        assert.match(h.w.document.querySelector('.match-clock').textContent, /02:02/);
        assert.ok(h.calls.some(action => action.type === 'replay' && action.chunk === 2));
        await h.click('[aria-label="重新观看"]');
        assert.match(h.w.document.querySelector('.match-clock').textContent, /00:00/);
        assert.ok(h.w.document.querySelector('canvas'));
    } finally { h.close(); }
});

test('online replay falls back to Canvas when the remote renderer cannot load, keeping the controls visible', async () => {
    const h = await setup({ solo: false });
    try {
        assert.deepEqual(h.errors.map(error => error.message), []);
        assert.ok(h.w.document.querySelector('canvas'));
        assert.equal(h.w.document.querySelector('.canvas-loading'), null);
        assert.ok(h.w.document.querySelector('[aria-label="播放"]'));
        assert.equal(h.w.document.querySelector('.solo-skip'), null);
    } finally { h.close(); }
});

test('an unavailable Canvas leaves the score and a retry action visible instead of clearing the screen', async () => {
    const h = await setup({ canvasFails: true });
    try {
        assert.deepEqual(h.errors.map(error => error.message), []);
        assert.ok(h.w.document.querySelector('.scoreboard'));
        assert.match(h.w.document.querySelector('.error').textContent, /浏览器无法绘制/);
        h.enableCanvas();
        await h.click('.error button');
        assert.ok(h.w.document.querySelector('canvas'));
        assert.equal(h.w.document.querySelector('.error'), null);
        assert.deepEqual(h.errors.map(error => error.message), []);
    } finally { h.close(); }
});
