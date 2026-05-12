import { Injectable, inject } from '@angular/core';
import type { ChatMessage } from '@wordle/shared';
import { BehaviorSubject, Subscription } from 'rxjs';
import { MultiplayerService } from './multiplayer.service';

@Injectable({
  providedIn: 'root',
})
export class ChatStoreService {
  private readonly multiplayer = inject(MultiplayerService);
  private readonly subscriptions = new Subscription();

  private readonly messagesSubject = new BehaviorSubject<ChatMessage[]>([]);
  private readonly errorSubject = new BehaviorSubject<string>('');
  private readonly historyByRoomCode = new Map<string, ChatMessage[]>();
  private activeRoomCode = '';

  readonly messages$ = this.messagesSubject.asObservable();
  readonly error$ = this.errorSubject.asObservable();

  constructor() {
    this.subscriptions.add(
      this.multiplayer.roomState$.subscribe((roomState) => {
        const nextRoomCode = roomState?.id ?? '';
        if (!nextRoomCode) {
          this.activeRoomCode = '';
          this.messagesSubject.next([]);
          this.errorSubject.next('');
          return;
        }

        if (this.activeRoomCode !== nextRoomCode) {
          this.activeRoomCode = nextRoomCode;
          this.messagesSubject.next([...(this.historyByRoomCode.get(nextRoomCode) ?? [])]);
          this.errorSubject.next('');
        }
      }),
    );

    this.subscriptions.add(
      this.multiplayer.chatHistory$.subscribe((payload) => {
        const normalizedMessages = this.mergeMessages([], payload.messages);
        this.historyByRoomCode.set(payload.roomCode, normalizedMessages);

        if (!payload.roomCode || payload.roomCode !== this.activeRoomCode) {
          return;
        }

        this.messagesSubject.next(normalizedMessages);
      }),
    );

    this.subscriptions.add(
      this.multiplayer.chatMessageAdded$.subscribe((message) => {
        if (!message.roomCode) {
          return;
        }

        const roomHistory = this.historyByRoomCode.get(message.roomCode) ?? [];
        const nextRoomHistory = this.mergeMessages(roomHistory, [message]);
        this.historyByRoomCode.set(message.roomCode, nextRoomHistory);

        if (message.roomCode !== this.activeRoomCode) {
          return;
        }

        this.messagesSubject.next(this.mergeMessages(this.messagesSubject.value, [message]));
      }),
    );

    this.subscriptions.add(
      this.multiplayer.chatError$.subscribe((error) => {
        this.errorSubject.next(error.message || 'Chat-Nachricht konnte nicht gesendet werden.');
      }),
    );
  }

  async sendMessage(text: string): Promise<void> {
    const normalizedText = text.trim();
    if (!normalizedText) {
      return;
    }

    this.errorSubject.next('');
    const message = await this.multiplayer.sendChatMessage({ text: normalizedText });

    if (!message.roomCode) {
      return;
    }

    const roomHistory = this.historyByRoomCode.get(message.roomCode) ?? [];
    const nextRoomHistory = this.mergeMessages(roomHistory, [message]);
    this.historyByRoomCode.set(message.roomCode, nextRoomHistory);

    if (message.roomCode === this.activeRoomCode) {
      this.messagesSubject.next(this.mergeMessages(this.messagesSubject.value, [message]));
    }
  }

  clearError(): void {
    this.errorSubject.next('');
  }

  private mergeMessages(existingMessages: ChatMessage[], incomingMessages: ChatMessage[]): ChatMessage[] {
    const messagesById = new Map(existingMessages.map((message) => [message.messageId, message]));

    for (const incomingMessage of incomingMessages) {
      messagesById.set(incomingMessage.messageId, incomingMessage);
    }

    return [...messagesById.values()].sort((left, right) => left.createdAt - right.createdAt);
  }
}