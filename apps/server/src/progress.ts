import type { GuessCell, GuessEntry, PlayerRoundProgress } from '@wordle/shared';

export function deriveProgressCells(
  guesses: GuessEntry[],
  wordLength: number,
): PlayerRoundProgress['cells'] {
  const maxMatchedByLetter = new Map<string, number>();
  const correctPositionsByLetter = new Map<string, Set<number>>();

  for (const guess of guesses) {
    const matchedInGuess = new Map<string, number>();

    for (let index = 0; index < guess.cells.length; index++) {
      const cell = guess.cells[index];
      if (cell.state === 'correct') {
        let positions = correctPositionsByLetter.get(cell.letter);
        if (!positions) {
          positions = new Set<number>();
          correctPositionsByLetter.set(cell.letter, positions);
        }
        positions.add(index);
      }

      if (cell.state !== 'correct' && cell.state !== 'present') {
        continue;
      }

      matchedInGuess.set(cell.letter, (matchedInGuess.get(cell.letter) ?? 0) + 1);
    }

    for (const [letter, count] of matchedInGuess) {
      const current = maxMatchedByLetter.get(letter) ?? 0;
      if (count > current) {
        maxMatchedByLetter.set(letter, count);
      }
    }
  }

  const allLetters = new Set<string>([
    ...maxMatchedByLetter.keys(),
    ...correctPositionsByLetter.keys(),
  ]);

  let correctCount = 0;
  let totalDiscovered = 0;
  for (const letter of allLetters) {
    const correctForLetter = correctPositionsByLetter.get(letter)?.size ?? 0;
    const matchedForLetter = maxMatchedByLetter.get(letter) ?? 0;
    correctCount += correctForLetter;
    totalDiscovered += Math.max(correctForLetter, matchedForLetter);
  }

  const boundedCorrect = clamp(correctCount, 0, wordLength);
  const boundedTotal = clamp(Math.max(totalDiscovered, boundedCorrect), boundedCorrect, wordLength);
  const presentCount = boundedTotal - boundedCorrect;

  return createProgressCells(boundedCorrect, presentCount, wordLength);
}

export function evaluateGuess(guess: string, target: string): GuessCell[] {
  const cells: GuessCell[] = guess.split('').map((letter) => ({ letter, state: 'absent' }));
  const remaining = target.split('');

  for (let index = 0; index < guess.length; index++) {
    if (guess[index] === target[index]) {
      cells[index].state = 'correct';
      remaining[index] = '\u0000';
    }
  }

  for (let index = 0; index < guess.length; index++) {
    if (cells[index].state === 'correct') {
      continue;
    }
    const matchIndex = remaining.indexOf(guess[index]);
    if (matchIndex !== -1) {
      cells[index].state = 'present';
      remaining[matchIndex] = '\u0000';
    }
  }

  return cells;
}

function createProgressCells(
  correctCount: number,
  presentCount: number,
  totalLength: number,
): PlayerRoundProgress['cells'] {
  const nextCells = [] as PlayerRoundProgress['cells'];

  for (let index = 0; index < totalLength; index++) {
    if (index < correctCount) {
      nextCells.push({ state: 'correct' });
      continue;
    }
    if (index < correctCount + presentCount) {
      nextCells.push({ state: 'present' });
      continue;
    }
    nextCells.push({ state: 'unset' });
  }

  return nextCells;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}