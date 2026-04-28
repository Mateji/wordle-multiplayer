import { Component, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SingleLetterDirective } from './single-letter-directive';

@Component({
  standalone: true,
  imports: [SingleLetterDirective],
  template: `
    <div class="letter-container">
      <input class="letter" appSingleLetter />
      <input class="letter" appSingleLetter />
      <input class="letter" appSingleLetter />
    </div>
  `,
})
class HostComponent {}

describe('SingleLetterDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let inputs: HTMLInputElement[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    inputs = Array.from(fixture.nativeElement.querySelectorAll('input.letter'));
  });

  function dispatchKeydown(target: HTMLInputElement, key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  }

  it('sets one normalized letter and moves focus to next input', () => {
    inputs[0].focus();

    const event = dispatchKeydown(inputs[0], 'a');

    expect(event.defaultPrevented).toBeTrue();
    expect(inputs[0].value).toBe('A');
    expect(document.activeElement).toBe(inputs[1]);
  });

  it('keeps sharp s as lowercase ß', () => {
    inputs[0].focus();

    dispatchKeydown(inputs[0], 'ß');

    expect(inputs[0].value).toBe('ß');
  });

  it('prevents non-letter key input', () => {
    inputs[0].focus();

    const event = dispatchKeydown(inputs[0], '1');

    expect(event.defaultPrevented).toBeTrue();
    expect(inputs[0].value).toBe('');
    expect(document.activeElement).toBe(inputs[0]);
  });

  it('moves to previous input with ArrowLeft', () => {
    inputs[1].focus();

    const event = dispatchKeydown(inputs[1], 'ArrowLeft');

    expect(event.defaultPrevented).toBeTrue();
    expect(document.activeElement).toBe(inputs[0]);
  });

  it('Backspace clears current value without moving when current input has content', () => {
    inputs[1].value = 'B';
    inputs[1].focus();

    const event = dispatchKeydown(inputs[1], 'Backspace');

    expect(event.defaultPrevented).toBeTrue();
    expect(inputs[1].value).toBe('');
    expect(document.activeElement).toBe(inputs[1]);
  });

  it('Backspace on empty field clears previous input and moves focus back', () => {
    inputs[0].value = 'A';
    inputs[1].value = '';
    inputs[1].focus();

    const event = dispatchKeydown(inputs[1], 'Backspace');

    expect(event.defaultPrevented).toBeTrue();
    expect(inputs[0].value).toBe('');
    expect(document.activeElement).toBe(inputs[0]);
  });

  it('input event keeps only first valid letter and normalizes it', () => {
    inputs[0].focus();
    inputs[0].value = 'ab1';

    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    expect(inputs[0].value).toBe('A');
    expect(document.activeElement).toBe(inputs[1]);
  });
});
