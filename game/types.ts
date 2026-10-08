export type Position = 'GK' | 'CB' | 'FB' | 'DM' | 'CM' | 'AM' | 'W' | 'ST';
export type Formation = '4-3-3' | '4-4-2' | '4-2-3-1' | '3-5-2';
export type Attrs = [
    number,
    number,
    number,
    number,
    number,
    number,
    number
];
export type TraitKind = 'style' | 'personality' | 'body' | 'legend';
export interface TraitDef {
    id: string;
    name: string;
    kind: TraitKind;
    color: 'white' | 'blue' | 'purple' | 'gold';
    desc: string;
    effect: Partial<Record<string, number>>;
    requires: number;
    next?: string[];
}
export interface Career {
    appearances: number;
    starts: number;
    minutes: number;
    goals: number;
    assists: number;
    clean_sheets: number;
    man_of_match: number;
    yellow_cards: number;
    red_cards: number;
    injuries: number;
    seasons: number;
    trophies: number;
    decisive_goals: number;
}
export type LegacyTitle = '普通球员' | '主力球员' | '功勋球员' | '俱乐部明星' | '俱乐部传奇' | '队史最佳之一';
export interface LegacyEvaluation {
    title: LegacyTitle;
    score: number;
    reasons: string[];
    rules_version: string;
}
export interface Player {
    id: string;
    original_nickname: string;
    custom_nickname: string;
    position: Position;
    adapted: Position[];
    attrs: Attrs;
    age: number;
    height: number;
    foot: '左脚' | '右脚' | '双脚';
    body: string;
    potential_range: string;
    traits: string[];
    hidden_count: number;
    form: number;
    fitness: number;
    injury: number;
    training: string;
    founding_player: boolean;
    founding_club_id?: string;
    market_value: number;
    career: Career;
    seasonStats: Career;
    logs: string[];
    club_seasons: number;
    club_tenure?: Record<string, number>;
    club_stats?: Career;
    legacy?: LegacyEvaluation;
    retirement?: { season: number; age: number; club_id: string; evaluation: LegacyEvaluation };
    h?: {
        true_potential: number;
        professionalism: number;
        consistency: number;
        injury_proneness: number;
        hidden_traits: string[];
        progress: Record<string, number>;
        changes: number;
        growth: number;
        seed: number;
    };
}
export interface Tactic {
    attack: '中路渗透' | '边路进攻' | '快速反击';
    defense: '低位防守' | '区域防守' | '高位压迫';
    mentality: '保守' | '平衡' | '激进';
}
export interface Club {
    id: string;
    user_id: string;
    username: string;
    name: string;
    short: string;
    color: string;
    secondary: string;
    badge: string;
    players: Player[];
    formation: Formation;
    lineup: string[];
    tactic: Tactic;
    ready: boolean;
    offseason_ready: boolean;
    cash: number;
    points: number;
    wins: number;
    draws: number;
    losses: number;
    gf: number;
    ga: number;
    trophies: number;
    youth: Player[];
    history: string[];
    records?: Record<string, {
        name: string;
        position: Position;
        stats: Career;
        last_season?: number;
    }>;
    alumni?: Player[];
}
export interface Transfer {
    id: string;
    from: string;
    to: string;
    player: string;
    exchange: string | null;
    money: number;
    state: 'PENDING' | 'ACCEPTED' | 'REJECTED';
}
export interface MatchSummary {
    id: string;
    season: number;
    round: number;
    home: string;
    away: string;
    state: 'GENERATING' | 'GENERATED' | 'FINISHED';
    score: [
        number,
        number
    ] | null;
    duration: number;
    replay_hash: string;
    engine_version: string;
    result_locked: boolean;
    stats: Record<string, PlayerStat> | null;
}
export interface Room {
    id: string;
    legacy_records_version?: number;
    career_seasons_version?: number;
    season_stats_version?: number;
    join_code: string;
    state: 'WAITING_PLAYER' | 'DRAFT' | 'SEASON' | 'OFFSEASON' | 'FINISHED';
    current_season: number;
    current_round: number;
    revision: number;
    host_user_id: string;
    guest_user_id: string | null;
    clubs: Club[];
    draft: {
        turn: number;
        candidates: Player[];
        picks: {
            club: string;
            player: Player;
        }[];
    };
    matches: MatchSummary[];
    transfers: Transfer[];
    champions: {
        season: number;
        club: string;
        awards: Record<string, string>;
    }[];
    seed: number;
    processed: string[];
    view: Record<string, Record<string, number>>;
    active_match: string | null;
    issued_nicknames: string[];
    market: Player[];
}
export interface PlayerStat {
    name: string;
    side: 'home' | 'away';
    position: Position;
    goals: number;
    decisive_goals?: number;
    assists: number;
    shots: number;
    saves: number;
    passes: number;
    completed: number;
    tackles: number;
    fouls: number;
    offsides: number;
    yellow: number;
    red: number;
    minutes: number;
    rating: number;
    fitness: number;
    injured: number;
    chances: number;
    dribbles: number;
    starts: boolean;
}
export interface ReplayEvent {
    time: number;
    type: string;
    side: 'home' | 'away' | null;
    player: string | null;
    secondary: string | null;
    text: string;
    x: number;
    y: number;
    trait?: string;
    chance?: number;
}
export interface ReplayFrame {
    t: number;
    ball: [
        number,
        number
    ];
    p: [
        string,
        number,
        number,
        number,
        number
    ][];
    phase: string;
}
export interface Replay {
    match_id: string;
    seed: number;
    engine_version: string;
    simulation_version: string;
    lineups: {
        home: Player[];
        away: Player[];
    };
    tactics: {
        home: Tactic;
        away: Tactic;
    };
    events: ReplayEvent[];
    frames: ReplayFrame[];
    result: [
        number,
        number
    ];
    duration: number;
    stats: Record<string, PlayerStat>;
    replay_hash: string;
    team_stats: {
        home: TeamStats;
        away: TeamStats;
    };
}
export interface TeamStats {
    possession: number;
    shots: number;
    onTarget: number;
    chances: number;
    passRate: number;
    tackles: number;
    fouls: number;
    offsides: number;
    yellow: number;
    red: number;
}
export interface GameAction {
    type: string;
    room_id?: string;
    request_id?: string;
    [key: string]: unknown;
}
export const emptyCareer = (): Career => ({ appearances: 0, starts: 0, minutes: 0, goals: 0, assists: 0, clean_sheets: 0, man_of_match: 0, yellow_cards: 0, red_cards: 0, injuries: 0, seasons: 0, trophies: 0, decisive_goals: 0 });
