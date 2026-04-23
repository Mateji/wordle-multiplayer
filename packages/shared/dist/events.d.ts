export type RoomId = string;
export type PlayerId = string;
export type LetterState = 'correct' | 'present' | 'absent' | 'unset';
export type RoomPhase = 'lobby' | 'in-game' | 'finished';
export interface RoomSettings {
    wordLength: number;
    maxGuesses: number;
    language: 'de';
}
export interface PlayerSummary {
    id: PlayerId;
    name: string;
    connected: boolean;
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
export interface RoomStateSnapshot {
    id: RoomId;
    phase: RoomPhase;
    hostPlayerId: PlayerId;
    settings: RoomSettings;
    players: PlayerSummary[];
    guesses: GuessEntry[];
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
export interface ClientToServerEvents {
    'room:create': (payload: CreateRoomPayload, ack: (response: Ack<{
        roomId: RoomId;
        playerId: PlayerId;
        state: RoomStateSnapshot;
    }>) => void) => void;
    'room:join': (payload: JoinRoomPayload, ack: (response: Ack<{
        roomId: RoomId;
        playerId: PlayerId;
        state: RoomStateSnapshot;
    }>) => void) => void;
    'guess:submit': (payload: SubmitGuessPayload, ack: (response: Ack<{
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