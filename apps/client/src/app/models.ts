export type LetterState = 'correct' | 'present' | 'absent' | 'unset';

export type Cell = {
  letter: string;
  state: LetterState;
};

export type Row = {
  cells: Cell[];
  locked: boolean;
  enter?: boolean;
  error?: boolean;
  shake?: boolean;
};
