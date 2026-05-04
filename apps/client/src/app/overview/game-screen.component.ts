import { Component, ElementRef, EventEmitter, Input, Output, QueryList, ViewChild, ViewChildren } from '@angular/core';
import type { PlayerId, PlayerSummary, ProgressCellState, RoomStateSnapshot } from '@wordle/shared';
import { SingleLetterDirective } from '../directives/single-letter-directive';
import { KeyboardComponent } from '../keyboard/keyboard.component';
import type { LetterState, Row } from '../models';

@Component({
  selector: 'app-game-screen',
  standalone: true,
  imports: [SingleLetterDirective, KeyboardComponent],
  templateUrl: './game-screen.component.html',
  styleUrl: './game-screen.component.css',
})
export class GameScreenComponent {
  @Input() roomState!: RoomStateSnapshot;
  @Input() playerList: PlayerSummary[] = [];
  @Input() playerId = '';
  @Input() timeRemainingLabel = '--:--';
  @Input() myPlayerName = 'Ich';
  @Input() rows: Row[] = [];
  @Input() keyStates: Record<string, LetterState> = {};
  @Input() isGameInputEnabled = false;
  @Input() invalidWordVisible = false;
  @Input() invalidWordMessage = '';
  @Input() topOffset = 0;
  @Input() wordleHeight = 0;
  @Input() wordleMaxHeight = 9999;
  @Input() wordleOverflowY: 'hidden' | 'auto' = 'hidden';
  @Input() getProgressCells!: (playerId: PlayerId) => ProgressCellState[];
  @Input() isCurrentPlayer!: (playerId: PlayerId) => boolean;
  @Input() isProgressCellFlashing!: (playerId: PlayerId, index: number) => boolean;

  @Output() readonly keyPressed = new EventEmitter<string>();
  @Output() readonly submitted = new EventEmitter<Event>();
  @Output() readonly returnToLobby = new EventEmitter<void>();
  @Output() readonly newGame = new EventEmitter<void>();

  @ViewChild('gameForm') gameForm?: ElementRef<HTMLElement>;
  @ViewChild('lettersContainer') lettersContainer?: ElementRef<HTMLElement>;
  @ViewChild('letterRows') letterRows?: ElementRef<HTMLElement>;
  @ViewChild('statusRow') statusRow?: ElementRef<HTMLElement>;
  @ViewChild('keyboardHost', { read: ElementRef }) keyboardHost?: ElementRef<HTMLElement>;
  @ViewChildren('letterInput') letterInputs!: QueryList<ElementRef<HTMLInputElement>>;
}
