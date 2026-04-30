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
import type { GuessCell, PlayerId, PlayerSummary, ProgressCellState, RoomStateSnapshot } from '@wordle/shared';
import { Subscription } from 'rxjs';
import type { LetterState, Row } from '../models';
import { MultiplayerService } from '../services/multiplayer.service';
import { EntryScreenComponent } from './entry-screen.component';
import { GameScreenComponent } from './game-screen.component';
import { LobbyScreenComponent } from './lobby-screen.component';

type ViewMode = 'entry' | 'lobby' | 'game';

type StoredRoomSession = {
  roomId: string;
  playerId: string;
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
  wordleMaxHeight = 9999;

  nowTimestamp = Date.now();

  private subscriptions = new Subscription();
  private readonly multiplayer = inject(MultiplayerService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private pendingFocusIndex: number | null = null;
  private baseWordleHeight = 0;
  private readonly rowToKeyboardGap = 12;
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
  private kickedBannerTimeout: ReturnType<typeof setTimeout> | null = null;
  kickedDialogMessage = '';
  linkCopiedMessage = '';
  private copyNoticeTimeout: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.playerName = this.getStoredPlayerName();
    const storedSession = this.getStoredRoomSession();
    if (storedSession) {
      this.roomId = storedSession.roomId;
      this.playerId = storedSession.playerId;
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

        // Show a blocking dialog to the kicked player; only navigate back when they acknowledge.
        this.kickedDialogMessage = message;
        this.cdr.detectChanges();
      }),
    );

    this.subscriptions.add(
      this.route.paramMap.subscribe((params) => {
        const linkedRoomId = this.normalizeRoomCode(params.get('roomId') ?? '');
        this.pendingRoomIdFromLink = linkedRoomId;
        this.joinCode = linkedRoomId;

        const linkedRoomSession = this.getStoredRoomSession();
        if (linkedRoomSession && linkedRoomSession.roomId === linkedRoomId) {
          this.roomId = linkedRoomSession.roomId;
          this.playerId = linkedRoomSession.playerId;
        }

        if (linkedRoomId) {
          try {
            const serverBase = `${window.location.protocol}//${window.location.hostname}:3001`;
            void fetch(`${serverBase}/rooms/${linkedRoomId}`, { method: 'GET' })
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

        if (this.suppressNextRouteAutoJoin && this.roomId === linkedRoomId) {
          this.suppressNextRouteAutoJoin = false;
          this.requiresNameForRoomLink = false;
          return;
        }

        if (this.playerId && this.roomId === linkedRoomId) {
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
    this.clearTransientTimers();
    this.clearTicker();
    this.clearKickedBanner();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.scheduleLayoutUpdate();
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
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
    return this.mode === 'game' && this.roomState?.phase === 'in-game' && this.roomState.round.status === 'running';
  }

  get playerList(): PlayerSummary[] {
    return this.roomState?.players ?? [];
  }

  get currentWordLength(): number {
    return this.roomState?.settings.wordLength ?? this.settingsForm.wordLength;
  }

  get currentMaxGuesses(): number {
    return this.roomState?.settings.maxGuesses ?? this.settingsForm.maxGuesses;
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
    if (this.roomState?.phase === 'in-game' && this.roomState.settings.timeLimitSeconds === 0) {
      return 'Ohne Limit';
    }

    const endsAt = this.roomState?.round.endsAt;
    if (!endsAt || this.roomState?.phase !== 'in-game') {
      return '--:--';
    }

    const remaining = Math.max(0, Math.ceil((endsAt - this.nowTimestamp) / 1000));
    const minutes = Math.floor(remaining / 60)
      .toString()
      .padStart(2, '0');
    const seconds = (remaining % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  get myPlayerName(): string {
    return this.playerList.find((player) => player.id === this.playerId)?.name ?? 'Ich';
  }

  get canHostStartRound(): boolean {
    if (!this.isHost || !this.roomState) {
      return false;
    }

    return this.roomState.phase === 'lobby' || this.roomState.phase === 'finished';
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

    try {
      const response = await this.multiplayer.createRoom({
        playerName: this.playerName,
        settings: {
          wordLength: this.settingsForm.wordLength,
          maxGuesses: this.settingsForm.maxGuesses,
          timeLimitSeconds: this.settingsForm.timeLimitSeconds,
        },
      });
      this.playerId = response.playerId;
      this.roomId = response.roomId;
      this.storePlayerName(this.playerName);
      this.storeRoomSession(response.roomId, response.playerId);
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

    const normalizedJoinCode = this.normalizeRoomCode(this.joinCode);

    try {
      const reconnectPlayerId = this.roomId === normalizedJoinCode ? this.playerId : '';
      const response = await this.multiplayer.joinRoom({
        roomId: this.joinCode,
        playerName: this.playerName,
        reconnectPlayerId: reconnectPlayerId || undefined,
      });
      this.playerId = response.playerId;
      this.roomId = response.roomId;
      this.storePlayerName(this.playerName);
      this.storeRoomSession(response.roomId, response.playerId);
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
        settings: {
          wordLength: this.settingsForm.wordLength,
          maxGuesses: this.settingsForm.maxGuesses,
          timeLimitSeconds: this.settingsForm.timeLimitSeconds,
        },
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

    try {
      await this.multiplayer.startRound({ roomId: this.roomState.id, playerId: this.playerId });
    } catch (error) {
      this.actionError = error instanceof Error ? error.message : 'Runde konnte nicht gestartet werden.';
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

  async onPlayAgain(): Promise<void> {
    if (!this.roomState || !this.isHost) {
      this.actionError = 'Nur der Host kann eine neue Runde starten.';
      return;
    }

    this.actionError = '';

    try {
      await this.multiplayer.startNewGame({
        roomId: this.roomState.id,
        playerId: this.playerId,
      });
      this.showWinPopup = false;
    } catch (error) {
      this.actionError = error instanceof Error ? error.message : 'Neue Runde konnte nicht gestartet werden.';
    }
  }

  onCloseWinPopup(): void {
    this.showWinPopup = false;
  }

  async onNewGame(): Promise<void> {
    if (this.roomState && this.isHost) {
      await this.onPlayAgain();
      return;
    }

    this.mode = 'entry';
    this.roomId = '';
    this.playerId = '';
    this.roomState = null;
    this.currentRoundId = '';
    this.showWinPopup = false;
    this.gameOver = false;
    this.actionError = '';
    this.serverError = '';
    this.clearInvalidWordMessage();
    this.clearProgressFlashes();
    this.resetRows(this.settingsForm.wordLength);
    this.requiresNameForRoomLink = false;
    this.pendingRoomIdFromLink = '';
    this.clearRoomSession();
    await this.router.navigate(['/'], { replaceUrl: true });
  }

  async onLeaveLobby(): Promise<void> {
    // Try to inform server that we leave the room so it can update other clients immediately.
    try {
      if (this.roomId && this.playerId) {
        this.multiplayer.disconnectSocket();
      }
    } catch {
      // ignore errors and continue with local cleanup
    }

    this.mode = 'entry';
    this.roomId = '';
    this.playerId = '';
    this.roomState = null;
    this.currentRoundId = '';
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
    const progress = this.roomState?.playerProgress.find((entry) => entry.playerId === playerId);
    if (!progress) {
      return Array.from({ length: this.currentWordLength }, () => 'unset');
    }
    return progress.cells.map((cell) => cell.state);
  }

  isCurrentPlayer(playerId: PlayerId): boolean {
    return playerId === this.playerId;
  }

  isProgressCellFlashing(playerId: PlayerId, index: number): boolean {
    return this.progressFlashingCells.has(this.progressCellKey(playerId, index));
  }

  private applyRoomState(state: RoomStateSnapshot): void {
    if (!this.playerId) {
      const storedSession = this.getStoredRoomSession();
      if (storedSession && storedSession.roomId === state.id) {
        this.playerId = storedSession.playerId;
      }
    }

    const previousState = this.roomState;
    this.roomState = state;
    this.roomId = state.id;
    if (this.playerId) {
      this.storeRoomSession(state.id, this.playerId);
    }
    this.settingsForm.wordLength = state.settings.wordLength;
    this.settingsForm.maxGuesses = state.settings.maxGuesses;
    this.settingsForm.timeLimitSeconds = state.settings.timeLimitSeconds;

    this.detectProgressFlashes(previousState, state);

    if (state.phase === 'lobby') {
      this.mode = 'lobby';
      this.showWinPopup = false;
      this.gameOver = false;
      this.clearProgressFlashes();
      this.clearTicker();
      this.resetRows(state.settings.wordLength);
      return;
    }

    this.mode = 'game';

    if (this.currentRoundId !== state.round.id) {
      this.currentRoundId = state.round.id;
      this.resetRows(state.settings.wordLength);
      this.showWinPopup = false;
      this.clearProgressFlashes();
    }

    if (state.phase === 'in-game' && state.round.status === 'running') {
      this.startTicker();
      this.gameOver = false;
    }

    if (state.phase === 'finished') {
      this.gameOver = true;
      this.clearTicker();
      this.showWinPopup = true;
      const winner = state.players.find((player) => player.id === state.round.winnerPlayerId);
      if (winner) {
        this.winMessage = `${winner.name} hat die Runde gewonnen.`;
      } else if (state.round.status === 'timeout') {
        this.winMessage = 'Zeit abgelaufen. Runde beendet.';
      } else {
        this.winMessage = 'Runde beendet.';
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
      if (newRow) newRow.enter = false;
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
    const keyboard = this.gameScreen?.keyboardHost?.nativeElement;
    const rows = this.gameScreen?.letterRows?.nativeElement;
    if (!form || !keyboard || !rows) return;

    const stageHeight = form.clientHeight;
    const keyboardHeight = keyboard.offsetHeight;
    const naturalWordleHeight = rows.scrollHeight + 12;

    if (this.baseWordleHeight === 0) {
      this.baseWordleHeight = naturalWordleHeight;
    }

    const initialTopOffset = Math.max(
      0,
      (stageHeight - (this.baseWordleHeight + keyboardHeight + this.rowToKeyboardGap)) / 2,
    );

    const growth = Math.max(0, naturalWordleHeight - this.baseWordleHeight);
    this.topOffset = Math.max(0, initialTopOffset - growth);

    const maxHeight = stageHeight - keyboardHeight - this.rowToKeyboardGap - this.topOffset;
    this.wordleMaxHeight = Math.max(60, Math.ceil(maxHeight) + 4);
  }

  private startTicker(): void {
    if (this.tickerInterval) {
      return;
    }

    this.tickerInterval = setInterval(() => {
      this.nowTimestamp = Date.now();
      this.cdr.detectChanges();
    }, 500);
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

  private async joinLinkedRoom(roomId: string): Promise<void> {
    if (!roomId || !this.playerName.trim()) {
      return;
    }

    if (this.isBusy) {
      return;
    }

    if ((this.roomState?.id === roomId && this.playerId) || (this.roomId === roomId && this.playerId)) {
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

  private storeRoomSession(roomId: string, playerId: string): void {
    if (typeof window === 'undefined') {
      return;
    }

    const normalizedRoomId = this.normalizeRoomCode(roomId);
    const normalizedPlayerId = playerId.trim();
    if (!normalizedRoomId || !normalizedPlayerId) {
      return;
    }

    const payload: StoredRoomSession = {
      roomId: normalizedRoomId,
      playerId: normalizedPlayerId,
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
      if (!roomId || !playerId) {
        return null;
      }

      return { roomId, playerId };
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

  private async handleKicked(message: string): Promise<void> {
    this.mode = 'entry';
    this.roomId = '';
    this.playerId = '';
    this.roomState = null;
    this.currentRoundId = '';
    this.showWinPopup = false;
    this.gameOver = false;
    this.isBusy = false;
    this.serverError = '';
    this.actionError = message;
    this.showKickedBanner(message);
    this.joinCode = '';
    this.pendingRoomIdFromLink = '';
    this.requiresNameForRoomLink = false;
    this.suppressNextRouteAutoJoin = false;
    this.clearTicker();
    this.clearInvalidWordMessage();
    this.clearProgressFlashes();
    this.clearRoomSession();
    this.multiplayer.clearServerError();
    this.multiplayer.clearKickedNotice();
    this.resetRows(this.settingsForm.wordLength);
    this.cdr.detectChanges();
    await this.router.navigate(['/'], { replaceUrl: true });
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

  async acknowledgeKickedDialog(): Promise<void> {
    if (!this.kickedDialogMessage) return;
    const message = this.kickedDialogMessage;
    // Use the existing cleanup/navigation for kicked players
    await this.handleKicked(message);
    this.kickedDialogMessage = '';
    this.cdr.detectChanges();
  }
}
