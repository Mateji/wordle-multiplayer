import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import { deriveProgressCells, evaluateGuess } from './progress.js';
const DEFAULT_SETTINGS = {
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
const rooms = new Map();
const roomTimers = new Map();
const socketSessions = new Map();
const playerDisconnectTimers = new Map();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const assetsDir = path.resolve(__dirname, '../../client/src/assets');
const targetWordsByLength = loadTargetWordsByLength();
const allowedWordsByLength = loadAllowedWordsByLength();
const availableWordLengths = new Set(targetWordsByLength.keys());
const localCorsOriginPatterns = [
    /^https?:\/\/localhost(?::\d+)?$/,
    /^https?:\/\/127\.0\.0\.1(?::\d+)?$/,
    /^https?:\/\/\[::1\](?::\d+)?$/,
];
const configuredCorsOrigins = parseConfiguredCorsOrigins(process.env.CORS_ALLOWED_ORIGINS);
const isAllowedCorsOrigin = (origin) => {
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
app.use(cors({
    origin(origin, callback) {
        const isAllowed = isAllowedCorsOrigin(origin);
        callback(isAllowed ? null : new Error('CORS origin not allowed'), isAllowed);
    },
}));
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
const io = new Server(httpServer, {
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
function parseConfiguredCorsOrigins(value) {
    if (!value) {
        return new Set();
    }
    return new Set(value
        .split(',')
        .map((entry) => normalizeCorsOrigin(entry.trim()))
        .filter((entry) => !!entry));
}
function normalizeCorsOrigin(value) {
    try {
        return new URL(value).origin;
    }
    catch {
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
        const room = {
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
            updatedAt: Date.now(),
            secretWord: '',
            reconnectSecrets: new Map([[playerId, randomReconnectSecret()]]),
        };
        rooms.set(roomId, room);
        socketSessions.set(socket.id, { roomId, playerId });
        socket.join(roomId);
        const state = publicState(room);
        ack(successAck({ roomId, playerId, reconnectSecret: room.reconnectSecrets.get(playerId) ?? '', state }));
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
        let reconnectPlayer;
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
        let playerId;
        if (reconnectPlayer) {
            reconnectPlayer.connected = true;
            reconnectPlayer.name = playerName;
            playerId = reconnectPlayer.id;
            room.reconnectSecrets.set(playerId, randomReconnectSecret());
            clearPlayerDisconnectTimer(room.id, playerId);
        }
        else {
            playerId = randomId('player');
            room.players.push({ id: playerId, name: playerName, connected: true, wins: 0 });
            room.playerProgress.push(emptyProgress(playerId, room.settings.wordLength));
            room.reconnectSecrets.set(playerId, randomReconnectSecret());
        }
        room.updatedAt = Date.now();
        socketSessions.set(socket.id, { roomId: room.id, playerId });
        socket.join(room.id);
        const state = publicState(room);
        ack(successAck({ roomId: room.id, playerId, reconnectSecret: room.reconnectSecrets.get(playerId) ?? '', state }));
        io.to(room.id).emit('room:state', state);
    });
    socket.on('room:leave', (payload, ack) => {
        const authorized = assertPlayerInRoom(socket.id, payload.roomId);
        if (!authorized.ok) {
            ack(errorAck(authorized.error));
            return;
        }
        const { room, playerId } = authorized;
        room.updatedAt = Date.now();
        socket.leave(room.id);
        socketSessions.delete(socket.id);
        removePlayerFromRoom(room, playerId);
        ack(successAck({ roomId: room.id }));
        const currentRoom = rooms.get(room.id);
        if (currentRoom) {
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
        ack(successAck({ state }));
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
        const guess = {
            playerId,
            word: normalized,
            cells: evaluateGuess(normalized, room.secretWord),
            submittedAt: Date.now(),
        };
        room.guesses.push(guess);
        const playerProgress = room.playerProgress.find((entry) => entry.playerId === playerId);
        if (playerProgress) {
            playerProgress.cells = deriveProgressCells(room.guesses.filter((entry) => entry.playerId === playerId), room.settings.wordLength);
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
function successAck(data) {
    return { ok: true, data };
}
function errorAck(error) {
    return { ok: false, error };
}
function getSessionForSocket(socketId) {
    return socketSessions.get(socketId) ?? null;
}
function getPlayerForSocket(room, socketId) {
    const session = getSessionForSocket(socketId);
    if (!session || session.roomId !== room.id) {
        return null;
    }
    return room.players.find((entry) => entry.id === session.playerId) ?? null;
}
function assertPlayerInRoom(socketId, requestedRoomId) {
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
function assertHostSocket(socketId, requestedRoomId) {
    const authorized = assertPlayerInRoom(socketId, requestedRoomId);
    if (!authorized.ok) {
        return authorized;
    }
    if (authorized.room.hostPlayerId !== authorized.playerId) {
        return { ok: false, error: 'Only host can perform this action' };
    }
    return authorized;
}
function publicState(room) {
    const { secretWord, guesses, ...state } = room;
    return {
        ...state,
        round: {
            ...state.round,
            revealedTargetWord: state.phase === 'finished' ? secretWord : null,
        },
    };
}
function emptyProgress(playerId, wordLength) {
    return {
        playerId,
        cells: Array.from({ length: wordLength }, () => ({ state: 'unset' })),
        solved: false,
        guessesUsed: 0,
        exhausted: false,
        updatedAt: Date.now(),
    };
}
function randomId(prefix) {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
function randomReconnectSecret() {
    return randomBytes(24).toString('base64url');
}
function randomRoomCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let roomId = '';
    do {
        roomId = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
    } while (rooms.has(roomId));
    return roomId;
}
function normalizeRoomCode(roomId) {
    return roomId.trim().toUpperCase();
}
function playerTimerKey(roomId, playerId) {
    return `${roomId}:${playerId}`;
}
function clearPlayerDisconnectTimer(roomId, playerId) {
    const key = playerTimerKey(roomId, playerId);
    const timeout = playerDisconnectTimers.get(key);
    if (!timeout) {
        return;
    }
    clearTimeout(timeout);
    playerDisconnectTimers.delete(key);
}
function schedulePlayerDisconnectTimeout(roomId, playerId) {
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
        io.to(room.id).emit('room:state', publicState(room));
    }, PLAYER_REJOIN_TIMEOUT_MS);
    playerDisconnectTimers.set(playerTimerKey(roomId, playerId), timeout);
}
function removePlayerFromRoom(room, playerId) {
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
function disconnectPlayerSockets(roomId, playerId) {
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
function loadWordList(filePath) {
    const raw = readFileSync(filePath, 'utf-8');
    const payload = JSON.parse(raw);
    const words = Array.isArray(payload) ? payload : payload.data;
    if (!Array.isArray(words)) {
        throw new Error(`Invalid word list format in ${filePath}`);
    }
    return words
        .map((entry) => (typeof entry === 'string' ? entry.trim().toLocaleLowerCase('de-DE') : ''))
        .filter((entry) => entry.length > 0);
}
function loadTargetWordsByLength() {
    const index = new Map();
    for (const length of SUPPORTED_WORD_LENGTHS) {
        const filePath = path.resolve(assetsDir, `target-words-${length}.json`);
        const words = loadWordList(filePath).filter((word) => word.length === length);
        index.set(length, words);
    }
    return index;
}
function loadAllowedWordsByLength() {
    const index = new Map();
    for (const length of SUPPORTED_WORD_LENGTHS) {
        const filePath = path.resolve(assetsDir, `allowed-words-${length}.json`);
        const words = loadWordList(filePath).filter((word) => word.length === length);
        index.set(length, new Set(words));
    }
    return index;
}
function hasWordsForLength(length) {
    return availableWordLengths.has(length) && !!targetWordsByLength.get(length)?.length;
}
function randomTargetWord(length) {
    const words = targetWordsByLength.get(length) ?? [];
    if (!words.length) {
        throw new Error(`No target words available for length ${length}`);
    }
    const index = Math.floor(Math.random() * words.length);
    return words[index];
}
function isAllowedWord(word, length) {
    const bucket = allowedWordsByLength.get(length);
    if (!bucket) {
        return false;
    }
    return bucket.has(word);
}
function sanitizeSettings(settings, base) {
    const nextWordLength = clamp(toFiniteInteger(settings?.wordLength, base.wordLength), MIN_WORD_LENGTH, MAX_WORD_LENGTH);
    const nextMaxGuesses = clamp(toFiniteInteger(settings?.maxGuesses, base.maxGuesses), MIN_MAX_GUESSES, MAX_MAX_GUESSES);
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
function toFiniteInteger(value, fallback) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return fallback;
    }
    return Math.round(value);
}
function clamp(value, min, max) {
    if (value < min) {
        return min;
    }
    if (value > max) {
        return max;
    }
    return value;
}
function startRound(room) {
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
function activateRound(roomId, roundId) {
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
function finishRound(room, status, winnerPlayerId) {
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
function clearRoomTimer(roomId) {
    const timer = roomTimers.get(roomId);
    if (!timer) {
        return;
    }
    clearTimeout(timer);
    roomTimers.delete(roomId);
}
function guessCountForPlayer(room, playerId) {
    return room.guesses.reduce((count, guess) => count + (guess.playerId === playerId ? 1 : 0), 0);
}
function allPlayersUsedAllGuesses(room) {
    if (!room.players.length) {
        return false;
    }
    return room.players.every((player) => guessCountForPlayer(room, player.id) >= room.settings.maxGuesses);
}
