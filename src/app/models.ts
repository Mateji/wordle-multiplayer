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
