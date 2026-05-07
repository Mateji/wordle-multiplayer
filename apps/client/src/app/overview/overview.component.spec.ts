import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import type { RoomJoinResponse, RoomStateSnapshot } from '@wordle/shared';
import { BehaviorSubject } from 'rxjs';
import { AudioService } from '../services/audio.service';
import { MultiplayerService } from '../services/multiplayer.service';
import { OverviewComponent } from './overview.component';

class AudioServiceStub {
  async unlock(): Promise<void> {}

  async playClip(_name?: string): Promise<void> {}

  async playSequence(_groupName?: string, _clipNames?: string[], _spec?: string): Promise<void> {}

  async scheduleSequenceAt(
    _groupName?: string,
    _clipNames?: string[],
    _startUnixMs?: number,
    _spec?: string,
  ): Promise<void> {}

  async scheduleNumberCountdown(_groupName?: string, _highestNumber?: number, _endUnixMs?: number): Promise<void> {}

  cancelGroup(_groupName?: string): void {}

  cancelAll(): void {}
}

class MultiplayerServiceStub {
  readonly roomStateSubject = new BehaviorSubject<RoomStateSnapshot | null>(null);
  readonly serverErrorSubject = new BehaviorSubject<string>('');
  readonly kickedSubject = new BehaviorSubject<string>('');

  readonly roomState$ = this.roomStateSubject.asObservable();
  readonly serverError$ = this.serverErrorSubject.asObservable();
  readonly kicked$ = this.kickedSubject.asObservable();

  clearServerError(): void {}

  clearKickedNotice(): void {}

  disconnectSocket(): void {}

  async createRoom(): Promise<never> {
    throw new Error('not implemented in tests');
  }

  async joinRoom(_payload?: unknown): Promise<RoomJoinResponse> {
    throw new Error('not implemented in tests');
  }

  async updateSettings(): Promise<never> {
    throw new Error('not implemented in tests');
  }

  async startRound(_payload?: unknown): Promise<never> {
    throw new Error('not implemented in tests');
  }

  async endRound(_payload?: unknown): Promise<RoomStateSnapshot> {
    throw new Error('not implemented in tests');
  }

  async submitGuess(_payload?: unknown): Promise<never> {
    throw new Error('not implemented in tests');
  }

  async startNewGame(_payload?: unknown): Promise<never> {
    throw new Error('not implemented in tests');
  }
}

describe('Overview', () => {
  let component: OverviewComponent;
  let fixture: ComponentFixture<OverviewComponent>;
  let routeParamMap: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let audioService: AudioServiceStub;
  let multiplayerService: MultiplayerServiceStub;
  let router: Router;

  beforeEach(async () => {
    routeParamMap = new BehaviorSubject(convertToParamMap({}));
    window.localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [OverviewComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([{ path: '', component: OverviewComponent }, { path: 'room/:roomId', component: OverviewComponent }]),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: routeParamMap.asObservable(),
          },
        },
        { provide: AudioService, useClass: AudioServiceStub },
        { provide: MultiplayerService, useClass: MultiplayerServiceStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OverviewComponent);
    component = fixture.componentInstance;
    audioService = TestBed.inject(AudioService) as unknown as AudioServiceStub;
    multiplayerService = TestBed.inject(MultiplayerService) as unknown as MultiplayerServiceStub;
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('does not route letter key through document handler when focused in letter input', () => {
    component.mode = 'game';
    component.roomState = {
      id: 'ROOM1',
      phase: 'in-game',
      hostPlayerId: 'p1',
      settings: { wordLength: 5, maxGuesses: 6, timeLimitSeconds: 120, language: 'de' },
      players: [{ id: 'p1', name: 'Tester', connected: true, wins: 0 }],
      round: {
        id: 'r1',
        status: 'running',
        startedAt: Date.now(),
        endsAt: Date.now() + 60_000,
        winnerPlayerId: null,
      },
      playerProgress: [],
      updatedAt: Date.now(),
    };

    const onKeyboardKeySpy = spyOn(component, 'onKeyboardKey');
    const letterInput = document.createElement('input');
    letterInput.className = 'letter';

    const event = new KeyboardEvent('keydown', { key: 'a' });
    Object.defineProperty(event, 'target', { value: letterInput });

    component.onDocumentKeydown(event);

    expect(onKeyboardKeySpy).not.toHaveBeenCalled();
  });

  it('routes Enter through document handler when focused in letter input', () => {
    component.mode = 'game';
    component.roomState = {
      id: 'ROOM1',
      phase: 'in-game',
      hostPlayerId: 'p1',
      settings: { wordLength: 5, maxGuesses: 6, timeLimitSeconds: 120, language: 'de' },
      players: [{ id: 'p1', name: 'Tester', connected: true, wins: 0 }],
      round: {
        id: 'r1',
        status: 'running',
        startedAt: Date.now(),
        endsAt: Date.now() + 60_000,
        winnerPlayerId: null,
      },
      playerProgress: [],
      updatedAt: Date.now(),
    };

    const onKeyboardKeySpy = spyOn(component, 'onKeyboardKey');
    const letterInput = document.createElement('input');
    letterInput.className = 'letter';

    const event = new KeyboardEvent('keydown', { key: 'Enter' });
    Object.defineProperty(event, 'target', { value: letterInput });

    component.onDocumentKeydown(event);

    expect(onKeyboardKeySpy).toHaveBeenCalledTimes(1);
    expect(onKeyboardKeySpy).toHaveBeenCalledWith('Enter');
  });

  it('routes physical letter key once when focus is outside editable elements', () => {
    component.mode = 'game';
    component.roomState = {
      id: 'ROOM1',
      phase: 'in-game',
      hostPlayerId: 'p1',
      settings: { wordLength: 5, maxGuesses: 6, timeLimitSeconds: 120, language: 'de' },
      players: [{ id: 'p1', name: 'Tester', connected: true, wins: 0 }],
      round: {
        id: 'r1',
        status: 'running',
        startedAt: Date.now(),
        endsAt: Date.now() + 60_000,
        winnerPlayerId: null,
      },
      playerProgress: [],
      updatedAt: Date.now(),
    };

    const onKeyboardKeySpy = spyOn(component, 'onKeyboardKey');
    const wrapper = document.createElement('div');

    const event = new KeyboardEvent('keydown', { key: 'ö' });
    Object.defineProperty(event, 'target', { value: wrapper });

    component.onDocumentKeydown(event);

    expect(onKeyboardKeySpy).toHaveBeenCalledTimes(1);
    expect(onKeyboardKeySpy).toHaveBeenCalledWith('ö');
  });

  it('does not auto-rejoin the same room after acknowledging a kick', async () => {
    component.playerName = 'Chrome';
    component.mode = 'lobby';
    component.roomId = 'ROOM42';
    component.playerId = 'player_1';
    component.reconnectSecret = 'secret_1';

    const joinRoomSpy = spyOn(multiplayerService, 'joinRoom').and.rejectWith(new Error('should not be called'));
    const disconnectSocketSpy = spyOn(multiplayerService, 'disconnectSocket');
    const navigateSpy = spyOn(router, 'navigate').and.resolveTo(true);

    routeParamMap.next(convertToParamMap({ roomId: 'ROOM42' }));
    multiplayerService.kickedSubject.next('Du wurdest aus dem Raum entfernt.');
    fixture.detectChanges();

    expect(disconnectSocketSpy).toHaveBeenCalled();
    expect(component.mode).toBe('entry');
    expect(component.roomId).toBe('');
    expect(navigateSpy).toHaveBeenCalledWith(['/'], { replaceUrl: true });

    component.acknowledgeKickedDialog();

    expect(component.kickedDialogMessage).toBe('');

    routeParamMap.next(convertToParamMap({ roomId: 'ROOM42' }));

    expect(joinRoomSpy).not.toHaveBeenCalled();
  });

  it('rejoins the linked room after reload when a stored room session exists', async () => {
    window.localStorage.setItem('wordle.playerName', 'Chrome');
    window.localStorage.setItem(
      'wordle.roomSession',
      JSON.stringify({ roomId: 'ROOM42', playerId: 'player_1', reconnectSecret: 'secret_1' }),
    );

    const joinRoomSpy = spyOn(multiplayerService, 'joinRoom').and.resolveTo({
      roomId: 'ROOM42',
      playerId: 'player_1',
      reconnectSecret: 'secret_2',
      state: {
        id: 'ROOM42',
        phase: 'lobby',
        hostPlayerId: 'player_1',
        settings: { wordLength: 5, maxGuesses: 6, timeLimitSeconds: 120, language: 'de' },
        players: [{ id: 'player_1', name: 'Chrome', connected: true, wins: 0 }],
        round: {
          id: 'r_reload',
          status: 'idle',
          startedAt: null,
          endsAt: null,
          winnerPlayerId: null,
        },
        playerProgress: [],
        updatedAt: Date.now(),
      },
    });

    const reloadedFixture = TestBed.createComponent(OverviewComponent);
    const reloadedComponent = reloadedFixture.componentInstance;
    reloadedFixture.detectChanges();

    routeParamMap.next(convertToParamMap({ roomId: 'ROOM42' }));
    await Promise.resolve();
    await Promise.resolve();

    expect(joinRoomSpy).toHaveBeenCalledWith({
      roomId: 'ROOM42',
      playerName: 'Chrome',
      reconnectPlayerId: 'player_1',
      reconnectSecret: 'secret_1',
    });
    expect(reloadedComponent.roomId).toBe('ROOM42');
  });

  it('keeps the lobby visible while a countdown is active', () => {
    multiplayerService.roomStateSubject.next({
      id: 'ROOM1',
      phase: 'lobby',
      hostPlayerId: 'p1',
      settings: { wordLength: 5, maxGuesses: 6, timeLimitSeconds: 120, language: 'de' },
      players: [{ id: 'p1', name: 'Host', connected: true, wins: 0 }],
      round: {
        id: 'r2',
        status: 'countdown',
        startedAt: Date.now() + 5_000,
        endsAt: null,
        winnerPlayerId: null,
      },
      playerProgress: [],
      updatedAt: Date.now(),
    });
    fixture.detectChanges();

    expect(component.mode).toBe('lobby');
    expect(component.isCountdownVisible).toBeTrue();
    expect(component.countdownDisplayValue).toMatch(/^[0-5]$/);
  });

  it('sorts game players by solved state, score, and guesses used', () => {
    component.roomState = {
      id: 'ROOM1',
      phase: 'in-game',
      hostPlayerId: 'p1',
      settings: { wordLength: 5, maxGuesses: 6, timeLimitSeconds: 120, language: 'de' },
      players: [
        { id: 'p1', name: 'Alpha', connected: true, wins: 0 },
        { id: 'p2', name: 'Beta', connected: true, wins: 0 },
        { id: 'p3', name: 'Gamma', connected: true, wins: 2 },
      ],
      round: {
        id: 'r3',
        status: 'running',
        startedAt: Date.now(),
        endsAt: Date.now() + 60_000,
        winnerPlayerId: null,
      },
      playerProgress: [
        {
          playerId: 'p1',
          cells: [{ state: 'correct' }, { state: 'present' }, { state: 'unset' }, { state: 'unset' }, { state: 'unset' }],
          solved: false,
          guessesUsed: 3,
          exhausted: false,
          updatedAt: Date.now(),
        },
        {
          playerId: 'p2',
          cells: [{ state: 'present' }, { state: 'present' }, { state: 'present' }, { state: 'unset' }, { state: 'unset' }],
          solved: false,
          guessesUsed: 2,
          exhausted: false,
          updatedAt: Date.now(),
        },
        {
          playerId: 'p3',
          cells: [{ state: 'correct' }, { state: 'correct' }, { state: 'correct' }, { state: 'correct' }, { state: 'correct' }],
          solved: true,
          guessesUsed: 4,
          exhausted: false,
          updatedAt: Date.now(),
        },
      ],
      updatedAt: Date.now(),
    };

    expect(component.sortedGamePlayerList.map((player) => player.id)).toEqual(['p3', 'p1', 'p2']);
  });

  it('shows an exhausted status and disables input for the current player with no guesses left', () => {
    component.mode = 'game';
    component.playerId = 'p1';
    component.roomState = {
      id: 'ROOM1',
      phase: 'in-game',
      hostPlayerId: 'p1',
      settings: { wordLength: 5, maxGuesses: 6, timeLimitSeconds: 120, language: 'de' },
      players: [{ id: 'p1', name: 'Alpha', connected: true, wins: 0 }],
      round: {
        id: 'r4',
        status: 'running',
        startedAt: Date.now(),
        endsAt: Date.now() + 60_000,
        winnerPlayerId: null,
      },
      playerProgress: [
        {
          playerId: 'p1',
          cells: [{ state: 'present' }, { state: 'unset' }, { state: 'unset' }, { state: 'unset' }, { state: 'unset' }],
          solved: false,
          guessesUsed: 6,
          exhausted: true,
          updatedAt: Date.now(),
        },
      ],
      updatedAt: Date.now(),
    };

    expect(component.isCurrentPlayerExhausted).toBeTrue();
    expect(component.currentPlayerStatusMessage).toContain('Keine Versuche mehr');
    expect(component.isGameInputEnabled).toBeFalse();
    expect(component.getPlayerGuessUsageLabel('p1')).toBe('6/6');
  });

  it('shows the urgent round timer only for the last 10 seconds', () => {
    component.roomState = {
      id: 'ROOM1',
      phase: 'in-game',
      hostPlayerId: 'p1',
      settings: { wordLength: 5, maxGuesses: 6, timeLimitSeconds: 120, language: 'de' },
      players: [{ id: 'p1', name: 'Alpha', connected: true, wins: 0 }],
      round: {
        id: 'r5',
        status: 'running',
        startedAt: Date.now(),
        endsAt: Date.now() + 9_000,
        winnerPlayerId: null,
      },
      playerProgress: [],
      updatedAt: Date.now(),
    };

    expect(component.isUrgentRoundTimerVisible).toBeTrue();
    expect(component.urgentRoundTimerLabel).toMatch(/^[0-9]+$/);
  });

  it('lets the host end an active round from the lobby', async () => {
    component.playerId = 'p1';
    const activeRoundState: RoomStateSnapshot = {
      id: 'ROOM1',
      phase: 'in-game',
      hostPlayerId: 'p1',
      settings: { wordLength: 5, maxGuesses: 6, timeLimitSeconds: 120, language: 'de' },
      players: [{ id: 'p1', name: 'Alpha', connected: true, wins: 0 }],
      round: {
        id: 'r-end',
        status: 'running',
        startedAt: Date.now() - 30_000,
        endsAt: Date.now() + 20_000,
        winnerPlayerId: null,
      },
      playerProgress: [],
      updatedAt: Date.now(),
    };

    component.roomState = activeRoundState;

    const endRoundSpy = spyOn(multiplayerService, 'endRound').and.resolveTo(activeRoundState);

    await component.onEndRound();

    expect(endRoundSpy).toHaveBeenCalledWith({ roomId: 'ROOM1', playerId: 'p1' });
    expect(component.isBusy).toBeFalse();
  });

  it('buffers countdown and timeout audio against the round end timestamp', async () => {
    const countdownSpy = spyOn(audioService, 'scheduleNumberCountdown').and.resolveTo();
    const timeoutSequenceSpy = spyOn(audioService, 'scheduleSequenceAt').and.resolveTo();

    const endsAt = Date.now() + 9_000;

    multiplayerService.roomStateSubject.next({
      id: 'ROOM1',
      phase: 'in-game',
      hostPlayerId: 'p1',
      settings: { wordLength: 5, maxGuesses: 6, timeLimitSeconds: 60, language: 'de' },
      players: [{ id: 'p1', name: 'Alpha', connected: true, wins: 0 }],
      round: {
        id: 'round_timeout',
        status: 'running',
        startedAt: Date.now() - 51_000,
        endsAt,
        winnerPlayerId: null,
      },
      playerProgress: [],
      updatedAt: Date.now(),
    });

    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(countdownSpy).toHaveBeenCalledWith('round-end-countdown', 10, endsAt);
    expect(timeoutSequenceSpy).toHaveBeenCalledWith(
      'round-timeout',
      ['time_over', 'you_lose'],
      endsAt,
      jasmine.stringMatching(/^round_timeout:/),
    );
  });

  it('shows the revealed target word in the finished-round popup', () => {
    multiplayerService.roomStateSubject.next({
      id: 'ROOM1',
      phase: 'finished',
      hostPlayerId: 'p1',
      settings: { wordLength: 5, maxGuesses: 6, timeLimitSeconds: 120, language: 'de' },
      players: [{ id: 'p1', name: 'Alpha', connected: true, wins: 1 }],
      round: {
        id: 'r6',
        status: 'solved',
        startedAt: Date.now() - 30_000,
        endsAt: Date.now(),
        winnerPlayerId: 'p1',
        revealedTargetWord: 'OBELS',
      },
      playerProgress: [
        {
          playerId: 'p1',
          cells: [{ state: 'correct' }, { state: 'correct' }, { state: 'correct' }, { state: 'correct' }, { state: 'correct' }],
          solved: true,
          guessesUsed: 3,
          exhausted: false,
          updatedAt: Date.now(),
        },
      ],
      updatedAt: Date.now(),
    });
    fixture.detectChanges();

    const popupText = fixture.nativeElement.textContent as string;
    expect(component.showWinPopup).toBeTrue();
    expect(popupText).toContain('Das Zielwort war: OBELS');
  });
});
