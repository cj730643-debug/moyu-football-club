import { createRoom, applyAction, snakePicker } from '../game/state.ts';
export const A = '00000000-0000-4000-8000-000000000001', B = '00000000-0000-4000-8000-000000000002';
export function fixture(seed = 42) { let r = createRoom('00000000-0000-4000-8000-000000000042', 'MFC123', A, '甲教练', { type: 'create', name: '午休联队' }, seed); r.clubs[0].id = 'fixture-home'; r = applyAction(r, B, { type: 'join', name: '夜班联队' }, '乙教练'); r.clubs[1].id = 'fixture-away'; while (r.state === 'DRAFT') {
    const actor = r.clubs[snakePicker(r.draft.turn)].user_id;
    r = applyAction(r, actor, { type: 'pick', turn: r.draft.turn, player_id: r.draft.candidates[0].id, request_id: 'pick-' + r.draft.turn });
} return r; }
