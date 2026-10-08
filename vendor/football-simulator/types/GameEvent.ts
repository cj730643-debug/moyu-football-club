import type { Event } from '../enums/Event.ts';
import type { GameInfo } from './GameInfo.ts';
import type Team from '../Team.ts';
import type { FieldArea } from '../enums/FieldArea.ts';
import type Player from '../Player.ts';
import type { GoalType } from '../enums/GoalType.ts';
import type { AssistType } from '../enums/AssistType.ts';

export interface GameEvent {
    event: Event;
    data: any;
    gameInfo: GameInfo;
    attackingTeam: Team;
    defendingTeam: Team;
    fieldPosition: FieldArea;
    attackingPrimaryPlayer: Player | null;
    attackingSecondaryPlayer: Player | null;
    defendingPrimaryPlayer: Player | null;
    defendingSecondaryPlayer: Player | null;
    homeTeam: Team;
    awayTeam: Team;
    goalType: GoalType | null;
    assistType: AssistType | null;
}

