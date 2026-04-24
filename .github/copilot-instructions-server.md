# Copilot Instructions: Server Scope (apps/server)

This file defines server-side multiplayer requirements for Wordle rooms.
Use it together with the monorepo baseline instructions.

## Scope
- Applies only to apps/server.
- Node.js and Socket.IO room lifecycle, round lifecycle, validation, and broadcasting.
- Keep state in memory for local development.

## Product Goals To Implement
- Support room creation and join by short code.
- Keep room in lobby phase on creation.
- Allow host to set and update round settings in lobby:
  - time limit,
  - word length.
- Only host can start a round.
- On round start, initialize round state for all players and broadcast snapshot.

## Word and Guess Rules (Critical)
- Server must be authority for target word and guess validation.
- Pick target words from German target word source by selected length.
- Validate guesses against German allowed words source by selected length.
- Keep umlaut and sharp-s support aligned with German rules.
- Do not use random alphabet strings as target words.

## Privacy and Data Exposure Rules (Critical)
- Never expose secret word to clients.
- Never expose other players guessed word strings.
- Do not broadcast raw per-letter guesses for other players.
- Broadcast only safe progress summaries needed by UI.

## Round Progress and Timer
- Implement time-limited rounds.
- Track round start and end timestamps.
- End round when:
  - a player solves,
  - timer expires,
  - or configured game-end conditions are met.
- Broadcast state transitions and final outcomes consistently.

## Player Presence and Rooms
- Track socket to player mapping.
- Mark player connected or disconnected on socket lifecycle events.
- Keep room state consistent if host disconnects.
- Define deterministic host reassignment policy if needed.

## Validation and Security
- Validate payload shape, required fields, and bounds before mutation.
- Reject invalid room codes, unknown players, and illegal transitions.
- Enforce host-only actions on setting updates and round start.

## Acceptance Checklist
- Room create returns short code and lobby snapshot.
- Room join by short code works for multiple players.
- Host can update time limit and word length in lobby.
- Round starts only through host action.
- Guesses are validated server-side against allowed list.
- Clients receive safe progress summaries only.
- Timer behavior and round end are consistent.
- Health endpoint remains available.
- Server builds and tests pass for touched files.
