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
  readonly version = 'v0.1.2';

  @Input() playerName = '';
  @Input() joinCode = '';
  @Input() showRoomLinkNamePrompt = false;
  @Input() pendingRoomCode = '';
  @Input() isBusy = false;
  @Input() settingsForm!: EntrySettings;

  @Output() readonly playerNameChange = new EventEmitter<string>();
  @Output() readonly joinCodeChange = new EventEmitter<string>();
  @Output() readonly joinSharedRoom = new EventEmitter<void>();
  @Output() readonly createRoom = new EventEmitter<void>();
  @Output() readonly joinRoom = new EventEmitter<void>();

  onPaste(event: ClipboardEvent): void {
    try {
      const clipboard = event.clipboardData?.getData('text') ?? '';
      const extracted = EntryScreenComponent.extractRoomCode(clipboard || '');
      if (extracted) {
        event.preventDefault();
        this.joinCodeChange.emit(extracted);
      }
    } catch {
      // ignore paste parsing errors and allow default behavior
    }
  }

  private static extractRoomCode(text: string): string {
    if (!text) return '';
    const trimmed = text.trim();

    // Try to extract from a /room/ path segment
    const roomSeg = trimmed.match(/\/room\/([^/?#\s]+)/i);
    if (roomSeg?.[1]) {
      return roomSeg[1].toUpperCase();
    }

    // Try to find a trailing alphanumeric token (4-12 chars)
    const tail = trimmed.match(/([A-Za-z0-9]{4,12})\b$/);
    if (tail?.[1]) {
      return tail[1].toUpperCase();
    }

    // Fallback: last 6 characters (common room length)
    const fallback = trimmed.replace(/[^A-Za-z0-9]/g, '');
    if (fallback.length >= 6) {
      return fallback.slice(-6).toUpperCase();
    }

    return '';
  }
}
