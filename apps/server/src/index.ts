import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Ack,
  ClientToServerEvents,
  GuessCell,
  GuessEntry,
  PlayerId,
  PlayerRoundProgress,
  RoomId,
  RoomSettings,
  RoomStateSnapshot,
  ServerToClientEvents,
} from '@wordle/shared';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';

const DEFAULT_SETTINGS: RoomSettings = {
  wordLength: 5,
  maxGuesses: 6,
  timeLimitSeconds: 120,
  language: 'de',
};

const MIN_MAX_GUESSES = 1;
const MAX_MAX_GUESSES = 10;
const MIN_TIME_LIMIT_SECONDS = 30;
const MAX_TIME_LIMIT_SECONDS = 900;

type InternalRoom = RoomStateSnapshot & {
  secretWord: string;
  guesses: GuessEntry[];
};

type WordFilePayload = {
  data?: unknown;
};

const rooms = new Map<RoomId, InternalRoom>();
const roomTimers = new Map<RoomId, ReturnType<typeof setTimeout>>();
const socketSessions = new Map<string, { roomId: RoomId; playerId: PlayerId }>();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const assetsDir = path.resolve(__dirname, '../../client/src/assets');

const targetWordsByLength = buildWordIndex(loadWordList(path.resolve(assetsDir, 'target-words.json')));
const allowedWordsByLength = buildAllowedWordIndex(loadWordList(path.resolve(assetsDir, 'allowed-words.json')));
const availableWordLengths = new Set<number>(targetWordsByLength.keys());

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: '*',
  },
});

io.on('connection', (socket) => {
  socket.on('room:create', (payload, ack) => {
    const playerName = payload.playerName?.trim();
    if (!playerName) {
      ack(errorAck('Player name is required'));
      return;
    }

    const settings = sanitizeSettings(payload.settings, DEFAULT_SETTINGS);
    if (!hasWordsForLength(settings.wordLength)) {
      ack(errorAck('Unsupported word length'));
      return;
    }

    const roomId = randomRoomCode();
    const playerId = randomId('player');

    const room: InternalRoom = {
      id: roomId,
      phase: 'lobby',
      hostPlayerId: playerId,
      settings,
      players: [{ id: playerId, name: playerName, connected: true }],
      round: {
        id: randomId('round'),
        status: 'idle',
        startedAt: null,
        endsAt: null,
        winnerPlayerId: null,
      },
      playerProgress: [emptyProgress(playerId, settings.wordLength)],
      guesses: [],
      updatedAt: Date.now(),
      secretWord: '',
    };

    rooms.set(roomId, room);
    socketSessions.set(socket.id, { roomId, playerId });
    socket.join(roomId);

    const state = publicState(room);
    ack(successAck({ roomId, playerId, state }));
    io.to(roomId).emit('room:state', state);
  });

  socket.on('room:join', (payload, ack) => {
    const playerName = payload.playerName?.trim();
    if (!playerName) {
      ack(errorAck('Player name is required'));
      return;
    }

    const roomId = normalizeRoomCode(payload.roomId);
    const room = rooms.get(roomId);
    if (!room) {
      ack(errorAck('Room not found'));
      return;
    }

    const playerId = randomId('player');
    room.players.push({ id: playerId, name: playerName, connected: true });
    room.playerProgress.push(emptyProgress(playerId, room.settings.wordLength));
    room.updatedAt = Date.now();

    socketSessions.set(socket.id, { roomId: room.id, playerId });
    socket.join(room.id);

    const state = publicState(room);
    ack(successAck({ roomId: room.id, playerId, state }));
    io.to(room.id).emit('room:state', state);
  });

  socket.on('room:update-settings', (payload, ack) => {
    const room = rooms.get(payload.roomId);
    if (!room) {
      ack(errorAck('Room not found'));
      return;
    }

    if (room.hostPlayerId !== payload.playerId) {
      ack(errorAck('Only host can update settings'));
      return;
    }

    if (room.phase !== 'lobby') {
      ack(errorAck('Settings can only be changed in lobby'));
      return;
    }

    const nextSettings = sanitizeSettings(payload.settings, room.settings);
    if (!hasWordsForLength(nextSettings.wordLength)) {
      ack(errorAck('Unsupported word length'));
      return;
    }

    room.settings = nextSettings;
    room.playerProgress = room.players.map((player) => emptyProgress(player.id, nextSettings.wordLength));
    room.round = {
      id: room.round.id,
      status: 'idle',
      startedAt: null,
      endsAt: null,
      winnerPlayerId: null,
    };
    room.updatedAt = Date.now();

    const state = publicState(room);
    ack(successAck({ state }));
    io.to(room.id).emit('room:state', state);
  });

  socket.on('game:start', (payload, ack) => {
    const room = rooms.get(payload.roomId);
    if (!room) {
      ack(errorAck('Room not found'));
      return;
    }

    if (room.hostPlayerId !== payload.playerId) {
      ack(errorAck('Only host can start a round'));
      return;
    }

    if (room.phase !== 'lobby' && room.phase !== 'finished') {
      ack(errorAck('Round is already running'));
      return;
    }

    startRound(room);

    const state = publicState(room);
    ack(successAck({ state }));
    io.to(room.id).emit('room:state', state);
  });

  socket.on('guess:submit', (payload, ack) => {
    const room = rooms.get(payload.roomId);
    if (!room) {
      ack(errorAck('Room not found'));
      return;
    }

    const player = room.players.find((entry) => entry.id === payload.playerId);
    if (!player) {
      ack(errorAck('Player not found in room'));
      return;
    }

    if (room.phase !== 'in-game' || room.round.status !== 'running') {
      ack(errorAck('Round is not running'));
      return;
    }

    const normalized = payload.word?.trim().toLocaleLowerCase('de-DE');
    if (!normalized || normalized.length !== room.settings.wordLength) {
      ack(errorAck('Invalid guess length'));
      return;
    }

    if (!isAllowedWord(normalized, room.settings.wordLength)) {
      ack(errorAck('Word is not in allowed list'));
      return;
    }

    if (guessCountForPlayer(room, payload.playerId) >= room.settings.maxGuesses) {
      ack(errorAck('No guesses left for this round'));
      return;
    }

    const guess: GuessEntry = {
      playerId: payload.playerId,
      word: normalized,
      cells: evaluateGuess(normalized, room.secretWord),
      submittedAt: Date.now(),
    };

    room.guesses.push(guess);
    const playerProgress = room.playerProgress.find((entry) => entry.playerId === payload.playerId);
    if (playerProgress) {
      const currentCounts = countProgressCells(playerProgress);
      const guessCounts = countGuessCells(guess.cells);
      const nextCorrect = Math.max(currentCounts.correct, guessCounts.correct);
      const nextPresent = Math.max(currentCounts.present, guessCounts.present);
      applyProgressCounts(playerProgress, nextCorrect, nextPresent, room.settings.wordLength);
      playerProgress.solved = guess.cells.every((cell) => cell.state === 'correct');
      playerProgress.updatedAt = Date.now();

      if (playerProgress.solved) {
        finishRound(room, 'solved', payload.playerId);
      }
    }

    if (room.round.status === 'running' && allPlayersUsedAllGuesses(room)) {
      finishRound(room, 'cancelled', null);
    }

    room.updatedAt = Date.now();

    const state = publicState(room);
    ack(successAck({ state, result: guess.cells }));
    io.to(room.id).emit('room:state', state);
  });

  socket.on('game:new', (payload, ack) => {
    const room = rooms.get(payload.roomId);
    if (!room) {
      ack(errorAck('Room not found'));
      return;
    }

    if (room.hostPlayerId !== payload.playerId) {
      ack(errorAck('Only host can start a new game'));
      return;
    }

    startRound(room);

    const state = publicState(room);
    ack(successAck({ state }));
    io.to(room.id).emit('room:state', state);
  });

  socket.on('disconnect', () => {
    const session = socketSessions.get(socket.id);
    if (!session) {
      return;
    }
    socketSessions.delete(socket.id);

    const room = rooms.get(session.roomId);
    if (!room) {
      return;
    }

    const player = room.players.find((entry) => entry.id === session.playerId);
    if (!player) {
      return;
    }

    player.connected = false;

    if (room.hostPlayerId === player.id) {
      const nextHost = room.players.find((entry) => entry.connected && entry.id !== player.id);
      if (nextHost) {
        room.hostPlayerId = nextHost.id;
      }
    }

    room.updatedAt = Date.now();
    io.to(room.id).emit('room:state', publicState(room));
  });
});

const port = Number(process.env.PORT ?? 3001);
httpServer.listen(port, () => {
  console.log(`[server] listening on http://localhost:${port}`);
});

function successAck<T>(data: T): Ack<T> {
  return { ok: true, data };
}

function errorAck<T>(error: string): Ack<T> {
  return { ok: false, error };
}

function publicState(room: InternalRoom): RoomStateSnapshot {
  const { secretWord, guesses, ...state } = room;
  return state;
}

function emptyProgress(playerId: PlayerId, wordLength: number): RoomStateSnapshot['playerProgress'][number] {
  return {
    playerId,
    cells: Array.from({ length: wordLength }, () => ({ state: 'unset' })),
    solved: false,
    updatedAt: Date.now(),
  };
}

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function randomRoomCode(): RoomId {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let roomId = '';
  do {
    roomId = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (rooms.has(roomId));
  return roomId;
}

function normalizeRoomCode(roomId: string): RoomId {
  return roomId.trim().toUpperCase();
}

function loadWordList(filePath: string): string[] {
  const raw = readFileSync(filePath, 'utf-8');
  const payload = JSON.parse(raw) as WordFilePayload;
  const words = Array.isArray(payload) ? payload : payload.data;
  if (!Array.isArray(words)) {
    throw new Error(`Invalid word list format in ${filePath}`);
  }

  return words
    .map((entry) => (typeof entry === 'string' ? entry.trim().toLocaleLowerCase('de-DE') : ''))
    .filter((entry) => entry.length > 0);
}

function buildWordIndex(words: string[]): Map<number, string[]> {
  const index = new Map<number, string[]>();
  for (const word of words) {
    const bucket = index.get(word.length) ?? [];
    bucket.push(word);
    index.set(word.length, bucket);
  }
  return index;
}

function buildAllowedWordIndex(words: string[]): Map<number, Set<string>> {
  const index = new Map<number, Set<string>>();
  for (const word of words) {
    const bucket = index.get(word.length) ?? new Set<string>();
    bucket.add(word);
    index.set(word.length, bucket);
  }
  return index;
}

function hasWordsForLength(length: number): boolean {
  return availableWordLengths.has(length) && !!targetWordsByLength.get(length)?.length;
}

function randomTargetWord(length: number): string {
  const words = targetWordsByLength.get(length) ?? [];
  if (!words.length) {
    throw new Error(`No target words available for length ${length}`);
  }

  const index = Math.floor(Math.random() * words.length);
  return words[index];
}

function isAllowedWord(word: string, length: number): boolean {
  const bucket = allowedWordsByLength.get(length);
  if (!bucket) {
    return false;
  }
  return bucket.has(word);
}

function sanitizeSettings(settings: Partial<RoomSettings> | undefined, base: RoomSettings): RoomSettings {
  const nextWordLength = toFiniteInteger(settings?.wordLength, base.wordLength);
  const nextMaxGuesses = clamp(
    toFiniteInteger(settings?.maxGuesses, base.maxGuesses),
    MIN_MAX_GUESSES,
    MAX_MAX_GUESSES,
  );
  const nextTimeLimit = clamp(
    toFiniteInteger(settings?.timeLimitSeconds, base.timeLimitSeconds),
    MIN_TIME_LIMIT_SECONDS,
    MAX_TIME_LIMIT_SECONDS,
  );

  const supportedWordLength = hasWordsForLength(nextWordLength) ? nextWordLength : base.wordLength;

  return {
    wordLength: supportedWordLength,
    maxGuesses: nextMaxGuesses,
    timeLimitSeconds: nextTimeLimit,
    language: 'de',
  };
}

function toFiniteInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }
  return Math.round(value);
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function startRound(room: InternalRoom): void {
  clearRoomTimer(room.id);

  const now = Date.now();
  room.phase = 'in-game';
  room.round = {
    id: randomId('round'),
    status: 'running',
    startedAt: now,
    endsAt: now + room.settings.timeLimitSeconds * 1000,
    winnerPlayerId: null,
  };
  room.playerProgress = room.players.map((player) => emptyProgress(player.id, room.settings.wordLength));
  room.guesses = [];
  room.secretWord = randomTargetWord(room.settings.wordLength);
  room.updatedAt = now;

  const timeout = setTimeout(() => {
    const activeRoom = rooms.get(room.id);
    if (!activeRoom) {
      return;
    }
    if (activeRoom.phase !== 'in-game' || activeRoom.round.status !== 'running') {
      return;
    }
    finishRound(activeRoom, 'timeout', null);
    io.to(activeRoom.id).emit('room:state', publicState(activeRoom));
  }, room.settings.timeLimitSeconds * 1000);

  roomTimers.set(room.id, timeout);
}

function finishRound(
  room: InternalRoom,
  status: RoomStateSnapshot['round']['status'],
  winnerPlayerId: PlayerId | null,
): void {
  clearRoomTimer(room.id);
  room.round.status = status;
  room.round.winnerPlayerId = winnerPlayerId;
  room.phase = 'finished';
  room.updatedAt = Date.now();
}

function clearRoomTimer(roomId: RoomId): void {
  const timer = roomTimers.get(roomId);
  if (!timer) {
    return;
  }
  clearTimeout(timer);
  roomTimers.delete(roomId);
}

function guessCountForPlayer(room: InternalRoom, playerId: PlayerId): number {
  return room.guesses.reduce((count, guess) => count + (guess.playerId === playerId ? 1 : 0), 0);
}

function allPlayersUsedAllGuesses(room: InternalRoom): boolean {
  if (!room.players.length) {
    return false;
  }
  return room.players.every((player) => guessCountForPlayer(room, player.id) >= room.settings.maxGuesses);
}

function countGuessCells(cells: GuessCell[]): { correct: number; present: number } {
  let correct = 0;
  let present = 0;
  for (const cell of cells) {
    if (cell.state === 'correct') {
      correct++;
      continue;
    }
    if (cell.state === 'present') {
      present++;
    }
  }
  return { correct, present };
}

function countProgressCells(progress: PlayerRoundProgress): { correct: number; present: number } {
  let correct = 0;
  let present = 0;
  for (const cell of progress.cells) {
    if (cell.state === 'correct') {
      correct++;
      continue;
    }
    if (cell.state === 'present') {
      present++;
    }
  }
  return { correct, present };
}

function applyProgressCounts(
  progress: PlayerRoundProgress,
  correctCount: number,
  presentCount: number,
  totalLength: number,
): void {
  const boundedCorrect = clamp(correctCount, 0, totalLength);
  const boundedPresent = clamp(presentCount, 0, totalLength - boundedCorrect);
  const nextCells = [] as PlayerRoundProgress['cells'];

  for (let index = 0; index < totalLength; index++) {
    if (index < boundedCorrect) {
      nextCells.push({ state: 'correct' });
      continue;
    }
    if (index < boundedCorrect + boundedPresent) {
      nextCells.push({ state: 'present' });
      continue;
    }
    nextCells.push({ state: 'unset' });
  }

  progress.cells = nextCells;
}

function evaluateGuess(guess: string, target: string): GuessCell[] {
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
