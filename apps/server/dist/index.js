import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
const DEFAULT_SETTINGS = {
    wordLength: 5,
    maxGuesses: 6,
    language: 'de',
};
const rooms = new Map();
const app = express();
app.use(cors());
app.use(express.json());
app.get('/health', (_req, res) => {
    res.json({ ok: true, rooms: rooms.size });
});
const httpServer = createServer(app);
const io = new Server(httpServer, {
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
        const roomId = randomId('room');
        const playerId = randomId('player');
        const settings = {
            ...DEFAULT_SETTINGS,
            ...payload.settings,
            wordLength: payload.settings?.wordLength ?? DEFAULT_SETTINGS.wordLength,
            maxGuesses: payload.settings?.maxGuesses ?? DEFAULT_SETTINGS.maxGuesses,
            language: 'de',
        };
        const room = {
            id: roomId,
            phase: 'in-game',
            hostPlayerId: playerId,
            settings,
            players: [{ id: playerId, name: playerName, connected: true }],
            guesses: [],
            updatedAt: Date.now(),
            secretWord: randomWord(settings.wordLength),
        };
        rooms.set(roomId, room);
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
        const room = rooms.get(payload.roomId);
        if (!room) {
            ack(errorAck('Room not found'));
            return;
        }
        const playerId = randomId('player');
        room.players.push({ id: playerId, name: playerName, connected: true });
        room.updatedAt = Date.now();
        socket.join(room.id);
        const state = publicState(room);
        ack(successAck({ roomId: room.id, playerId, state }));
        io.to(room.id).emit('room:state', state);
    });
    socket.on('guess:submit', (payload, ack) => {
        const room = rooms.get(payload.roomId);
        if (!room) {
            ack(errorAck('Room not found'));
            return;
        }
        const normalized = payload.word?.trim().toLocaleLowerCase('de-DE');
        if (!normalized || normalized.length !== room.settings.wordLength) {
            ack(errorAck('Invalid guess length'));
            return;
        }
        const guess = {
            playerId: payload.playerId,
            word: normalized,
            cells: evaluateGuess(normalized, room.secretWord),
            submittedAt: Date.now(),
        };
        room.guesses.push(guess);
        room.updatedAt = Date.now();
        const state = publicState(room);
        ack(successAck({ state }));
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
        room.phase = 'in-game';
        room.guesses = [];
        room.secretWord = randomWord(room.settings.wordLength);
        room.updatedAt = Date.now();
        const state = publicState(room);
        ack(successAck({ state }));
        io.to(room.id).emit('room:state', state);
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
function publicState(room) {
    const { secretWord, ...state } = room;
    return state;
}
function randomId(prefix) {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
function randomWord(length) {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}
function evaluateGuess(guess, target) {
    const cells = [];
    for (let index = 0; index < guess.length; index++) {
        const letter = guess[index];
        if (letter === target[index]) {
            cells.push({ letter, state: 'correct' });
            continue;
        }
        if (target.includes(letter)) {
            cells.push({ letter, state: 'present' });
            continue;
        }
        cells.push({ letter, state: 'absent' });
    }
    return cells;
}
