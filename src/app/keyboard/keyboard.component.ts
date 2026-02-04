import { Component } from '@angular/core';

@Component({
    selector: 'app-keyboard',
    imports: [],
    templateUrl: './keyboard.component.html',
    styleUrl: './keyboard.component.css',
})
export class KeyboardComponent {
    keys = [
        ['Q', 'W', 'E', 'R', 'T', 'Z', 'U', 'I', 'O', 'P', 'Ü',],
        ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ö', 'Ä',],
        ['Enter', 'Y', 'X', 'C', 'V', 'B', 'N', 'M', 'Backspace'],
    ];
}
