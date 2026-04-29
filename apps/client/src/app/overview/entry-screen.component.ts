import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

type EntrySettings = {
  wordLength: number;
  maxGuesses: number;
  timeLimitSeconds: number;
};

@Component({
  selector: 'app-entry-screen',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './entry-screen.component.html',
  styleUrl: './entry-screen.component.css',
})
export class EntryScreenComponent {
  @Input() playerName = '';
  @Input() joinCode = '';
  @Input() isBusy = false;
  @Input() settingsForm!: EntrySettings;

  @Output() readonly playerNameChange = new EventEmitter<string>();
  @Output() readonly joinCodeChange = new EventEmitter<string>();
  @Output() readonly createRoom = new EventEmitter<void>();
  @Output() readonly joinRoom = new EventEmitter<void>();
}
