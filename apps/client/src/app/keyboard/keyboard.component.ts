import { Component, input, output } from '@angular/core';

@Component({
    selector: 'app-keyboard',
    imports: [],
    templateUrl: './keyboard.component.html',
    styleUrl: './keyboard.component.css',
})
export class KeyboardComponent {
    readonly keyStates = input<Record<string, LetterState>>({});
    readonly keyPressed = output<string>();

    keys = [
        ['Q', 'W', 'E', 'R', 'T', 'Z', 'U', 'I', 'O', 'P', 'Ü', 'ß'],
        ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ö', 'Ä',],
        ['Enter', 'Y', 'X', 'C', 'V', 'B', 'N', 'M', 'Backspace'],
    ];

    getState(key: string): LetterState | null {
        if (key === 'Enter' || key === 'Backspace') {
            return null;
        }
        return this.keyStates()[key] ?? 'unset';
    }

    onKeyClick(key: string): void {
        this.keyPressed.emit(key);
    }
}
