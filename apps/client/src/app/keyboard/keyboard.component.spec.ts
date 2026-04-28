import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { KeyboardComponent } from './keyboard.component';

describe('KeyboardComponent', () => {
  let component: KeyboardComponent;
  let fixture: ComponentFixture<KeyboardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [KeyboardComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(KeyboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('returns null for Enter and Backspace state', () => {
    expect(component.getState('Enter')).toBeNull();
    expect(component.getState('Backspace')).toBeNull();
  });

  it('returns unset for unknown letter state', () => {
    expect(component.getState('A')).toBe('unset');
  });

  it('returns configured state for a letter', () => {
    fixture.componentRef.setInput('keyStates', { A: 'correct' });
    fixture.detectChanges();

    expect(component.getState('A')).toBe('correct');
  });

  it('emits keyPressed once on button click', () => {
    const emitSpy = jasmine.createSpy('emit');
    component.keyPressed.subscribe(emitSpy);

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.key');
    button.click();

    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith('Q');
  });
});
