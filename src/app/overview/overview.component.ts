import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, OnInit, QueryList, ViewChild, ViewChildren, inject } from '@angular/core';
import { SingleLetterDirective } from '../directives/single-letter-directive';
import { KeyboardComponent } from "../keyboard/keyboard.component";
import { TargetWord } from '../services/target-word';
import SimpleBar from 'simplebar';

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
    showWinPopup = false;
    winTries = 0;
    invalidWordMessage = '';
    invalidWordVisible = false;

    private targetWord = '';
    private submittedText = '';
    private wordList: string[] = [];
    private targetWordsByLength = new Map<number, string[]>();
    private allowedWordsByLength = new Map<number, Set<string>>();
    private invalidWordTimeout: ReturnType<typeof setTimeout> | null = null;
    private invalidWordShowTimeout: ReturnType<typeof setTimeout> | null = null;
    private errorRowIndex: number | null = null;
    private rowShakeStartTimeout: ReturnType<typeof setTimeout> | null = null;
    private rowShakeEndTimeout: ReturnType<typeof setTimeout> | null = null;

    private readonly targetWordService = inject(TargetWord);
    private readonly cdr = inject(ChangeDetectorRef);

    private simpleBar?: SimpleBar;

    private pendingFocusIndex: number | null = null;

    ngOnInit(): void {
        this.targetWordService.getTargetWords().subscribe((words) => {
            this.wordList = words;
            this.indexTargetWords(words);
            this.pickRandomTargetWord();
        });

        this.targetWordService.getAllowedWords().subscribe((words) => {
            this.indexAllowedWords(words);
        });
    }

    ngAfterViewInit(): void {
        if (this.lettersContainer?.nativeElement) {
            this.simpleBar = new SimpleBar(this.lettersContainer.nativeElement, {
                autoHide: true,
            });
        }
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
                const letter = this.normalizeKeyLetter(cell.letter);
                const current = map[letter] ?? 'unset';
                if (priority[cell.state] > priority[current]) {
                    map[letter] = cell.state;
                }
            }
        }

        return map;
    }

    onKeyboardKey(key: string): void {
        this.clearInvalidWordMessage();
        this.clearRowError();

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

        const nextValue = this.normalizeInputLetter(key);
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
        if (!this.targetWord) return;

        const start = this.activeRow * 5;
        const end = start + 5;

        const rowInputs = this.letterInputs.toArray().slice(start, end);
        if (rowInputs.some((input) => !input.nativeElement.value)) {
            return; // nicht submitten, wenn ein Feld leer ist
        }

        this.submittedText = rowInputs.map((input) => input.nativeElement.value).join('');
        if (!this.isAllowedWord(this.submittedText)) {
            this.showInvalidWordFeedback(rowInputs);
            return;
        }

        const submittedNormalized = this.submittedText.toLocaleLowerCase('de-DE');
        const targetNormalized = this.targetWord.toLocaleLowerCase('de-DE');

        for (let i = 0; i < 5; i++) {
            const cell = this.rows[this.activeRow].cells[i];
            const submittedLetter = this.submittedText[i];
            const normalizedLetter = submittedNormalized[i];
            cell.letter = submittedLetter;
            if (normalizedLetter === targetNormalized[i]) {
                cell.state = 'correct';
            } else if (targetNormalized.includes(normalizedLetter)) {
                cell.state = 'present';
            } else {
                cell.state = 'absent';
            }
        }

        this.rows[this.activeRow].locked = true;

        if (submittedNormalized === targetNormalized) {
            this.gameOver = true;
            this.winTries = this.activeRow + 1;
            this.showWinPopup = true;
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
            this.scrollToBottomIfNeeded();
        }, 0);
    }

    private focusByIndex(index: number): void {
        this.letterInputs.get(index)?.nativeElement.focus();
    }

    private scrollToBottomIfNeeded(): void {
        const container = this.lettersContainer?.nativeElement;
        if (!container) return;
        const scrollTarget = container.querySelector<HTMLElement>('.simplebar-content-wrapper') ?? container;
        if (scrollTarget.scrollHeight <= scrollTarget.clientHeight) return;
        scrollTarget.scrollTop = scrollTarget.scrollHeight;
    }

    private resetGame(): void {
        this.rows = [{ locked: false, cells: Array.from({ length: 5 }, () => ({ letter: '', state: 'unset' })) }];
        this.activeRow = 0;
        this.submittedText = '';
        this.gameOver = false;
        this.showWinPopup = false;
        this.winTries = 0;
        this.clearInvalidWordMessage();

        this.pickRandomTargetWord();

        this.pendingFocusIndex = 0;
        setTimeout(() => this.focusByIndex(0), 0);
    }

    onPlayAgain(): void {
        this.resetGame();
    }

    onCloseWinPopup(): void {
        this.showWinPopup = false;
    }

    private pickRandomTargetWord(): void {
        const length = this.getCurrentWordLength();
        const words = this.targetWordsByLength.get(length) ?? [];
        if (!words.length) {
            this.targetWord = '';
            return;
        }
        const index = Math.floor(Math.random() * words.length);
        this.targetWord = words[index];
    }

    private getCurrentWordLength(): number {
        return this.rows[0]?.cells.length ?? 5;
    }

    private indexTargetWords(words: string[]): void {
        this.targetWordsByLength.clear();
        for (const word of words) {
            const length = word.length;
            const bucket = this.targetWordsByLength.get(length) ?? [];
            bucket.push(word);
            this.targetWordsByLength.set(length, bucket);
        }
    }

    private indexAllowedWords(words: string[]): void {
        this.allowedWordsByLength.clear();
        for (const word of words) {
            const length = word.length;
            const normalized = word.toLocaleLowerCase('de-DE');
            const bucket = this.allowedWordsByLength.get(length) ?? new Set<string>();
            bucket.add(normalized);
            this.allowedWordsByLength.set(length, bucket);
        }
    }

    private isAllowedWord(word: string): boolean {
        const length = word.length;
        const bucket = this.allowedWordsByLength.get(length);
        if (!bucket) return false;
        return bucket.has(word.toLocaleLowerCase('de-DE'));
    }

    private showInvalidWordFeedback(rowInputs: ElementRef<HTMLInputElement>[]): void {
        const row = this.rows[this.activeRow];
        if (!row) return;

        const message = 'Kein gueltiges Wort.';
        this.clearInvalidWordMessage();
        this.clearRowError();
        this.errorRowIndex = this.activeRow;
        row.error = true;
        this.triggerRowShake(row);
        this.invalidWordMessage = message;
        this.invalidWordVisible = false;

        if (this.invalidWordShowTimeout) {
            clearTimeout(this.invalidWordShowTimeout);
        }
        this.invalidWordShowTimeout = setTimeout(() => {
            this.invalidWordVisible = true;
            this.cdr.detectChanges();
        }, 0);

        setTimeout(() => {
            this.clearRow(rowInputs, row);
        }, 420);

        if (this.invalidWordTimeout) {
            clearTimeout(this.invalidWordTimeout);
        }
        this.invalidWordTimeout = setTimeout(() => {
            this.invalidWordMessage = '';
            this.invalidWordVisible = false;
            this.clearRowError();
            this.invalidWordTimeout = null;
            this.cdr.detectChanges();
        }, 2300);
    }

    private clearRow(rowInputs: ElementRef<HTMLInputElement>[], row: Row): void {
        rowInputs.forEach((input, index) => {
            input.nativeElement.value = '';
            row.cells[index].letter = '';
            row.cells[index].state = 'unset';
        });
        rowInputs[0]?.nativeElement.focus();
    }

    private clearInvalidWordMessage(): void {
        if (this.invalidWordTimeout) {
            clearTimeout(this.invalidWordTimeout);
            this.invalidWordTimeout = null;
        }
        if (this.invalidWordShowTimeout) {
            clearTimeout(this.invalidWordShowTimeout);
            this.invalidWordShowTimeout = null;
        }
        this.invalidWordMessage = '';
        this.invalidWordVisible = false;
        this.clearRowError();
        this.cdr.detectChanges();
    }

    private clearRowError(): void {
        const index = this.errorRowIndex;
        if (index === null) return;
        const row = this.rows[index];
        if (!row) return;
        row.error = false;
        row.shake = false;
        this.errorRowIndex = null;
    }

    private normalizeInputLetter(letter: string): string {
        if (letter === 'ß' || letter === 'ẞ') return 'ß';
        return letter.toLocaleUpperCase('de-DE');
    }

    private normalizeKeyLetter(letter: string): string {
        if (letter === 'ß' || letter === 'ẞ') return 'ß';
        return letter.toLocaleUpperCase('de-DE');
    }

    private triggerRowShake(row: Row): void {
        if (this.rowShakeStartTimeout) {
            clearTimeout(this.rowShakeStartTimeout);
        }
        if (this.rowShakeEndTimeout) {
            clearTimeout(this.rowShakeEndTimeout);
        }

        row.shake = false;
        this.rowShakeStartTimeout = setTimeout(() => {
            row.shake = true;
            this.cdr.detectChanges();
        }, 0);
        this.rowShakeEndTimeout = setTimeout(() => {
            row.shake = false;
            this.cdr.detectChanges();
        }, 340);
    }

}


