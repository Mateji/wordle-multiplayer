import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Ack,
  ChatMessage,
  ClientToServerEvents,
  GuessEntry,
  PlayerId,
  PlayerRoundProgress,
  PlayerSummary,
  RoomId,
  RoomPhase,
  RoomSettings,
  RoomStateSnapshot,
  RoundSnapshot,
  ServerToClientEvents,
} from '@wordle/shared';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import { deriveProgressCells, evaluateGuess } from './progress.js';

interface InternalRoom {
  id: RoomId;
  phase: RoomPhase;
  hostPlayerId: PlayerId;
  settings: RoomSettings;
  players: PlayerSummary[];
  round: RoundSnapshot;
  playerProgress: PlayerRoundProgress[];
  guesses: GuessEntry[];
  chatMessages: ChatMessage[];
  updatedAt: number;
  secretWord: string;
  reconnectSecrets: Map<PlayerId, string>;
}

type WordFilePayload = string[] | { data?: unknown };

const DEFAULT_SETTINGS: RoomSettings = {
  wordLength: 5,
  maxGuesses: 6,
  timeLimitSeconds: 0,
  language: 'de',
};

const MIN_WORD_LENGTH = 3;
const MAX_WORD_LENGTH = 7;
const MIN_MAX_GUESSES = 1;
const MAX_MAX_GUESSES = 10;
const ALLOWED_TIME_LIMITS_SECONDS = new Set([0, 60, 120, 180, 240, 300]);
const SUPPORTED_WORD_LENGTHS = [3, 4, 5, 6, 7];
const PLAYER_REJOIN_TIMEOUT_MS = 2 * 60 * 1000;
const ROUND_START_COUNTDOWN_MS = 5_000;
const MAX_CHAT_MESSAGES_PER_ROOM = 50;
const MAX_CHAT_MESSAGE_LENGTH = 300;
const SYSTEM_PLAYER_ID = 'system';
const SYSTEM_PLAYER_NAME = 'System';

const rooms = new Map<RoomId, InternalRoom>();
const roomTimers = new Map<RoomId, ReturnType<typeof setTimeout>>();
type SocketSession = { roomId: RoomId; playerId: PlayerId };

const socketSessions = new Map<string, SocketSession>();
const playerDisconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const assetsDir = path.resolve(__dirname, '../../client/src/assets');

const targetWordsByLength = loadTargetWordsByLength();
const allowedWordsByLength = loadAllowedWordsByLength();
const availableWordLengths = new Set<number>(targetWordsByLength.keys());
const localCorsOriginPatterns = [
  /^https?:\/\/localhost(?::\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(?::\d+)?$/,
  /^https?:\/\/\[::1\](?::\d+)?$/,
];
const configuredCorsOrigins = parseConfiguredCorsOrigins(process.env.CORS_ALLOWED_ORIGINS);

const isAllowedCorsOrigin = (origin?: string): boolean => {
  if (!origin) {
    return true;
  }

  if (origin === 'null') {
    return true;
  }

  const normalizedOrigin = normalizeCorsOrigin(origin);
  if (!normalizedOrigin) {
    return false;
  }

  if (configuredCorsOrigins.size > 0) {
    return configuredCorsOrigins.has(normalizedOrigin);
  }

  return localCorsOriginPatterns.some((pattern) => pattern.test(normalizedOrigin));
};

const app = express();
app.use(
  cors({
    origin(origin, callback) {
      const isAllowed = isAllowedCorsOrigin(origin);
      callback(isAllowed ? null : new Error('CORS origin not allowed'), isAllowed);
    },
  }),
);
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

app.get('/rooms/:roomId', (req, res) => {
  const roomId = normalizeRoomCode(String(req.params.roomId ?? ''));
  const room = rooms.get(roomId);
  if (!room) {
    res.status(404).json({ ok: false, error: 'Room not found' });
    return;
  }
  res.json({ ok: true, state: publicState(room) });
});

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin(origin, callback) {
      const isAllowed = isAllowedCorsOrigin(origin);
      callback(isAllowed ? null : new Error('CORS origin not allowed'), isAllowed);
    },
    methods: ['GET', 'POST'],
  },
  allowRequest: (req, callback) => {
    callback(null, isAllowedCorsOrigin(req.headers.origin));
  },
});

function parseConfiguredCorsOrigins(value?: string): Set<string> {
  if (!value) {
    return new Set();
  }

  return new Set(
    value
      .split(',')
      .map((entry) => normalizeCorsOrigin(entry.trim()))
      .filter((entry): entry is string => !!entry),
  );
}

function normalizeCorsOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

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
      players: [{ id: playerId, name: playerName, connected: true, wins: 0 }],
      round: {
        id: randomId('round'),
        status: 'idle',
        startedAt: null,
        endsAt: null,
        winnerPlayerId: null,
      },
      playerProgress: [emptyProgress(playerId, settings.wordLength)],
      guesses: [],
      chatMessages: [],
      updatedAt: Date.now(),
      secretWord: '',
      reconnectSecrets: new Map([[playerId, randomReconnectSecret()]]),
    };

    rooms.set(roomId, room);
    socketSessions.set(socket.id, { roomId, playerId });
    socket.join(roomId);

    const state = publicState(room);
    ack(successAck({ roomId, playerId, reconnectSecret: room.reconnectSecrets.get(playerId) ?? '', state }));
    emitChatHistory(socket, room);
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

    const reconnectPlayerId = payload.reconnectPlayerId?.trim();
    const reconnectSecret = payload.reconnectSecret?.trim();
    let reconnectPlayer: PlayerSummary | undefined;
    if (reconnectPlayerId) {
      if (!reconnectSecret) {
        ack(errorAck('Reconnect secret is required'));
        return;
      }

      const knownSecret = room.reconnectSecrets.get(reconnectPlayerId);
      if (!knownSecret || knownSecret !== reconnectSecret) {
        ack(errorAck('Reconnect secret is invalid'));
        return;
      }

      reconnectPlayer = room.players.find((entry) => entry.id === reconnectPlayerId);
      if (!reconnectPlayer) {
        ack(errorAck('Player not found in room'));
        return;
      }
    }

    let playerId: PlayerId;
    let joinSystemMessage: ChatMessage | null = null;
    if (reconnectPlayer) {
      reconnectPlayer.connected = true;
      reconnectPlayer.name = playerName;
      playerId = reconnectPlayer.id;
      room.reconnectSecrets.set(playerId, randomReconnectSecret());
      clearPlayerDisconnectTimer(room.id, playerId);
    } else {
      playerId = randomId('player');
      room.players.push({ id: playerId, name: playerName, connected: true, wins: 0 });
      room.playerProgress.push(emptyProgress(playerId, room.settings.wordLength));
      room.reconnectSecrets.set(playerId, randomReconnectSecret());
      joinSystemMessage = addSystemChatMessage(room, `${playerName} ist beigetreten.`);
    }

    room.updatedAt = Date.now();

    socketSessions.set(socket.id, { roomId: room.id, playerId });
    socket.join(room.id);

    const state = publicState(room);
    ack(successAck({ roomId: room.id, playerId, reconnectSecret: room.reconnectSecrets.get(playerId) ?? '', state }));
    emitChatHistory(socket, room);
    if (joinSystemMessage) {
      socket.to(room.id).emit('chat:messageAdded', joinSystemMessage);
    }
    io.to(room.id).emit('room:state', state);
  });

  socket.on('room:leave', (payload, ack) => {
    const authorized = assertPlayerInRoom(socket.id, payload.roomId);
    if (!authorized.ok) {
      ack(errorAck(authorized.error));
      return;
    }

    const { room, playerId } = authorized;
    const leavingPlayer = room.players.find((entry) => entry.id === playerId);
    room.updatedAt = Date.now();

    socket.leave(room.id);
    socketSessions.delete(socket.id);
    removePlayerFromRoom(room, playerId);

    ack(successAck({ roomId: room.id }));

    const currentRoom = rooms.get(room.id);
    if (currentRoom) {
      if (leavingPlayer) {
        const leaveSystemMessage = addSystemChatMessage(currentRoom, `${leavingPlayer.name} hat den Raum verlassen.`);
        io.to(currentRoom.id).emit('chat:messageAdded', leaveSystemMessage);
      }
      io.to(currentRoom.id).emit('room:state', publicState(currentRoom));
    }
  });

  socket.on('room:update-settings', (payload, ack) => {
    const authorized = assertHostSocket(socket.id, payload.roomId);
    if (!authorized.ok) {
      ack(errorAck(authorized.error));
      return;
    }

    const { room } = authorized;

    const roundIsActive = room.round.status === 'countdown' || room.round.status === 'running';
    if (roundIsActive) {
      ack(errorAck('Settings can only be changed after the active round has ended'));
      return;
    }

    const nextSettings = sanitizeSettings(payload.settings, room.settings);
    if (!hasWordsForLength(nextSettings.wordLength)) {
      ack(errorAck('Unsupported word length'));
      return;
    }

    room.settings = nextSettings;
    room.phase = 'lobby';
    room.playerProgress = room.players.map((player) => emptyProgress(player.id, nextSettings.wordLength));
    room.guesses = [];
    room.secretWord = '';
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

  socket.on('room:kick-player', (payload, ack) => {
    const authorized = assertHostSocket(socket.id, payload.roomId);
    if (!authorized.ok) {
      ack(errorAck(authorized.error));
      return;
    }

    const { room, playerId } = authorized;

    if (room.phase !== 'lobby' || room.round.status === 'countdown') {
      ack(errorAck('Players can only be kicked in lobby'));
      return;
    }

    if (payload.targetPlayerId === room.hostPlayerId) {
      ack(errorAck('Host cannot kick themselves'));
      return;
    }

    const targetPlayer = room.players.find((entry) => entry.id === payload.targetPlayerId);
    if (!targetPlayer) {
      ack(errorAck('Player not found in room'));
      return;
    }

    if (targetPlayer.id === playerId) {
      ack(errorAck('Host cannot kick themselves'));
      return;
    }

    removePlayerFromRoom(room, targetPlayer.id);
    disconnectPlayerSockets(room.id, targetPlayer.id);
    room.updatedAt = Date.now();

    const state = publicState(room);
    const kickSystemMessage = addSystemChatMessage(room, `${targetPlayer.name} wurde aus dem Raum entfernt.`);
    ack(successAck({ state }));
    io.to(room.id).emit('chat:messageAdded', kickSystemMessage);
    io.to(room.id).emit('room:state', state);
  });

  socket.on('game:start', (payload, ack) => {
    const authorized = assertHostSocket(socket.id, payload.roomId);
    if (!authorized.ok) {
      ack(errorAck(authorized.error));
      return;
    }

    const { room } = authorized;

    if (room.round.status === 'countdown') {
      ack(errorAck('Round is already starting'));
      return;
    }

    if (room.phase !== 'lobby' && room.phase !== 'finished') {
      ack(errorAck('Round is already running'));
      return;
    }

    startRound(room);

    const state = publicState(room);
    const roundStartedMessage = addSystemChatMessage(room, 'Die Runde wurde gestartet.');
    ack(successAck({ state }));
    io.to(room.id).emit('chat:messageAdded', roundStartedMessage);
    io.to(room.id).emit('room:state', state);
  });

  socket.on('game:end', (payload, ack) => {
    const authorized = assertHostSocket(socket.id, payload.roomId);
    if (!authorized.ok) {
      ack(errorAck(authorized.error));
      return;
    }

    const { room } = authorized;
    const roundIsActive = room.round.status === 'countdown' || (room.phase === 'in-game' && room.round.status === 'running');

    if (!roundIsActive) {
      ack(errorAck('Round is not active'));
      return;
    }

    returnRoomToLobby(room);

    const state = publicState(room);
    ack(successAck({ state }));
    io.to(room.id).emit('room:state', state);
  });

  socket.on('guess:submit', (payload, ack) => {
    const authorized = assertPlayerInRoom(socket.id, payload.roomId);
    if (!authorized.ok) {
      ack(errorAck(authorized.error));
      return;
    }

    const { room, playerId } = authorized;

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

    if (guessCountForPlayer(room, playerId) >= room.settings.maxGuesses) {
      ack(errorAck('No guesses left for this round'));
      return;
    }

    const guess: GuessEntry = {
      playerId,
      word: normalized,
      cells: evaluateGuess(normalized, room.secretWord),
      submittedAt: Date.now(),
    };

    room.guesses.push(guess);
    const playerProgress = room.playerProgress.find((entry) => entry.playerId === playerId);
    if (playerProgress) {
      playerProgress.cells = deriveProgressCells(
        room.guesses.filter((entry) => entry.playerId === playerId),
        room.settings.wordLength,
      );
      const guessesUsed = guessCountForPlayer(room, playerId);
      playerProgress.guessesUsed = guessesUsed;
      playerProgress.solved = guess.cells.every((cell) => cell.state === 'correct');
      playerProgress.exhausted = !playerProgress.solved && guessesUsed >= room.settings.maxGuesses;
      playerProgress.updatedAt = Date.now();

      if (playerProgress.solved) {
        finishRound(room, 'solved', playerId);
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

  socket.on('chat:sendMessage', (payload, ack) => {
    const authorized = assertPlayerForSocketSession(socket.id);
    if (!authorized.ok) {
      emitChatError(socket, 'CHAT_ROOM_REQUIRED', authorized.error);
      ack(errorAck(authorized.error));
      return;
    }

    const { room, player } = authorized;
    const text = payload.text?.trim();

    if (!text) {
      const message = 'Nachricht darf nicht leer sein';
      emitChatError(socket, 'CHAT_EMPTY_MESSAGE', message);
      ack(errorAck(message));
      return;
    }

    if (text.length > MAX_CHAT_MESSAGE_LENGTH) {
      const message = `Nachricht darf maximal ${MAX_CHAT_MESSAGE_LENGTH} Zeichen haben`;
      emitChatError(socket, 'CHAT_MESSAGE_TOO_LONG', message);
      ack(errorAck(message));
      return;
    }

    const chatMessage = addChatMessage(room, {
      playerId: player.id,
      playerName: player.name,
      text,
      type: 'player',
    });

    ack(successAck({ message: chatMessage }));
    io.to(room.id).emit('chat:messageAdded', chatMessage);
  });

  socket.on('game:new', (payload, ack) => {
    const authorized = assertHostSocket(socket.id, payload.roomId);
    if (!authorized.ok) {
      ack(errorAck(authorized.error));
      return;
    }

    const { room } = authorized;

    if (room.round.status === 'countdown') {
      ack(errorAck('Round is already starting'));
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

    schedulePlayerDisconnectTimeout(room.id, player.id);

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

function getSessionForSocket(socketId: string): SocketSession | null {
  return socketSessions.get(socketId) ?? null;
}

function getPlayerForSocket(room: InternalRoom, socketId: string): PlayerSummary | null {
  const session = getSessionForSocket(socketId);
  if (!session || session.roomId !== room.id) {
    return null;
  }

  return room.players.find((entry) => entry.id === session.playerId) ?? null;
}

function assertPlayerInRoom(
  socketId: string,
  requestedRoomId: RoomId,
): { ok: true; room: InternalRoom; playerId: PlayerId } | { ok: false; error: string } {
  const session = getSessionForSocket(socketId);
  if (!session) {
    return { ok: false, error: 'Player session not found' };
  }

  const normalizedRoomId = normalizeRoomCode(requestedRoomId);
  if (session.roomId !== normalizedRoomId) {
    return { ok: false, error: 'Player is not in the requested room' };
  }

  const room = rooms.get(session.roomId);
  if (!room) {
    return { ok: false, error: 'Room not found' };
  }

  const player = getPlayerForSocket(room, socketId);
  if (!player) {
    return { ok: false, error: 'Player not found in room' };
  }

  return { ok: true, room, playerId: player.id };
}

function assertHostSocket(
  socketId: string,
  requestedRoomId: RoomId,
): { ok: true; room: InternalRoom; playerId: PlayerId } | { ok: false; error: string } {
  const authorized = assertPlayerInRoom(socketId, requestedRoomId);
  if (!authorized.ok) {
    return authorized;
  }

  if (authorized.room.hostPlayerId !== authorized.playerId) {
    return { ok: false, error: 'Only host can perform this action' };
  }

  return authorized;
}

function assertPlayerForSocketSession(
  socketId: string,
): { ok: true; room: InternalRoom; player: PlayerSummary } | { ok: false; error: string } {
  const session = getSessionForSocket(socketId);
  if (!session) {
    return { ok: false, error: 'Player session not found' };
  }

  const room = rooms.get(session.roomId);
  if (!room) {
    return { ok: false, error: 'Room not found' };
  }

  const player = getPlayerForSocket(room, socketId);
  if (!player) {
    return { ok: false, error: 'Player not found in room' };
  }

  return { ok: true, room, player };
}

function publicState(room: InternalRoom): RoomStateSnapshot {
  const { secretWord, guesses, chatMessages, ...state } = room;
  return {
    ...state,
    round: {
      ...state.round,
      revealedTargetWord: state.phase === 'finished' ? secretWord : null,
    },
  };
}

function emptyProgress(playerId: PlayerId, wordLength: number): RoomStateSnapshot['playerProgress'][number] {
  return {
    playerId,
    cells: Array.from({ length: wordLength }, () => ({ state: 'unset' })),
    solved: false,
    guessesUsed: 0,
    exhausted: false,
    updatedAt: Date.now(),
  };
}

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function emitChatHistory(
  socket: Parameters<Parameters<typeof io.on>[1]>[0],
  room: InternalRoom,
): void {
  socket.emit('chat:history', {
    roomCode: room.id,
    messages: [...room.chatMessages],
  });
}

function emitChatError(
  socket: Parameters<Parameters<typeof io.on>[1]>[0],
  code: string,
  message: string,
): void {
  socket.emit('chat:error', { code, message });
}

function addSystemChatMessage(room: InternalRoom, text: string): ChatMessage {
  return addChatMessage(room, {
    playerId: SYSTEM_PLAYER_ID,
    playerName: SYSTEM_PLAYER_NAME,
    text,
    type: 'system',
  });
}

function addChatMessage(
  room: InternalRoom,
  input: Pick<ChatMessage, 'playerId' | 'playerName' | 'text' | 'type'>,
): ChatMessage {
  const chatMessage: ChatMessage = {
    messageId: randomId('chat'),
    roomCode: room.id,
    playerId: input.playerId,
    playerName: input.playerName,
    text: input.text,
    createdAt: Date.now(),
    type: input.type,
  };

  room.chatMessages.push(chatMessage);
  if (room.chatMessages.length > MAX_CHAT_MESSAGES_PER_ROOM) {
    room.chatMessages.splice(0, room.chatMessages.length - MAX_CHAT_MESSAGES_PER_ROOM);
  }

  room.updatedAt = chatMessage.createdAt;
  return chatMessage;
}

function randomReconnectSecret(): string {
  return randomBytes(24).toString('base64url');
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

function playerTimerKey(roomId: RoomId, playerId: PlayerId): string {
  return `${roomId}:${playerId}`;
}

function clearPlayerDisconnectTimer(roomId: RoomId, playerId: PlayerId): void {
  const key = playerTimerKey(roomId, playerId);
  const timeout = playerDisconnectTimers.get(key);
  if (!timeout) {
    return;
  }

  clearTimeout(timeout);
  playerDisconnectTimers.delete(key);
}

function schedulePlayerDisconnectTimeout(roomId: RoomId, playerId: PlayerId): void {
  clearPlayerDisconnectTimer(roomId, playerId);

  const timeout = setTimeout(() => {
    playerDisconnectTimers.delete(playerTimerKey(roomId, playerId));

    const room = rooms.get(roomId);
    if (!room) {
      return;
    }

    const player = room.players.find((entry) => entry.id === playerId);
    if (!player || player.connected) {
      return;
    }

    removePlayerFromRoom(room, playerId);
    room.updatedAt = Date.now();
    const leaveSystemMessage = addSystemChatMessage(room, `${player.name} hat den Raum verlassen.`);
    io.to(room.id).emit('chat:messageAdded', leaveSystemMessage);
    io.to(room.id).emit('room:state', publicState(room));
  }, PLAYER_REJOIN_TIMEOUT_MS);

  playerDisconnectTimers.set(playerTimerKey(roomId, playerId), timeout);
}

function removePlayerFromRoom(room: InternalRoom, playerId: PlayerId): void {
  clearPlayerDisconnectTimer(room.id, playerId);
  room.players = room.players.filter((entry) => entry.id !== playerId);
  room.playerProgress = room.playerProgress.filter((entry) => entry.playerId !== playerId);
  room.guesses = room.guesses.filter((entry) => entry.playerId !== playerId);
  room.reconnectSecrets.delete(playerId);

  if (!room.players.length) {
    clearRoomTimer(room.id);
    rooms.delete(room.id);
    return;
  }

  if (room.hostPlayerId === playerId) {
    const nextHost = room.players.find((entry) => entry.connected) ?? room.players[0];
    room.hostPlayerId = nextHost.id;
  }
}

function disconnectPlayerSockets(roomId: RoomId, playerId: PlayerId): void {
  for (const [socketId, session] of socketSessions.entries()) {
    if (session.roomId !== roomId || session.playerId !== playerId) {
      continue;
    }

    socketSessions.delete(socketId);
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) {
      continue;
    }

    socket.emit('room:error', { code: 'KICKED', message: 'Du wurdest aus dem Raum entfernt.' });
    socket.disconnect(true);
  }
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

function loadTargetWordsByLength(): Map<number, string[]> {
  const index = new Map<number, string[]>();
  for (const length of SUPPORTED_WORD_LENGTHS) {
    const filePath = path.resolve(assetsDir, `target-words-${length}.json`);
    const words = loadWordList(filePath).filter((word) => word.length === length);
    index.set(length, words);
  }
  return index;
}

function loadAllowedWordsByLength(): Map<number, Set<string>> {
  const index = new Map<number, Set<string>>();
  for (const length of SUPPORTED_WORD_LENGTHS) {
    const filePath = path.resolve(assetsDir, `allowed-words-${length}.json`);
    const words = loadWordList(filePath).filter((word) => word.length === length);
    index.set(length, new Set(words));
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
  const nextWordLength = clamp(
    toFiniteInteger(settings?.wordLength, base.wordLength),
    MIN_WORD_LENGTH,
    MAX_WORD_LENGTH,
  );
  const nextMaxGuesses = clamp(
    toFiniteInteger(settings?.maxGuesses, base.maxGuesses),
    MIN_MAX_GUESSES,
    MAX_MAX_GUESSES,
  );
  const requestedTimeLimit = toFiniteInteger(settings?.timeLimitSeconds, base.timeLimitSeconds);
  const nextTimeLimit = ALLOWED_TIME_LIMITS_SECONDS.has(requestedTimeLimit)
    ? requestedTimeLimit
    : base.timeLimitSeconds;

  const fallbackWordLength = hasWordsForLength(base.wordLength) ? base.wordLength : DEFAULT_SETTINGS.wordLength;
  const supportedWordLength = hasWordsForLength(nextWordLength) ? nextWordLength : fallbackWordLength;

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
  room.phase = 'lobby';
  room.round = {
    id: randomId('round'),
    status: 'countdown',
    startedAt: now + ROUND_START_COUNTDOWN_MS,
    endsAt: null,
    winnerPlayerId: null,
    revealedTargetWord: null,
  };
  room.playerProgress = room.players.map((player) => emptyProgress(player.id, room.settings.wordLength));
  room.guesses = [];
  room.secretWord = randomTargetWord(room.settings.wordLength);
  room.updatedAt = now;

  const roundId = room.round.id;
  const timeout = setTimeout(() => {
    activateRound(room.id, roundId);
  }, ROUND_START_COUNTDOWN_MS);

  roomTimers.set(room.id, timeout);
}

function activateRound(roomId: RoomId, roundId: string): void {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  if (room.round.id !== roundId || room.round.status !== 'countdown') {
    return;
  }

  clearRoomTimer(room.id);

  const now = Date.now();
  const hasTimeLimit = room.settings.timeLimitSeconds > 0;
  room.phase = 'in-game';
  room.round = {
    ...room.round,
    status: 'running',
    startedAt: now,
    endsAt: hasTimeLimit ? now + room.settings.timeLimitSeconds * 1000 : null,
    winnerPlayerId: null,
    revealedTargetWord: null,
  };
  room.updatedAt = now;

  io.to(room.id).emit('room:state', publicState(room));

  if (hasTimeLimit) {
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
}

function finishRound(
  room: InternalRoom,
  status: RoomStateSnapshot['round']['status'],
  winnerPlayerId: PlayerId | null,
): void {
  clearRoomTimer(room.id);
  room.round.status = status;
  room.round.winnerPlayerId = winnerPlayerId;
  room.round.revealedTargetWord = room.secretWord;

  if (winnerPlayerId) {
    const winner = room.players.find((player) => player.id === winnerPlayerId);
    if (winner) {
      winner.wins += 1;
    }
  }

  room.phase = 'finished';
  room.updatedAt = Date.now();
}

function returnRoomToLobby(room: InternalRoom): void {
  clearRoomTimer(room.id);
  room.phase = 'lobby';
  room.round = {
    ...room.round,
    status: 'idle',
    startedAt: null,
    endsAt: null,
    winnerPlayerId: null,
    revealedTargetWord: null,
  };
  room.playerProgress = room.players.map((player) => emptyProgress(player.id, room.settings.wordLength));
  room.guesses = [];
  room.secretWord = '';
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
