import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ChatMessage, PlayerId, PlayerSummary, RoomStateSnapshot } from '@wordle/shared';
import { ChatComponent } from '../chat/chat.component';

type LobbySettings = {
  wordLength: number;
  maxGuesses: number;
  timeLimitSeconds: number;
};

@Component({
  selector: 'app-lobby-screen',
  standalone: true,
  imports: [FormsModule, ChatComponent],
  templateUrl: './lobby-screen.component.html',
  styleUrl: './lobby-screen.component.css',
})
export class LobbyScreenComponent {
  @Input() roomState!: RoomStateSnapshot;
  @Input() playerList: PlayerSummary[] = [];
  @Input() currentPlayerId = '';
  @Input() isHost = false;
  @Input() isBusy = false;
  @Input() settingsForm!: LobbySettings;
  @Input() chatMessages: ChatMessage[] = [];
  @Input() chatError = '';
  @Input() isSendingChatMessage = false;

  get isRoundRunning(): boolean {
    return this.roomState?.phase === 'in-game' && this.roomState.round.status === 'running';
  }

  get isRoundStarting(): boolean {
    return this.roomState?.round.status === 'countdown';
  }

  get isSettingsDisabled(): boolean {
    return !this.isHost || this.isBusy || this.isRoundRunning || this.isRoundStarting;
  }

  @Output() readonly updateLobbySettings = new EventEmitter<void>();
  @Output() readonly startRound = new EventEmitter<void>();
  @Output() readonly endRound = new EventEmitter<void>();
  @Output() readonly copyRoomLink = new EventEmitter<void>();
  @Output() readonly returnToGame = new EventEmitter<void>();
  @Output() readonly leaveLobby = new EventEmitter<void>();
  @Output() readonly kickPlayer = new EventEmitter<PlayerId>();
  @Output() readonly sendChatMessage = new EventEmitter<string>();
}
