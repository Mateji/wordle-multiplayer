import { DatePipe } from '@angular/common';
import { AfterViewChecked, Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ChatMessage } from '@wordle/shared';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [FormsModule, DatePipe],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.css',
})
export class ChatComponent implements AfterViewChecked {
  @Input() title = 'Raum-Chat';
  @Input() messages: ChatMessage[] = [];
  @Input() currentPlayerId = '';
  @Input() errorMessage = '';
  @Input() isSending = false;
  @Output() readonly sendMessage = new EventEmitter<string>();

  @ViewChild('messageList') private messageList?: ElementRef<HTMLElement>;

  draftMessage = '';
  private lastVisibleMessageId = '';

  ngAfterViewChecked(): void {
    const latestMessageId = this.messages.at(-1)?.messageId ?? '';
    if (!latestMessageId || latestMessageId === this.lastVisibleMessageId) {
      return;
    }

    this.lastVisibleMessageId = latestMessageId;
    const messageListElement = this.messageList?.nativeElement;
    if (!messageListElement) {
      return;
    }

    messageListElement.scrollTop = messageListElement.scrollHeight;
  }

  onSubmit(): void {
    const normalizedText = this.draftMessage.trim();
    if (!normalizedText || this.isSending) {
      return;
    }

    this.sendMessage.emit(normalizedText);
    this.draftMessage = '';
  }

  isOwnMessage(message: ChatMessage): boolean {
    return !!this.currentPlayerId && message.playerId === this.currentPlayerId;
  }
}
