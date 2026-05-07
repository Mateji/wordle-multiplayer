import assert from 'node:assert/strict';
import test from 'node:test';
import type { GuessEntry } from '@wordle/shared';
import { deriveProgressCells, evaluateGuess } from '../src/progress.js';

function createGuess(playerId: string, word: string, target: string, submittedAt = Date.now()): GuessEntry {
  return {
    playerId,
    word,
    cells: evaluateGuess(word, target),
    submittedAt,
  };
}

test('accumulates newly discovered letters across separate guesses', () => {
  const guesses = [
    createGuess('player-1', 'PILOT', 'OBELS', 1),
    createGuess('player-1', 'ERNST', 'OBELS', 2),
  ];

  assert.deepEqual(
    deriveProgressCells(guesses, 5).map((cell) => cell.state),
    ['present', 'present', 'present', 'present', 'unset'],
  );
});

test('upgrades a present discovery to correct without leaving an extra yellow cell behind', () => {
  const guesses = [
    createGuess('player-1', 'PILOT', 'OBELS', 1),
    createGuess('player-1', 'OOOOO', 'OBELS', 2),
  ];

  assert.deepEqual(
    deriveProgressCells(guesses, 5).map((cell) => cell.state),
    ['correct', 'present', 'unset', 'unset', 'unset'],
  );
});

test('keeps separately confirmed duplicate correct letters counted across guesses', () => {
  const guesses: GuessEntry[] = [
    {
      playerId: 'player-1',
      word: 'AXXXX',
      submittedAt: 1,
      cells: [
        { letter: 'A', state: 'correct' },
        { letter: 'X', state: 'absent' },
        { letter: 'X', state: 'absent' },
        { letter: 'X', state: 'absent' },
        { letter: 'X', state: 'absent' },
      ],
    },
    {
      playerId: 'player-1',
      word: 'XAXXX',
      submittedAt: 2,
      cells: [
        { letter: 'X', state: 'absent' },
        { letter: 'A', state: 'correct' },
        { letter: 'X', state: 'absent' },
        { letter: 'X', state: 'absent' },
        { letter: 'X', state: 'absent' },
      ],
    },
  ];

  assert.deepEqual(
    deriveProgressCells(guesses, 5).map((cell) => cell.state),
    ['correct', 'correct', 'unset', 'unset', 'unset'],
  );
});