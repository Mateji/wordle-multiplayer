import { Injectable } from '@angular/core';
import type {
  Ack,
  ClientToServerEvents,
  CreateRoomPayload,
  EndRoundPayload,
  GuessCell,
  JoinRoomPayload,
  KickPlayerPayload,
  LeaveRoomPayload,
  RoomJoinResponse,
  RoomStateSnapshot,
  ServerToClientEvents,
  StartRoundPayload,
  SubmitGuessPayload,
  UpdateRoomSettingsPayload,
} from '@wordle/shared';
import { BehaviorSubject } from 'rxjs';
import { io, Socket } from 'socket.io-client';

type CreateRoomResponse = RoomJoinResponse;
type JoinRoomResponse = RoomJoinResponse;
type StateResponse = { state: RoomStateSnapshot };
type GuessSubmitResponse = { state: RoomStateSnapshot; result: GuessCell[] };

const LOCAL_SERVER_PORT = '3001';
const LOCAL_BROWSER_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

@Injectable({
  providedIn: 'root',
})
export class MultiplayerService {
  private readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  private connectPromise: Promise<void> | null = null;

  private readonly roomStateSubject = new BehaviorSubject<RoomStateSnapshot | null>(null);
  private readonly serverErrorSubject = new BehaviorSubject<string>('');
  private readonly kickedSubject = new BehaviorSubject<string>('');

  readonly roomState$ = this.roomStateSubject.asObservable();
  readonly serverError$ = this.serverErrorSubject.asObservable();
  readonly kicked$ = this.kickedSubject.asObservable();

  constructor() {
    this.socket = io(this.getServerUrl(), {
      autoConnect: false,
      timeout: 5000,
    });

    this.socket.on('room:state', (state) => {
      this.roomStateSubject.next(state);
    });

    this.socket.on('room:error', (error) => {
      const message = error.message || 'Serverfehler';
      if (error.code === 'KICKED') {
        this.kickedSubject.next(message);
      }
      this.serverErrorSubject.next(message);
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

  async leaveRoom(payload: LeaveRoomPayload): Promise<void> {
    await this.emitWithAck('room:leave', payload);
    this.roomStateSubject.next(null);
  }

  async kickPlayer(payload: KickPlayerPayload): Promise<RoomStateSnapshot> {
    const data: StateResponse = await this.emitWithAck('room:kick-player', payload);
    this.roomStateSubject.next(data.state);
    return data.state;
  }

  async updateSettings(payload: UpdateRoomSettingsPayload): Promise<RoomStateSnapshot> {
    const data: StateResponse = await this.emitWithAck('room:update-settings', payload);
    this.roomStateSubject.next(data.state);
    return data.state;
  }

  disconnectSocket(): void {
    try {
      this.socket.disconnect();
      this.roomStateSubject.next(null);
    } catch {
      // ignore
    }
  }

  async startRound(payload: StartRoundPayload): Promise<RoomStateSnapshot> {
    const data: StateResponse = await this.emitWithAck('game:start', payload);
    this.roomStateSubject.next(data.state);
    return data.state;
  }

  async endRound(payload: EndRoundPayload): Promise<RoomStateSnapshot> {
    const data: StateResponse = await this.emitWithAck('game:end', payload);
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

  clearKickedNotice(): void {
    this.kickedSubject.next('');
  }

  buildServerUrl(pathname: string): string {
    const serverUrl = new URL(this.getServerUrl());
    serverUrl.pathname = pathname.startsWith('/') ? pathname : `/${pathname}`;
    serverUrl.search = '';
    serverUrl.hash = '';
    return serverUrl.toString();
  }

  private getServerUrl(): string {
    const configuredUrl = this.getConfiguredServerUrl();
    if (configuredUrl) {
      return configuredUrl;
    }

    if (typeof window === 'undefined') {
      return 'http://localhost:3001';
    }

    if (LOCAL_BROWSER_HOSTS.has(window.location.hostname)) {
      return `${window.location.protocol}//${window.location.hostname}:${LOCAL_SERVER_PORT}`;
    }

    return window.location.origin;
  }

  private getConfiguredServerUrl(): string | null {
    const runtimeConfig = globalThis as typeof globalThis & {
      __WORDLE_SERVER_URL__?: unknown;
    };
    const configuredUrl =
      typeof runtimeConfig.__WORDLE_SERVER_URL__ === 'string' ? runtimeConfig.__WORDLE_SERVER_URL__.trim() : '';

    if (!configuredUrl) {
      return null;
    }

    try {
      const baseOrigin = typeof window === 'undefined' ? 'http://localhost:4200' : window.location.origin;
      return new URL(configuredUrl, baseOrigin).origin;
    } catch {
      return null;
    }
  }

  private emitWithAck<E extends keyof ClientToServerEvents, R>(
    event: E,
    payload: Parameters<ClientToServerEvents[E]>[0],
  ): Promise<R> {
    return this.ensureConnected().then(
      () =>
        new Promise<R>((resolve, reject) => {
          const timeoutHandle = setTimeout(() => {
            reject(new Error('Serverantwort hat zu lange gedauert.'));
          }, 8000);

          const ack = (response: Ack<R>) => {
            clearTimeout(timeoutHandle);
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
        }),
    );
  }

  private ensureConnected(): Promise<void> {
    if (this.socket.connected) {
      return Promise.resolve();
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        cleanup();
        this.socket.disconnect();
        const message = 'Verbindung zum Server fehlgeschlagen.';
        this.serverErrorSubject.next(message);
        reject(new Error(message));
      }, 6000);

      const onConnect = () => {
        cleanup();
        resolve();
      };

      const onConnectError = (error: Error) => {
        cleanup();
        const message = error.message || 'Verbindung zum Server fehlgeschlagen.';
        this.serverErrorSubject.next(message);
        reject(new Error(message));
      };

      const cleanup = () => {
        clearTimeout(timeoutHandle);
        this.socket.off('connect', onConnect);
        this.socket.off('connect_error', onConnectError);
        this.connectPromise = null;
      };

      this.socket.once('connect', onConnect);
      this.socket.once('connect_error', onConnectError);
      if (!this.socket.active) {
        this.socket.connect();
      }
    });

    return this.connectPromise;
  }
}
