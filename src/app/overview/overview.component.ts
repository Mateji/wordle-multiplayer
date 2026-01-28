import { afterNextRender, AfterViewInit, Component, ElementRef, OnInit, QueryList, ViewChild, ViewChildren } from '@angular/core';
import { SingleLetterDirective } from '../directives/single-letter-directive';

type LetterState = 'correct' | 'present' | 'absent' | 'unset';

type Cell = {
    letter: string;
    state: LetterState;
};

type Row = {
    cells: Cell[];
    locked: boolean;
    enter?: boolean;
};

@Component({
    selector: 'app-overview',
    imports: [SingleLetterDirective],
    templateUrl: './overview.component.html',
    styleUrl: './overview.component.css',
})
export class OverviewComponent implements OnInit, AfterViewInit {
    @ViewChild('lettersContainer') lettersContainer?: ElementRef<HTMLElement>;
    @ViewChildren('letterInput') letterInputs!: QueryList<ElementRef<HTMLInputElement>>;

    rows: Row[] = [{ locked: false, cells: Array.from({ length: 5 }, () => ({ letter: '', state: 'unset' })) }];
    activeRow = 0;

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

    onSubmit(event: Event) {
        event.preventDefault();

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


}


