export type RoomId = string;
export type PlayerId = string;
export type RoundId = string;
export type LetterState = 'correct' | 'present' | 'absent' | 'unset';
export type ProgressCellState = 'correct' | 'present' | 'unset';
export type RoomPhase = 'lobby' | 'in-game' | 'finished';
export type RoundStatus = 'idle' | 'countdown' | 'running' | 'solved' | 'timeout' | 'cancelled';
export interface RoomSettings {
    wordLength: number;
    maxGuesses: number;
    timeLimitSeconds: number;
    language: 'de';
}
export interface PlayerSummary {
    id: PlayerId;
    name: string;
    connected: boolean;
    wins: number;
}
export interface GuessCell {
    letter: string;
    state: LetterState;
}
export interface GuessEntry {
    playerId: PlayerId;
    word: string;
    cells: GuessCell[];
    submittedAt: number;
}
export interface PlayerProgressCell {
    state: ProgressCellState;
}
export interface PlayerRoundProgress {
    playerId: PlayerId;
    cells: PlayerProgressCell[];
    solved: boolean;
    guessesUsed: number;
    exhausted: boolean;
    updatedAt: number;
}
export interface RoundSnapshot {
    id: RoundId;
    status: RoundStatus;
    startedAt: number | null;
    endsAt: number | null;
    winnerPlayerId: PlayerId | null;
    revealedTargetWord?: string | null;
}
export interface RoomStateSnapshot {
    id: RoomId;
    phase: RoomPhase;
    hostPlayerId: PlayerId;
    settings: RoomSettings;
    players: PlayerSummary[];
    round: RoundSnapshot;
    playerProgress: PlayerRoundProgress[];
    updatedAt: number;
}
export type AckSuccess<T> = {
    ok: true;
    data: T;
};
export type AckError = {
    ok: false;
    error: string;
};
export type Ack<T> = AckSuccess<T> | AckError;
export interface CreateRoomPayload {
    playerName: string;
    settings?: Partial<RoomSettings>;
}
export interface JoinRoomPayload {
    roomId: RoomId;
    playerName: string;
    reconnectPlayerId?: PlayerId;
    reconnectSecret?: string;
}
export interface RoomJoinResponse {
    roomId: RoomId;
    playerId: PlayerId;
    reconnectSecret: string;
    state: RoomStateSnapshot;
}
export interface KickPlayerPayload {
    roomId: RoomId;
    hostPlayerId: PlayerId;
    targetPlayerId: PlayerId;
}
export interface LeaveRoomPayload {
    roomId: RoomId;
    playerId: PlayerId;
}
export interface SubmitGuessPayload {
    roomId: RoomId;
    playerId: PlayerId;
    word: string;
}
export interface StartNewGamePayload {
    roomId: RoomId;
    playerId: PlayerId;
}
export interface UpdateRoomSettingsPayload {
    roomId: RoomId;
    playerId: PlayerId;
    settings: Partial<Pick<RoomSettings, 'wordLength' | 'maxGuesses' | 'timeLimitSeconds'>>;
}
export interface StartRoundPayload {
    roomId: RoomId;
    playerId: PlayerId;
}
export interface ClientToServerEvents {
    'room:create': (payload: CreateRoomPayload, ack: (response: Ack<RoomJoinResponse>) => void) => void;
    'room:join': (payload: JoinRoomPayload, ack: (response: Ack<RoomJoinResponse>) => void) => void;
    'room:leave': (payload: LeaveRoomPayload, ack: (response: Ack<{
        roomId: RoomId;
    }>) => void) => void;
    'room:kick-player': (payload: KickPlayerPayload, ack: (response: Ack<{
        state: RoomStateSnapshot;
    }>) => void) => void;
    'guess:submit': (payload: SubmitGuessPayload, ack: (response: Ack<{
        state: RoomStateSnapshot;
        result: GuessCell[];
    }>) => void) => void;
    'room:update-settings': (payload: UpdateRoomSettingsPayload, ack: (response: Ack<{
        state: RoomStateSnapshot;
    }>) => void) => void;
    'game:start': (payload: StartRoundPayload, ack: (response: Ack<{
        state: RoomStateSnapshot;
    }>) => void) => void;
    'game:new': (payload: StartNewGamePayload, ack: (response: Ack<{
        state: RoomStateSnapshot;
    }>) => void) => void;
}
export interface ServerToClientEvents {
    'room:state': (state: RoomStateSnapshot) => void;
    'room:error': (error: {
        code: string;
        message: string;
    }) => void;
}
//# sourceMappingURL=events.d.ts.map