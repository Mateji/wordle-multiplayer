import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { RoomStateSnapshot } from '@wordle/shared';
import { BehaviorSubject } from 'rxjs';
import { MultiplayerService } from '../services/multiplayer.service';
import { OverviewComponent } from './overview.component';

class MultiplayerServiceStub {
  readonly roomState$ = new BehaviorSubject<RoomStateSnapshot | null>(null).asObservable();
  readonly serverError$ = new BehaviorSubject<string>('').asObservable();

  clearServerError(): void {}

  async createRoom(): Promise<never> {
    throw new Error('not implemented in tests');
  }

  async joinRoom(): Promise<never> {
    throw new Error('not implemented in tests');
  }

  async updateSettings(): Promise<never> {
    throw new Error('not implemented in tests');
  }

  async startRound(): Promise<never> {
    throw new Error('not implemented in tests');
  }

  async submitGuess(): Promise<never> {
    throw new Error('not implemented in tests');
  }

  async startNewGame(): Promise<never> {
    throw new Error('not implemented in tests');
  }
}

describe('Overview', () => {
  let component: OverviewComponent;
  let fixture: ComponentFixture<OverviewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OverviewComponent],
      providers: [provideZonelessChangeDetection(), { provide: MultiplayerService, useClass: MultiplayerServiceStub }],
    }).compileComponents();

    fixture = TestBed.createComponent(OverviewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
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
      players: [{ id: 'p1', name: 'Tester', connected: true }],
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
      players: [{ id: 'p1', name: 'Tester', connected: true }],
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
      players: [{ id: 'p1', name: 'Tester', connected: true }],
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
});
