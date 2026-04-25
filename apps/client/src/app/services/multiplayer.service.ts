import { Injectable } from '@angular/core';
import type {
  Ack,
  ClientToServerEvents,
  CreateRoomPayload,
  GuessCell,
  JoinRoomPayload,
  RoomStateSnapshot,
  ServerToClientEvents,
  StartRoundPayload,
  SubmitGuessPayload,
  UpdateRoomSettingsPayload,
} from '@wordle/shared';
import { BehaviorSubject } from 'rxjs';
import { io, Socket } from 'socket.io-client';

type CreateRoomResponse = { roomId: string; playerId: string; state: RoomStateSnapshot };
type JoinRoomResponse = { roomId: string; playerId: string; state: RoomStateSnapshot };
type StateResponse = { state: RoomStateSnapshot };
type GuessSubmitResponse = { state: RoomStateSnapshot; result: GuessCell[] };

@Injectable({
  providedIn: 'root',
})
export class MultiplayerService {
  private readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;

  private readonly roomStateSubject = new BehaviorSubject<RoomStateSnapshot | null>(null);
  private readonly serverErrorSubject = new BehaviorSubject<string>('');

  readonly roomState$ = this.roomStateSubject.asObservable();
  readonly serverError$ = this.serverErrorSubject.asObservable();

  constructor() {
    this.socket = io(this.getServerUrl(), {
      transports: ['websocket'],
      autoConnect: true,
    });

    this.socket.on('room:state', (state) => {
      this.roomStateSubject.next(state);
    });

    this.socket.on('room:error', (error) => {
      this.serverErrorSubject.next(error.message || 'Serverfehler');
    });
  }

  async createRoom(payload: CreateRoomPayload): Promise<CreateRoomResponse> {
    const data: CreateRoomResponse = await this.emitWithAck('room:create', payload);
    this.roomStateSubject.next(data.state);
    return data;
  }

  async joinRoom(payload: JoinRoomPayload): Promise<JoinRoomResponse> {
    const data: JoinRoomResponse = await this.emitWithAck('room:join', payload);
    this.roomStateSubject.next(data.state);
    return data;
  }

  async updateSettings(payload: UpdateRoomSettingsPayload): Promise<RoomStateSnapshot> {
    const data: StateResponse = await this.emitWithAck('room:update-settings', payload);
    this.roomStateSubject.next(data.state);
    return data.state;
  }

  async startRound(payload: StartRoundPayload): Promise<RoomStateSnapshot> {
    const data: StateResponse = await this.emitWithAck('game:start', payload);
    this.roomStateSubject.next(data.state);
    return data.state;
  }

  async submitGuess(payload: SubmitGuessPayload): Promise<GuessSubmitResponse> {
    const data: GuessSubmitResponse = await this.emitWithAck('guess:submit', payload);
    this.roomStateSubject.next(data.state);
    return data;
  }

  async startNewGame(payload: StartRoundPayload): Promise<RoomStateSnapshot> {
    const data: StateResponse = await this.emitWithAck('game:new', payload);
    this.roomStateSubject.next(data.state);
    return data.state;
  }

  clearServerError(): void {
    this.serverErrorSubject.next('');
  }

  private getServerUrl(): string {
    if (typeof window === 'undefined') {
      return 'http://localhost:3001';
    }
    return `${window.location.protocol}//${window.location.hostname}:3001`;
  }

  private emitWithAck<E extends keyof ClientToServerEvents, R>(
    event: E,
    payload: Parameters<ClientToServerEvents[E]>[0],
  ): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      const ack = (response: Ack<R>) => {
        if (response.ok) {
          resolve(response.data);
          return;
        }
        reject(new Error(response.error));
      };

      (
        this.socket.emit as (
          eventName: E,
          eventPayload: Parameters<ClientToServerEvents[E]>[0],
          callback: (response: Ack<R>) => void,
        ) => void
      )(event, payload, ack);
    });
  }
}
