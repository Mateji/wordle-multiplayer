import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  inject,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { GuessCell, PlayerId, PlayerRoundProgress, PlayerSummary, ProgressCellState, RoomStateSnapshot } from '@wordle/shared';
import { Subscription } from 'rxjs';
import type { LetterState, Row } from '../models';
import { AudioService } from '../services/audio.service';
import { MultiplayerService } from '../services/multiplayer.service';
import { EntryScreenComponent } from './entry-screen.component';
import { GameScreenComponent } from './game-screen.component';
import { LobbyScreenComponent } from './lobby-screen.component';

type ViewMode = 'entry' | 'lobby' | 'game';

type StoredRoomSession = {
  roomId: string;
  playerId: string;
  reconnectSecret: string;
};

@Component({
  selector: 'app-overview',
  imports: [EntryScreenComponent, LobbyScreenComponent, GameScreenComponent],
  templateUrl: './overview.component.html',
  styleUrl: './overview.component.css',
})
export class OverviewComponent implements OnInit, AfterViewInit, OnDestroy {
  private static readonly PLAYER_NAME_STORAGE_KEY = 'wordle.playerName';
  private static readonly ROOM_SESSION_STORAGE_KEY = 'wordle.roomSession';
  private static readonly LOBBY_COUNTDOWN_AUDIO_GROUP = 'lobby-countdown';
  private static readonly ROUND_END_COUNTDOWN_AUDIO_GROUP = 'round-end-countdown';
  private static readonly ROUND_TIMEOUT_AUDIO_GROUP = 'round-timeout';
  private static readonly ROUND_FINISH_AUDIO_GROUP = 'round-finish';

  @ViewChild(GameScreenComponent)
  set gameScreenComponent(component: GameScreenComponent | undefined) {
    this.gameScreen = component;
    this.bindLetterInputChanges();
    if (component) {
      this.scheduleLayoutUpdate();
    }
  }

  mode: ViewMode = 'entry';

  playerName = '';
  joinCode = '';
  roomId = '';
  playerId = '';
  reconnectSecret = '';

  roomState: RoomStateSnapshot | null = null;
  actionError = '';
  serverError = '';
  kickedBannerMessage = '';
  isBusy = false;

  settingsForm = {
    wordLength: 5,
    maxGuesses: 6,
    timeLimitSeconds: 0,
  };

  rows: Row[] = [];
  activeRow = 0;
  gameOver = false;
  showWinPopup = false;
  winMessage = '';

  invalidWordMessage = '';
  invalidWordVisible = false;

  topOffset = 0;
  wordleHeight = 0;
  wordleMaxHeight = 9999;
  wordleOverflowY: 'hidden' | 'auto' = 'hidden';

  nowTimestamp = Date.now();

  private subscriptions = new Subscription();
  private readonly audio = inject(AudioService);
  private readonly multiplayer = inject(MultiplayerService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private pendingFocusIndex: number | null = null;
  private baseWordleHeight = 0;
  private readonly rowToKeyboardGap = 12;
  private readonly overflowEnableThresholdPx = 2;
  private readonly overflowDisableThresholdPx = -2;
  private layoutRaf: number | null = null;

  private invalidWordTimeout: ReturnType<typeof setTimeout> | null = null;
  private invalidWordShowTimeout: ReturnType<typeof setTimeout> | null = null;
  private errorRowIndex: number | null = null;
  private rowShakeStartTimeout: ReturnType<typeof setTimeout> | null = null;
  private rowShakeEndTimeout: ReturnType<typeof setTimeout> | null = null;
  private tickerInterval: ReturnType<typeof setInterval> | null = null;
  private currentRoundId = '';
  private readonly progressFlashDurationMs = 720;
  private readonly progressFlashingCells = new Set<string>();
  private readonly progressFlashTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private gameScreen?: GameScreenComponent;
  private letterInputChangesSubscription: Subscription | null = null;
  private pendingRoomIdFromLink = '';
  private requiresNameForRoomLink = false;
  private suppressNextRouteAutoJoin = false;
  private blockedAutoJoinRoomId = '';
  private preferLobbyDuringGame = false;
  private preferLobbyAfterFinish = false;
  private kickedBannerTimeout: ReturnType<typeof setTimeout> | null = null;
  kickedDialogMessage = '';
  linkCopiedMessage = '';
  private copyNoticeTimeout: ReturnType<typeof setTimeout> | null = null;
  private finishedAudioRoundId = '';

  ngOnInit(): void {
    this.playerName = this.getStoredPlayerName();
    const storedSession = this.getStoredRoomSession();
    if (storedSession) {
      this.roomId = storedSession.roomId;
      this.playerId = storedSession.playerId;
      this.reconnectSecret = storedSession.reconnectSecret;
    }
    this.resetRows(this.settingsForm.wordLength);

    this.subscriptions.add(
      this.multiplayer.roomState$.subscribe((state) => {
        if (!state) {
          return;
        }
        this.applyRoomState(state);
      }),
    );

    this.subscriptions.add(
      this.multiplayer.serverError$.subscribe((error) => {
        this.serverError = error;
      }),
    );

    this.subscriptions.add(
      this.multiplayer.kicked$.subscribe((message) => {
        if (!message) {
          return;
        }

        this.applyKickedState(message);
      }),
    );

    this.subscriptions.add(
      this.route.paramMap.subscribe((params) => {
        const linkedRoomId = this.normalizeRoomCode(params.get('roomId') ?? '');

        if (!linkedRoomId) {
          this.blockedAutoJoinRoomId = '';
        }

        this.pendingRoomIdFromLink = linkedRoomId;
        this.joinCode = linkedRoomId;

        const linkedRoomSession = this.getStoredRoomSession();
        if (linkedRoomSession && linkedRoomSession.roomId === linkedRoomId) {
          this.roomId = linkedRoomSession.roomId;
          this.playerId = linkedRoomSession.playerId;
          this.reconnectSecret = linkedRoomSession.reconnectSecret;
        }

        if (linkedRoomId) {
          try {
            void fetch(this.multiplayer.buildServerUrl(`/rooms/${linkedRoomId}`), { method: 'GET' })
              .then((res) => {
                if (res.status === 404) {
                  if (this.pendingRoomIdFromLink === linkedRoomId) {
                    this.pendingRoomIdFromLink = '';
                    this.joinCode = '';
                    this.requiresNameForRoomLink = false;
                    this.clearRoomSession();
                    void this.router.navigate(['/'], { replaceUrl: true });
                  }
                }
              })
              .catch(() => {
                // ignore network errors here (server might be restarting)
              });
          } catch {
            // ignore
          }
        }

        if (!linkedRoomId) {
          this.requiresNameForRoomLink = false;
          return;
        }

        if (this.blockedAutoJoinRoomId && this.blockedAutoJoinRoomId === linkedRoomId) {
          this.requiresNameForRoomLink = false;
          return;
        }

        if (this.suppressNextRouteAutoJoin && this.roomId === linkedRoomId) {
          this.suppressNextRouteAutoJoin = false;
          this.requiresNameForRoomLink = false;
          return;
        }

        if (this.roomState?.id === linkedRoomId && this.playerId && this.roomId === linkedRoomId) {
          this.requiresNameForRoomLink = false;
          return;
        }

        if (this.mode !== 'entry') {
          return;
        }

        if (!this.playerName.trim()) {
          this.requiresNameForRoomLink = true;
          this.mode = 'entry';
          return;
        }

        this.requiresNameForRoomLink = false;
        void this.joinLinkedRoom(linkedRoomId);
      }),
    );
  }

  ngAfterViewInit(): void {
    this.bindLetterInputChanges();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.letterInputChangesSubscription?.unsubscribe();
    this.letterInputChangesSubscription = null;
    this.clearCountdownAudio();
    this.clearTransientTimers();
    this.clearTicker();
    this.clearKickedBanner();
  }

  @HostListener('document:pointerdown')
  onDocumentPointerdown(): void {
    this.unlockAndSyncAudio();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.scheduleLayoutUpdate();
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    this.unlockAndSyncAudio();

    if (!this.isGameInputEnabled) return;

    const target = event.target as HTMLElement | null;
    const isLetterInputTarget = !!target?.closest('input.letter');
    const isOtherEditableTarget =
      !!target?.closest('input, textarea, select') || target?.isContentEditable === true;

    // Letter inputs are managed by SingleLetterDirective.
    // Handle only Enter here to keep keyboard submit behavior.
    if (isLetterInputTarget) {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.onKeyboardKey('Enter');
      }
      return;
    }

    if (isOtherEditableTarget) return;

    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === 'Backspace') {
      event.preventDefault();
      this.onKeyboardKey('Backspace');
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      this.onKeyboardKey('Enter');
      return;
    }

    if (/^[a-zäöüß]$/i.test(event.key)) {
      event.preventDefault();
      this.onKeyboardKey(event.key);
    }
  }

  get isHost(): boolean {
    return !!this.roomState && this.roomState.hostPlayerId === this.playerId;
  }

  get isGameInputEnabled(): boolean {
    return this.mode === 'game' && this.roomState?.phase === 'in-game' && this.roomState.round.status === 'running' && !this.isCurrentPlayerExhausted;
  }

  get isCountdownVisible(): boolean {
    return this.roomState?.round.status === 'countdown' && !!this.roomState.round.startedAt;
  }

  get countdownDisplayValue(): string {
    if (!this.isCountdownVisible || !this.roomState?.round.startedAt) {
      return '';
    }

    const millisecondsRemaining = Math.max(0, this.roomState.round.startedAt - this.nowTimestamp);
    return String(Math.max(0, Math.ceil(millisecondsRemaining / 1000)));
  }

  get playerList(): PlayerSummary[] {
    return this.roomState?.players ?? [];
  }

  get sortedGamePlayerList(): PlayerSummary[] {
    const players = [...this.playerList];
    const originalOrder = new Map(players.map((player, index) => [player.id, index]));

    return players.sort((left, right) => {
      const leftProgress = this.getPlayerProgress(left.id);
      const rightProgress = this.getPlayerProgress(right.id);
      const leftSolved = leftProgress?.solved ? 1 : 0;
      const rightSolved = rightProgress?.solved ? 1 : 0;
      if (leftSolved !== rightSolved) {
        return rightSolved - leftSolved;
      }

      const scoreDiff = this.getProgressScore(rightProgress) - this.getProgressScore(leftProgress);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      const guessDiff = (leftProgress?.guessesUsed ?? 0) - (rightProgress?.guessesUsed ?? 0);
      if (guessDiff !== 0) {
        return guessDiff;
      }

      return (originalOrder.get(left.id) ?? 0) - (originalOrder.get(right.id) ?? 0);
    });
  }

  get isCurrentPlayerExhausted(): boolean {
    const progress = this.getPlayerProgress(this.playerId);
    return this.roomState?.phase === 'in-game' && this.roomState.round.status === 'running' && !!progress?.exhausted;
  }

  get currentPlayerStatusMessage(): string {
    if (this.isCurrentPlayerExhausted) {
      return 'Keine Versuche mehr. Du schaust jetzt zu.';
    }

    return '';
  }

  get currentWordLength(): number {
    return this.roomState?.settings.wordLength ?? this.settingsForm.wordLength;
  }

  get currentMaxGuesses(): number {
    return this.roomState?.settings.maxGuesses ?? this.settingsForm.maxGuesses;
  }

  get revealedTargetWord(): string {
    return this.roomState?.phase === 'finished'
      ? (this.roomState.round.revealedTargetWord ?? '').toLocaleUpperCase('de-DE')
      : '';
  }

  get keyStates(): Record<string, LetterState> {
    const priority: Record<LetterState, number> = {
      unset: 0,
      absent: 1,
      present: 2,
      correct: 3,
    };

    const map: Record<string, LetterState> = {};

    for (const row of this.rows) {
      for (const cell of row.cells) {
        if (!cell.letter) continue;
        const letter = this.normalizeInputLetter(cell.letter);
        const current = map[letter] ?? 'unset';
        if (priority[cell.state] > priority[current]) {
          map[letter] = cell.state;
        }
      }
    }

    return map;
  }

  get timeRemainingLabel(): string {
    if (
      this.roomState?.phase === 'in-game' &&
      this.roomState.round.status === 'running' &&
      this.roomState.settings.timeLimitSeconds === 0
    ) {
      return 'Ohne Limit';
    }

    const endsAt = this.roomState?.round.endsAt;
    if (!endsAt || this.roomState?.phase !== 'in-game' || this.roomState.round.status !== 'running') {
      return '--:--';
    }

    const remaining = Math.max(0, Math.ceil((endsAt - this.nowTimestamp) / 1000));
    const minutes = Math.floor(remaining / 60)
      .toString()
      .padStart(2, '0');
    const seconds = (remaining % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  get isUrgentRoundTimerVisible(): boolean {
    if (this.roomState?.phase !== 'in-game' || this.roomState.round.status !== 'running' || !this.roomState.round.endsAt) {
      return false;
    }

    return Math.ceil((this.roomState.round.endsAt - this.nowTimestamp) / 1000) <= 10;
  }

  get urgentRoundTimerLabel(): string {
    if (!this.isUrgentRoundTimerVisible || !this.roomState?.round.endsAt) {
      return '';
    }

    return String(Math.max(0, Math.ceil((this.roomState.round.endsAt - this.nowTimestamp) / 1000)));
  }

  get myPlayerName(): string {
    return this.playerList.find((player) => player.id === this.playerId)?.name ?? 'Ich';
  }

  get canHostStartRound(): boolean {
    if (!this.isHost || !this.roomState) {
      return false;
    }

    return (
      (this.roomState.phase === 'lobby' && this.roomState.round.status !== 'countdown') || this.roomState.phase === 'finished'
    );
  }

  onKeyboardKey(key: string): void {
    this.actionError = '';
    this.serverError = '';
    this.multiplayer.clearServerError();
    this.clearInvalidWordMessage();
    this.clearRowError();

    const row = this.rows[this.activeRow];
    if (!row || row.locked || !this.isGameInputEnabled) return;

    if (key === 'Enter') {
      this.onSubmit(new Event('submit'));
      return;
    }

    const start = this.activeRow * this.currentWordLength;
    const end = start + this.currentWordLength;
    const rowInputs = this.gameScreen?.letterInputs?.toArray().slice(start, end) ?? [];
    if (!rowInputs.length) {
      return;
    }

    if (key === 'Backspace') {
      const lastFilledIndex = [...rowInputs]
        .map((input) => input.nativeElement.value)
        .map((value, index) => ({ value, index }))
        .filter((entry) => entry.value)
        .pop()?.index;

      if (lastFilledIndex === undefined) return;

      rowInputs[lastFilledIndex].nativeElement.value = '';
      row.cells[lastFilledIndex].letter = '';
      rowInputs[lastFilledIndex].nativeElement.focus();
      return;
    }

    if (!/^[a-zäöüß]$/i.test(key)) return;

    const emptyIndex = rowInputs.findIndex((input) => !input.nativeElement.value);
    if (emptyIndex === -1) return;

    const nextValue = this.normalizeInputLetter(key);
    rowInputs[emptyIndex].nativeElement.value = nextValue;
    row.cells[emptyIndex].letter = nextValue;

    const nextInput = rowInputs[emptyIndex + 1];
    if (nextInput) {
      nextInput.nativeElement.focus();
    }
  }

  async onCreateRoom(): Promise<void> {
    if (!this.playerName.trim()) {
      this.actionError = 'Bitte gib einen Spielernamen ein.';
      return;
    }

    this.actionError = '';
    this.serverError = '';
    this.isBusy = true;
    this.unlockAndSyncAudio();

    try {
      const response = await this.multiplayer.createRoom({
        playerName: this.playerName,
        settings: this.currentLobbySettingsPayload(),
      });
      this.playerId = response.playerId;
      this.roomId = response.roomId;
      this.reconnectSecret = response.reconnectSecret;
      this.storePlayerName(this.playerName);
      this.storeRoomSession(response.roomId, response.playerId, response.reconnectSecret);
      this.suppressNextRouteAutoJoin = true;
      await this.router.navigate(['/room', response.roomId], { replaceUrl: true });
      this.applyRoomState(response.state);
    } catch (error) {
      this.actionError = error instanceof Error ? error.message : 'Raum konnte nicht erstellt werden.';
    } finally {
      this.isBusy = false;
    }
  }

  async onJoinRoom(): Promise<void> {
    if (!this.playerName.trim()) {
      this.actionError = 'Bitte gib einen Spielernamen ein.';
      return;
    }

    if (!this.joinCode.trim()) {
      this.actionError = 'Bitte gib einen Raumcode ein.';
      return;
    }

    this.actionError = '';
    this.serverError = '';
    this.isBusy = true;
    this.unlockAndSyncAudio();

    const normalizedJoinCode = this.normalizeRoomCode(this.joinCode);

    try {
      const canReconnect =
        this.roomId === normalizedJoinCode && !!this.playerId.trim() && !!this.reconnectSecret.trim();
      const reconnectPlayerId = canReconnect ? this.playerId : '';
      const response = await this.multiplayer.joinRoom({
        roomId: this.joinCode,
        playerName: this.playerName,
        reconnectPlayerId: reconnectPlayerId || undefined,
        reconnectSecret: canReconnect ? this.reconnectSecret : undefined,
      });
      this.playerId = response.playerId;
      this.roomId = response.roomId;
      this.reconnectSecret = response.reconnectSecret;
      this.storePlayerName(this.playerName);
      this.storeRoomSession(response.roomId, response.playerId, response.reconnectSecret);
      this.requiresNameForRoomLink = false;
      this.pendingRoomIdFromLink = '';
      this.suppressNextRouteAutoJoin = true;
      await this.router.navigate(['/room', response.roomId], { replaceUrl: true });
      this.applyRoomState(response.state);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Raumbeitritt fehlgeschlagen.';
      this.actionError = message;

      const isLinkJoin = !!this.pendingRoomIdFromLink && normalizedJoinCode === this.pendingRoomIdFromLink;
      const roomNotFound = /room not found/i.test(message);
      if (isLinkJoin && roomNotFound) {
        this.requiresNameForRoomLink = false;
        this.pendingRoomIdFromLink = '';
        this.clearRoomSession();
        await this.router.navigate(['/'], { replaceUrl: true });
      }
    } finally {
      this.isBusy = false;
    }
  }

  async onUpdateLobbySettings(): Promise<void> {
    if (!this.roomState || !this.isHost) {
      return;
    }

    this.actionError = '';
    this.isBusy = true;

    try {
      await this.multiplayer.updateSettings({
        roomId: this.roomState.id,
        playerId: this.playerId,
        settings: this.currentLobbySettingsPayload(),
      });
    } catch (error) {
      this.actionError = error instanceof Error ? error.message : 'Einstellungen konnten nicht gespeichert werden.';
    } finally {
      this.isBusy = false;
    }
  }

  async onStartRound(): Promise<void> {
    if (!this.roomState || !this.isHost) {
      return;
    }

    this.actionError = '';
    this.isBusy = true;
    this.unlockAndSyncAudio();

    try {
      const roomId = this.roomState.id;
      const playerId = this.playerId;

      // Keep start behavior robust: use the current lobby form values even when
      // the host starts directly without pressing "Einstellungen speichern" first.
      await this.multiplayer.updateSettings({
        roomId,
        playerId,
        settings: this.currentLobbySettingsPayload(),
      });

      await this.multiplayer.startRound({ roomId, playerId });
    } catch (error) {
      this.actionError = error instanceof Error ? error.message : 'Runde konnte nicht gestartet werden.';
    } finally {
      this.isBusy = false;
    }
  }

  async onEndRound(): Promise<void> {
    if (!this.roomState || !this.isHost) {
      return;
    }

    const roundIsActive = this.roomState.round.status === 'countdown' || this.roomState.round.status === 'running';
    if (!roundIsActive) {
      return;
    }

    this.actionError = '';
    this.isBusy = true;

    try {
      await this.multiplayer.endRound({
        roomId: this.roomState.id,
        playerId: this.playerId,
      });
    } catch (error) {
      this.actionError = error instanceof Error ? error.message : 'Runde konnte nicht beendet werden.';
    } finally {
      this.isBusy = false;
    }
  }

  async onKickPlayer(targetPlayerId: PlayerId): Promise<void> {
    if (!this.roomState || !this.isHost || !targetPlayerId) {
      return;
    }

    this.actionError = '';
    this.isBusy = true;

    try {
      await this.multiplayer.kickPlayer({
        roomId: this.roomState.id,
        hostPlayerId: this.playerId,
        targetPlayerId,
      });
    } catch (error) {
      this.actionError = error instanceof Error ? error.message : 'Spieler konnte nicht entfernt werden.';
    } finally {
      this.isBusy = false;
    }
  }

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.roomState || !this.isGameInputEnabled) return;

    const start = this.activeRow * this.currentWordLength;
    const end = start + this.currentWordLength;

    const rowInputs = this.gameScreen?.letterInputs?.toArray().slice(start, end) ?? [];
    if (!rowInputs.length) {
      return;
    }

    if (rowInputs.some((input) => !input.nativeElement.value)) {
      return;
    }

    const submittedText = rowInputs.map((input) => input.nativeElement.value).join('');

    try {
      const response = await this.multiplayer.submitGuess({
        roomId: this.roomState.id,
        playerId: this.playerId,
        word: submittedText,
      });

      this.applyGuessResult(response.result, submittedText);
      this.playGuessResultSound(response.result);

      const solved = response.result.every((cell) => cell.state === 'correct');
      if (solved) {
        return;
      }

      if (this.activeRow + 1 >= this.currentMaxGuesses) {
        return;
      }

      this.appendEmptyRow();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unbekannter Fehler.';
      if (message.includes('allowed list')) {
        this.showInvalidWordFeedback(rowInputs);
        return;
      }
      this.actionError = message;
    }
  }

  onReturnToLobby(): void {
    if (this.roomState?.phase === 'in-game') {
      this.preferLobbyDuringGame = true;
    }
    if (this.roomState?.phase === 'finished') {
      this.preferLobbyAfterFinish = true;
    }
    this.showWinPopup = false;
    this.mode = 'lobby';
  }

  onReturnToGame(): void {
    if (this.roomState?.phase !== 'in-game') {
      return;
    }

    this.preferLobbyDuringGame = false;
    this.mode = 'game';
    this.scheduleLayoutUpdate();
  }

  async onLeaveLobby(): Promise<void> {
    const roomId = this.roomId;
    const playerId = this.playerId;

    this.isBusy = true;

    try {
      if (roomId && playerId) {
        await this.multiplayer.leaveRoom({ roomId, playerId });
      }
    } catch {
      try {
        this.multiplayer.disconnectSocket();
      } catch {
        // ignore errors and continue with local cleanup
      }
    }

    this.mode = 'entry';
    this.roomId = '';
    this.playerId = '';
    this.reconnectSecret = '';
    this.roomState = null;
    this.currentRoundId = '';
    this.preferLobbyDuringGame = false;
    this.preferLobbyAfterFinish = false;
    this.showWinPopup = false;
    this.gameOver = false;
    this.isBusy = false;
    this.serverError = '';
    this.actionError = '';
    this.joinCode = '';
    this.pendingRoomIdFromLink = '';
    this.requiresNameForRoomLink = false;
    this.suppressNextRouteAutoJoin = false;
    this.clearTicker();
    this.clearInvalidWordMessage();
    this.clearProgressFlashes();
    this.clearCountdownAudio();
    this.clearRoomSession();
    this.multiplayer.clearServerError();
    this.multiplayer.clearKickedNotice();
    this.resetRows(this.settingsForm.wordLength);
    this.cdr.detectChanges();
    await this.router.navigate(['/'], { replaceUrl: true });
  }

  async onJoinLinkedRoom(): Promise<void> {
    if (!this.pendingRoomIdFromLink) {
      return;
    }

    this.joinCode = this.pendingRoomIdFromLink;
    await this.onJoinRoom();
  }

  get showRoomLinkNamePrompt(): boolean {
    return this.mode === 'entry' && this.requiresNameForRoomLink;
  }

  get pendingRoomCodeForPrompt(): string {
    return this.pendingRoomIdFromLink;
  }

  getProgressCells(playerId: PlayerId): ProgressCellState[] {
    const progress = this.getPlayerProgress(playerId);
    if (!progress) {
      return Array.from({ length: this.currentWordLength }, () => 'unset');
    }
    return progress.cells.map((cell) => cell.state);
  }

  getPlayerGuessUsageLabel(playerId: PlayerId): string {
    const guessesUsed = this.getPlayerProgress(playerId)?.guessesUsed ?? 0;
    return `${guessesUsed}/${this.currentMaxGuesses}`;
  }

  isCurrentPlayer(playerId: PlayerId): boolean {
    return playerId === this.playerId;
  }

  isPlayerExhausted(playerId: PlayerId): boolean {
    return !!this.getPlayerProgress(playerId)?.exhausted;
  }

  isProgressCellFlashing(playerId: PlayerId, index: number): boolean {
    return this.progressFlashingCells.has(this.progressCellKey(playerId, index));
  }

  private applyRoomState(state: RoomStateSnapshot): void {
    if (!this.playerId) {
      const storedSession = this.getStoredRoomSession();
      if (storedSession && storedSession.roomId === state.id) {
        this.playerId = storedSession.playerId;
        this.reconnectSecret = storedSession.reconnectSecret;
      }
    }

    const previousState = this.roomState;
    this.roomState = state;
    this.roomId = state.id;
    if (this.playerId) {
      this.storeRoomSession(state.id, this.playerId, this.reconnectSecret);
    }
    this.settingsForm.wordLength = state.settings.wordLength;
    this.settingsForm.maxGuesses = state.settings.maxGuesses;
    this.settingsForm.timeLimitSeconds = state.settings.timeLimitSeconds;

    this.detectProgressFlashes(previousState, state);
  this.unlockAndSyncAudio();

    if (this.currentRoundId !== state.round.id) {
      this.currentRoundId = state.round.id;
      this.finishedAudioRoundId = '';
      this.resetRows(state.settings.wordLength);
      this.showWinPopup = false;
      this.clearProgressFlashes();
    }

    if (state.round.status === 'countdown') {
      this.preferLobbyDuringGame = false;
      this.preferLobbyAfterFinish = false;
      this.mode = 'lobby';
      this.showWinPopup = false;
      this.gameOver = false;
      this.startTicker();
      this.scheduleLayoutUpdate();
      return;
    }

    if (state.phase === 'lobby') {
      this.preferLobbyDuringGame = false;
      this.preferLobbyAfterFinish = false;
      this.mode = 'lobby';
      this.showWinPopup = false;
      this.gameOver = false;
      this.clearProgressFlashes();
      this.clearTicker();
      this.resetRows(state.settings.wordLength);
      return;
    }

    const keepLobbyView =
      (state.phase === 'in-game' && this.preferLobbyDuringGame) ||
      (state.phase === 'finished' && (this.preferLobbyAfterFinish || this.preferLobbyDuringGame));
    this.mode = keepLobbyView ? 'lobby' : 'game';

    if (state.phase === 'in-game' && state.round.status === 'running') {
      this.preferLobbyAfterFinish = false;
      this.startTicker();
      this.gameOver = false;
    }

    if (state.phase === 'finished') {
      this.gameOver = true;
      this.clearTicker();
      this.showWinPopup = !(this.preferLobbyAfterFinish || this.preferLobbyDuringGame);
      const winner = state.players.find((player) => player.id === state.round.winnerPlayerId);
      if (winner) {
        this.winMessage = `${winner.name} hat die Runde gewonnen.`;
      } else if (state.round.status === 'timeout') {
        this.winMessage = 'Zeit abgelaufen. Runde beendet.';
      } else {
        this.winMessage = 'Runde beendet.';
      }

      if (this.showWinPopup) {
        this.playFinishedRoundSequence(state);
      }
    }

    this.scheduleLayoutUpdate();
  }

  private applyGuessResult(result: GuessCell[], submittedText: string): void {
    const row = this.rows[this.activeRow];
    if (!row) {
      return;
    }

    for (let index = 0; index < result.length; index++) {
      row.cells[index].letter = this.normalizeInputLetter(submittedText[index] ?? '');
      row.cells[index].state = result[index].state;
    }

    row.locked = true;
  }

  private appendEmptyRow(): void {
    this.rows.push({
      locked: false,
      enter: true,
      cells: Array.from({ length: this.currentWordLength }, () => ({ letter: '', state: 'unset' })),
    });
    this.activeRow++;

    setTimeout(() => {
      const newRow = this.rows[this.activeRow];
      if (newRow) {
        newRow.enter = false;
      }
      this.scheduleLayoutUpdate();
    }, 320);

    this.pendingFocusIndex = this.activeRow * this.currentWordLength;
    setTimeout(() => {
      if (this.pendingFocusIndex !== null) {
        this.focusByIndex(this.pendingFocusIndex);
        this.pendingFocusIndex = null;
      }
      this.scrollToBottomIfNeeded();
      this.scheduleLayoutUpdate();
    }, 0);
  }

  private resetRows(wordLength: number): void {
    this.rows = [
      {
        locked: false,
        cells: Array.from({ length: wordLength }, () => ({ letter: '', state: 'unset' })),
      },
    ];
    this.activeRow = 0;
    this.baseWordleHeight = 0;
    this.wordleOverflowY = 'hidden';

    this.pendingFocusIndex = 0;
    setTimeout(() => {
      this.focusByIndex(0);
      this.scheduleLayoutUpdate();
    }, 0);
  }

  private focusByIndex(index: number): void {
    this.gameScreen?.letterInputs?.get(index)?.nativeElement.focus();
  }

  private scrollToBottomIfNeeded(): void {
    const container = this.gameScreen?.lettersContainer?.nativeElement;
    if (!container) return;
    if (container.scrollHeight <= container.clientHeight) return;
    container.scrollTop = container.scrollHeight;
  }

  private bindLetterInputChanges(): void {
    this.letterInputChangesSubscription?.unsubscribe();
    this.letterInputChangesSubscription = null;

    const letterInputs = this.gameScreen?.letterInputs;
    if (!letterInputs) {
      return;
    }

    this.letterInputChangesSubscription = letterInputs.changes.subscribe(() => {
      if (this.pendingFocusIndex === null) return;
      this.focusByIndex(this.pendingFocusIndex);
      this.pendingFocusIndex = null;
      this.scheduleLayoutUpdate();
    });
  }

  private showInvalidWordFeedback(rowInputs: ElementRef<HTMLInputElement>[]): void {
    const row = this.rows[this.activeRow];
    if (!row) return;

    this.clearInvalidWordMessage();
    this.clearRowError();
    this.errorRowIndex = this.activeRow;
    row.error = true;
    this.triggerRowShake(row);
    this.invalidWordMessage = 'Kein gueltiges Wort.';

    if (this.invalidWordShowTimeout) {
      clearTimeout(this.invalidWordShowTimeout);
    }

    this.invalidWordShowTimeout = setTimeout(() => {
      this.invalidWordVisible = true;
      this.scheduleLayoutUpdate();
    }, 0);

    setTimeout(() => {
      this.clearRow(rowInputs, row);
    }, 420);

    if (this.invalidWordTimeout) {
      clearTimeout(this.invalidWordTimeout);
    }

    this.invalidWordTimeout = setTimeout(() => {
      this.invalidWordMessage = '';
      this.invalidWordVisible = false;
      this.clearRowError();
      this.invalidWordTimeout = null;
      this.scheduleLayoutUpdate();
    }, 2300);
  }

  private clearRow(rowInputs: ElementRef<HTMLInputElement>[], row: Row): void {
    rowInputs.forEach((input, index) => {
      input.nativeElement.value = '';
      row.cells[index].letter = '';
      row.cells[index].state = 'unset';
    });
    rowInputs[0]?.nativeElement.focus();
  }

  private clearInvalidWordMessage(): void {
    if (this.invalidWordTimeout) {
      clearTimeout(this.invalidWordTimeout);
      this.invalidWordTimeout = null;
    }
    if (this.invalidWordShowTimeout) {
      clearTimeout(this.invalidWordShowTimeout);
      this.invalidWordShowTimeout = null;
    }

    this.invalidWordMessage = '';
    this.invalidWordVisible = false;
    this.clearRowError();
  }

  private clearRowError(): void {
    const index = this.errorRowIndex;
    if (index === null) return;
    const row = this.rows[index];
    if (!row) return;
    row.error = false;
    row.shake = false;
    this.errorRowIndex = null;
  }

  private normalizeInputLetter(letter: string): string {
    if (letter === 'ß' || letter === 'ẞ') return 'ß';
    return letter.toLocaleUpperCase('de-DE');
  }

  private triggerRowShake(row: Row): void {
    if (this.rowShakeStartTimeout) {
      clearTimeout(this.rowShakeStartTimeout);
    }
    if (this.rowShakeEndTimeout) {
      clearTimeout(this.rowShakeEndTimeout);
    }

    row.shake = false;
    this.rowShakeStartTimeout = setTimeout(() => {
      row.shake = true;
      this.scheduleLayoutUpdate();
    }, 0);
    this.rowShakeEndTimeout = setTimeout(() => {
      row.shake = false;
      this.scheduleLayoutUpdate();
    }, 340);
  }

  private scheduleLayoutUpdate(): void {
    if (this.layoutRaf !== null) {
      cancelAnimationFrame(this.layoutRaf);
    }
    this.layoutRaf = requestAnimationFrame(() => {
      this.layoutRaf = null;
      this.updateDynamicLayout();
      this.cdr.detectChanges();
    });
  }

  private updateDynamicLayout(): void {
    const form = this.gameScreen?.gameForm?.nativeElement;
    const lettersContainer = this.gameScreen?.lettersContainer?.nativeElement;
    const keyboard = this.gameScreen?.keyboardHost?.nativeElement;
    const rows = this.gameScreen?.letterRows?.nativeElement;
    const statusRow = this.gameScreen?.statusRow?.nativeElement;
    if (!form || !lettersContainer || !keyboard || !rows || !statusRow) return;

    const stageHeight = form.clientHeight;
    const keyboardHeight = keyboard.offsetHeight;
    const statusRowHeight = statusRow.offsetHeight;
    const containerStyle = window.getComputedStyle(lettersContainer);
    const paddingTop = Number.parseFloat(containerStyle.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(containerStyle.paddingBottom) || 0;
    // scrollHeight is stable across transform animations (row-enter) and avoids
    // transient overflow measurements that would briefly show a scrollbar.
    const rowsHeight = rows.scrollHeight;
    const naturalWordleHeight = rowsHeight + paddingTop + paddingBottom;

    if (this.baseWordleHeight === 0) {
      this.baseWordleHeight = naturalWordleHeight;
    }

    const initialBlockHeight =
      this.baseWordleHeight + statusRowHeight + keyboardHeight + this.rowToKeyboardGap;
    const initialTopOffset = Math.max(0, (stageHeight - initialBlockHeight) / 2);
    const growth = Math.max(0, naturalWordleHeight - this.baseWordleHeight);

    // Grow the visible input+keyboard block in both directions: half of the
    // added row height is consumed by top slack, the other half moves downward.
    this.topOffset = Math.max(0, Math.floor(initialTopOffset - growth / 2));

    const maxHeight =
      stageHeight - keyboardHeight - statusRowHeight - this.rowToKeyboardGap - this.topOffset;
    this.wordleMaxHeight = Math.max(60, Math.floor(maxHeight));

    const overflowDelta = naturalWordleHeight - this.wordleMaxHeight;
    if (this.wordleOverflowY === 'auto') {
      if (overflowDelta <= this.overflowDisableThresholdPx) {
        this.wordleOverflowY = 'hidden';
      }
    } else if (overflowDelta >= this.overflowEnableThresholdPx) {
      this.wordleOverflowY = 'auto';
    }

    this.wordleHeight = Math.max(60, Math.min(Math.ceil(naturalWordleHeight + 1), this.wordleMaxHeight));
  }

  private startTicker(): void {
    this.nowTimestamp = Date.now();
    if (this.tickerInterval) {
      return;
    }

    this.tickerInterval = setInterval(() => {
      this.nowTimestamp = Date.now();
      this.cdr.detectChanges();
    }, 200);
  }

  private clearTicker(): void {
    if (!this.tickerInterval) {
      return;
    }

    clearInterval(this.tickerInterval);
    this.tickerInterval = null;
  }

  private clearTransientTimers(): void {
    if (this.invalidWordTimeout) {
      clearTimeout(this.invalidWordTimeout);
      this.invalidWordTimeout = null;
    }
    if (this.invalidWordShowTimeout) {
      clearTimeout(this.invalidWordShowTimeout);
      this.invalidWordShowTimeout = null;
    }
    if (this.rowShakeStartTimeout) {
      clearTimeout(this.rowShakeStartTimeout);
      this.rowShakeStartTimeout = null;
    }
    if (this.rowShakeEndTimeout) {
      clearTimeout(this.rowShakeEndTimeout);
      this.rowShakeEndTimeout = null;
    }
    if (this.layoutRaf !== null) {
      cancelAnimationFrame(this.layoutRaf);
      this.layoutRaf = null;
    }
    if (this.copyNoticeTimeout) {
      clearTimeout(this.copyNoticeTimeout);
      this.copyNoticeTimeout = null;
    }
    this.linkCopiedMessage = '';
    this.clearProgressFlashes();
  }

  private playGuessResultSound(result: GuessCell[]): void {
    const clipName = this.getGuessResultClipName(result);
    void this.audio.playClip(clipName);
  }

  private getGuessResultClipName(result: GuessCell[]): 'green-found' | 'yellow-found' | 'error' {
    if (result.some((cell) => cell.state === 'correct')) {
      return 'green-found';
    }

    if (result.some((cell) => cell.state === 'present')) {
      return 'yellow-found';
    }

    return 'error';
  }

  private playFinishedRoundSequence(state: RoomStateSnapshot): void {
    if (this.finishedAudioRoundId === state.round.id || !state.round.winnerPlayerId) {
      return;
    }

    const clipName = state.round.winnerPlayerId === this.playerId ? 'you_win' : 'you_lose';
    this.finishedAudioRoundId = state.round.id;
    void this.audio.playSequence(
      OverviewComponent.ROUND_FINISH_AUDIO_GROUP,
      ['congratulations', clipName],
      `${state.round.id}:${clipName}`,
    );
  }

  private unlockAndSyncAudio(): void {
    void this.audio.unlock().then(() => {
      if (!this.roomState) {
        return;
      }

      return this.syncCountdownAudio(this.roomState);
    });
  }

  private async syncCountdownAudio(state: RoomStateSnapshot): Promise<void> {
    if (state.round.status === 'countdown' && state.round.startedAt) {
      this.audio.cancelGroup(OverviewComponent.ROUND_TIMEOUT_AUDIO_GROUP);
      this.audio.cancelGroup(OverviewComponent.ROUND_END_COUNTDOWN_AUDIO_GROUP);
      await this.audio.scheduleNumberCountdown(
        OverviewComponent.LOBBY_COUNTDOWN_AUDIO_GROUP,
        5,
        state.round.startedAt,
      );
      return;
    }

    this.audio.cancelGroup(OverviewComponent.LOBBY_COUNTDOWN_AUDIO_GROUP);

    if (state.phase === 'in-game' && state.round.status === 'running' && state.round.endsAt) {
      await Promise.all([
        this.audio.scheduleNumberCountdown(
          OverviewComponent.ROUND_END_COUNTDOWN_AUDIO_GROUP,
          10,
          state.round.endsAt,
        ),
        this.audio.scheduleSequenceAt(
          OverviewComponent.ROUND_TIMEOUT_AUDIO_GROUP,
          ['time_over', 'you_lose'],
          state.round.endsAt,
          `${state.round.id}:${state.round.endsAt}:timeout`,
        ),
      ]);
      return;
    }

    this.audio.cancelGroup(OverviewComponent.ROUND_END_COUNTDOWN_AUDIO_GROUP);

    if (state.phase === 'finished' && state.round.status === 'timeout') {
      return;
    }

    this.audio.cancelGroup(OverviewComponent.ROUND_TIMEOUT_AUDIO_GROUP);
  }

  private clearCountdownAudio(): void {
    this.audio.cancelAll();
  }

  private detectProgressFlashes(previousState: RoomStateSnapshot | null, nextState: RoomStateSnapshot): void {
    if (!previousState) {
      return;
    }

    if (previousState.id !== nextState.id || previousState.round.id !== nextState.round.id) {
      return;
    }

    const previousProgressByPlayer = new Map(previousState.playerProgress.map((entry) => [entry.playerId, entry.cells]));

    for (const nextProgress of nextState.playerProgress) {
      const previousCells = previousProgressByPlayer.get(nextProgress.playerId);
      if (!previousCells) {
        continue;
      }

      for (let index = 0; index < nextProgress.cells.length; index++) {
        const previous = previousCells[index]?.state ?? 'unset';
        const current = nextProgress.cells[index]?.state ?? 'unset';

        const becameDiscovered = (current === 'present' || current === 'correct') && current !== previous;
        if (becameDiscovered) {
          this.flashProgressCell(nextProgress.playerId, index);
        }
      }
    }
  }

  private flashProgressCell(playerId: PlayerId, index: number): void {
    const key = this.progressCellKey(playerId, index);
    const existingTimeout = this.progressFlashTimeouts.get(key);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    this.progressFlashingCells.add(key);

    const timeout = setTimeout(() => {
      this.progressFlashingCells.delete(key);
      this.progressFlashTimeouts.delete(key);
      this.cdr.detectChanges();
    }, this.progressFlashDurationMs);

    this.progressFlashTimeouts.set(key, timeout);
  }

  private clearProgressFlashes(): void {
    for (const timeout of this.progressFlashTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.progressFlashTimeouts.clear();
    this.progressFlashingCells.clear();
  }

  private progressCellKey(playerId: PlayerId, index: number): string {
    return `${playerId}:${index}`;
  }

  private getPlayerProgress(playerId: PlayerId): PlayerRoundProgress | null {
    if (!playerId) {
      return null;
    }

    return this.roomState?.playerProgress.find((entry) => entry.playerId === playerId) ?? null;
  }

  private getProgressScore(progress: PlayerRoundProgress | null): number {
    if (!progress) {
      return 0;
    }

    return progress.cells.reduce((score, cell) => {
      if (cell.state === 'correct') {
        return score + 3;
      }

      if (cell.state === 'present') {
        return score + 1;
      }

      return score;
    }, 0);
  }

  private async joinLinkedRoom(roomId: string): Promise<void> {
    if (!roomId || !this.playerName.trim()) {
      return;
    }

    if (this.isBusy) {
      return;
    }

    if (this.roomState?.id === roomId && this.playerId && this.roomId === roomId) {
      return;
    }

    this.joinCode = roomId;
    await this.onJoinRoom();
  }

  async onCopyRoomLink(): Promise<void> {
    if (typeof window === 'undefined') return;

    const href = window.location.href || '';
    if (!href) return;

    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(href);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = href;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }

      if (this.copyNoticeTimeout) {
        clearTimeout(this.copyNoticeTimeout);
        this.copyNoticeTimeout = null;
      }
      this.linkCopiedMessage = 'Link kopiert.';
      this.copyNoticeTimeout = setTimeout(() => {
        this.linkCopiedMessage = '';
        this.copyNoticeTimeout = null;
        this.cdr.detectChanges();
      }, 1500);
      this.cdr.detectChanges();
    } catch {
      this.linkCopiedMessage = 'Link konnte nicht kopiert werden.';
      setTimeout(() => {
        this.linkCopiedMessage = '';
        this.cdr.detectChanges();
      }, 2500);
    }
  }

  private storePlayerName(playerName: string): void {
    if (typeof window === 'undefined') {
      return;
    }

    const trimmedName = playerName.trim();
    if (!trimmedName) {
      return;
    }

    window.localStorage.setItem(OverviewComponent.PLAYER_NAME_STORAGE_KEY, trimmedName);
  }

  private getStoredPlayerName(): string {
    if (typeof window === 'undefined') {
      return '';
    }

    return window.localStorage.getItem(OverviewComponent.PLAYER_NAME_STORAGE_KEY)?.trim() ?? '';
  }

  private storeRoomSession(roomId: string, playerId: string, reconnectSecret: string): void {
    if (typeof window === 'undefined') {
      return;
    }

    const normalizedRoomId = this.normalizeRoomCode(roomId);
    const normalizedPlayerId = playerId.trim();
    const normalizedReconnectSecret = reconnectSecret.trim();
    if (!normalizedRoomId || !normalizedPlayerId || !normalizedReconnectSecret) {
      return;
    }

    const payload: StoredRoomSession = {
      roomId: normalizedRoomId,
      playerId: normalizedPlayerId,
      reconnectSecret: normalizedReconnectSecret,
    };
    window.localStorage.setItem(OverviewComponent.ROOM_SESSION_STORAGE_KEY, JSON.stringify(payload));
  }

  private getStoredRoomSession(): StoredRoomSession | null {
    if (typeof window === 'undefined') {
      return null;
    }

    const raw = window.localStorage.getItem(OverviewComponent.ROOM_SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<StoredRoomSession>;
      const roomId = this.normalizeRoomCode(parsed.roomId ?? '');
      const playerId = (parsed.playerId ?? '').trim();
      const reconnectSecret = (parsed.reconnectSecret ?? '').trim();
      if (!roomId || !playerId || !reconnectSecret) {
        return null;
      }

      return { roomId, playerId, reconnectSecret };
    } catch {
      return null;
    }
  }

  private clearRoomSession(): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.removeItem(OverviewComponent.ROOM_SESSION_STORAGE_KEY);
  }

  private normalizeRoomCode(code: string): string {
    return code.trim().toLocaleUpperCase('de-DE');
  }

  private currentLobbySettingsPayload(): {
    wordLength: number;
    maxGuesses: number;
    timeLimitSeconds: number;
  } {
    return {
      wordLength: 5,
      maxGuesses: Math.round(Number(this.settingsForm.maxGuesses)),
      timeLimitSeconds: Math.round(Number(this.settingsForm.timeLimitSeconds)),
    };
  }

  private applyKickedState(message: string): void {
    const kickedRoomId = this.roomId || this.pendingRoomIdFromLink;
    this.mode = 'entry';
    this.roomId = '';
    this.playerId = '';
    this.reconnectSecret = '';
    this.roomState = null;
    this.currentRoundId = '';
    this.preferLobbyDuringGame = false;
    this.preferLobbyAfterFinish = false;
    this.showWinPopup = false;
    this.gameOver = false;
    this.isBusy = false;
    this.serverError = '';
    this.actionError = message;
    this.showKickedBanner(message);
    this.joinCode = '';
    this.pendingRoomIdFromLink = '';
    this.blockedAutoJoinRoomId = kickedRoomId;
    this.requiresNameForRoomLink = false;
    this.suppressNextRouteAutoJoin = false;
    this.clearTicker();
    this.clearInvalidWordMessage();
    this.clearProgressFlashes();
    this.clearCountdownAudio();
    this.clearRoomSession();
    this.multiplayer.disconnectSocket();
    this.multiplayer.clearServerError();
    this.multiplayer.clearKickedNotice();
    this.kickedDialogMessage = message;
    this.resetRows(this.settingsForm.wordLength);
    this.cdr.detectChanges();
    void this.router.navigate(['/'], { replaceUrl: true });
  }

  private showKickedBanner(message: string): void {
    this.clearKickedBanner();
    this.kickedBannerMessage = message;
    this.kickedBannerTimeout = setTimeout(() => {
      this.kickedBannerMessage = '';
      this.kickedBannerTimeout = null;
      this.cdr.detectChanges();
    }, 5500);
  }

  private clearKickedBanner(): void {
    if (this.kickedBannerTimeout) {
      clearTimeout(this.kickedBannerTimeout);
      this.kickedBannerTimeout = null;
    }
    this.kickedBannerMessage = '';
  }

  acknowledgeKickedDialog(): void {
    if (!this.kickedDialogMessage) return;
    this.kickedDialogMessage = '';
    this.cdr.detectChanges();
  }
}
