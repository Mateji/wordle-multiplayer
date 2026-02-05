import { AfterViewInit, Component, ElementRef, HostListener, OnInit, QueryList, ViewChild, ViewChildren } from '@angular/core';
import { SingleLetterDirective } from '../directives/single-letter-directive';
import { KeyboardComponent } from "../keyboard/keyboard.component";

@Component({
    selector: 'app-overview',
    imports: [SingleLetterDirective, KeyboardComponent],
    templateUrl: './overview.component.html',
    styleUrl: './overview.component.css',
})
export class OverviewComponent implements OnInit, AfterViewInit {
    @ViewChild('lettersContainer') lettersContainer?: ElementRef<HTMLElement>;
    @ViewChildren('letterInput') letterInputs!: QueryList<ElementRef<HTMLInputElement>>;

    rows: Row[] = [{ locked: false, cells: Array.from({ length: 5 }, () => ({ letter: '', state: 'unset' })) }];
    activeRow = 0;
    gameOver = false;

    private targetWord = '';
    private submittedText = '';

    private pendingFocusIndex: number | null = null;

    ngOnInit(): void {
        this.targetWord = 'apfel';
    }

    ngAfterViewInit(): void {
        this.focusByIndex(0);

        this.letterInputs.changes.subscribe(() => {
            if (this.pendingFocusIndex === null) return;
            this.focusByIndex(this.pendingFocusIndex);
            this.pendingFocusIndex = null;
        });
    }

    get keyStates(): Record<string, LetterState> {
        const priority: Record<LetterState, number> = {
            unset: 0,
            absent: 1,
            present: 2,
            correct: 3,
        };

        const map: Record<string, LetterState> = {};

        for (const row of this.rows) {
            for (const cell of row.cells) {
                if (!cell.letter) continue;
                const letter = cell.letter.toUpperCase();
                const current = map[letter] ?? 'unset';
                if (priority[cell.state] > priority[current]) {
                    map[letter] = cell.state;
                }
            }
        }

        return map;
    }

    onKeyboardKey(key: string): void {
        const row = this.rows[this.activeRow];
        if (!row || row.locked) return;

        if (key === 'Enter') {
            this.onSubmit(new Event('submit'));
            return;
        }

        const start = this.activeRow * 5;
        const end = start + 5;
        const rowInputs = this.letterInputs.toArray().slice(start, end);

        if (key === 'Backspace') {
            const lastFilledIndex = [...rowInputs]
                .map((input) => input.nativeElement.value)
                .map((value, index) => ({ value, index }))
                .filter((entry) => entry.value)
                .pop()?.index;

            if (lastFilledIndex === undefined) return;

            rowInputs[lastFilledIndex].nativeElement.value = '';
            row.cells[lastFilledIndex].letter = '';
            rowInputs[lastFilledIndex].nativeElement.focus();
            return;
        }

        if (!/^[a-zäöüß]$/i.test(key)) return;

        const emptyIndex = rowInputs.findIndex(
            (input) => !input.nativeElement.value
        );

        if (emptyIndex === -1) return;

        const nextValue = key.toLocaleUpperCase();
        rowInputs[emptyIndex].nativeElement.value = nextValue;
        row.cells[emptyIndex].letter = nextValue;

        const nextInput = rowInputs[emptyIndex + 1];
        if (nextInput) {
            nextInput.nativeElement.focus();
        }
    }

    @HostListener('document:keydown', ['$event'])
    onDocumentKeydown(event: KeyboardEvent): void {
        if (this.gameOver) return;

        const target = event.target as HTMLElement | null;
        if (target?.closest('input.letter')) return;

        if (event.ctrlKey || event.metaKey || event.altKey) return;

        if (event.key === 'Backspace') {
            event.preventDefault();
            this.onKeyboardKey('Backspace');
            return;
        }
 
        if (event.key === 'Enter') {
            event.preventDefault();
            this.onKeyboardKey('Enter');
            return;
        }
        
        if (/^[a-zäöüß]$/i.test(event.key)) {
            event.preventDefault();
            this.onKeyboardKey(event.key);
        }
    }

    onSubmit(event: Event) {
        event.preventDefault();
        if (this.gameOver) return;

        const start = this.activeRow * 5;
        const end = start + 5;

        const rowInputs = this.letterInputs.toArray().slice(start, end);
        if (rowInputs.some((input) => !input.nativeElement.value)) {
            return; // nicht submitten, wenn ein Feld leer ist
        }

        this.submittedText = rowInputs.map((input) => input.nativeElement.value).join('');

        this.submittedText = this.submittedText.toUpperCase();
        this.targetWord = this.targetWord.toUpperCase();

        for (let i = 0; i < 5; i++) {
            const cell = this.rows[this.activeRow].cells[i];
            const submittedLetter = this.submittedText[i];
            cell.letter = submittedLetter;
            if (submittedLetter === this.targetWord[i]) {
                cell.state = 'correct';
            } else if (this.targetWord.includes(submittedLetter)) {
                cell.state = 'present';
            } else {
                cell.state = 'absent';
            }
        }

        this.rows[this.activeRow].locked = true;

        if (this.submittedText === this.targetWord) {
            this.gameOver = true;
            setTimeout(() => this.resetGame(), 2000);
            return;
        }

        this.rows.push({
            locked: false,
            enter: true,
            cells: Array.from({ length: 5 }, () => ({ letter: '', state: 'unset' })),
        });
        this.activeRow++;

        setTimeout(() => {
            const newRow = this.rows[this.activeRow];
            if (newRow) newRow.enter = false;
        }, 320);

        this.pendingFocusIndex = this.activeRow * 5;

        setTimeout(() => {
            if (this.pendingFocusIndex !== null) {
                this.focusByIndex(this.pendingFocusIndex);
                this.pendingFocusIndex = null;
            }
        }, 0);
    }

    private focusByIndex(index: number): void {
        this.letterInputs.get(index)?.nativeElement.focus();
    }

    private resetGame(): void {
        this.rows = [{ locked: false, cells: Array.from({ length: 5 }, () => ({ letter: '', state: 'unset' })) }];
        this.activeRow = 0;
        this.submittedText = '';
        this.gameOver = false;

        this.targetWord = 'APFEL';

        this.pendingFocusIndex = 0;
        setTimeout(() => this.focusByIndex(0), 0);
    }

}


