import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { PlayerId, PlayerSummary, RoomStateSnapshot } from '@wordle/shared';

type LobbySettings = {
  wordLength: number;
  maxGuesses: number;
  timeLimitSeconds: number;
};

@Component({
  selector: 'app-lobby-screen',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './lobby-screen.component.html',
  styleUrl: './lobby-screen.component.css',
})
export class LobbyScreenComponent {
  @Input() roomState!: RoomStateSnapshot;
  @Input() playerList: PlayerSummary[] = [];
  @Input() isHost = false;
  @Input() isBusy = false;
  @Input() settingsForm!: LobbySettings;

  @Output() readonly updateLobbySettings = new EventEmitter<void>();
  @Output() readonly startRound = new EventEmitter<void>();
  @Output() readonly copyRoomLink = new EventEmitter<void>();
  @Output() readonly leaveLobby = new EventEmitter<void>();
  @Output() readonly kickPlayer = new EventEmitter<PlayerId>();
}
