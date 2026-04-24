# Copilot Instructions: Client Scope (apps/client)

This file defines client-side implementation requirements for multiplayer Wordle.
Use it together with the monorepo baseline instructions.

## Scope
- Applies only to apps/client.
- Angular UI and state orchestration for lobby and in-game multiplayer flow.
- Do not move event contracts into client. Contracts stay in packages/shared.

## Product Goals To Implement
- Add room creation flow with player name and host settings.
- Add room join flow by short room code.
- Show lobby before game start.
- Host can configure:
  - time limit,
  - word length.
- Host starts the round explicitly.
- During rounds, each player sees all player names and a progress strip for each other player.

## Player Progress UI Rules (Critical)
- For every player, show exactly N small boxes where N is the selected word length.
- Boxes are gray by default.
- As that player discovers progress, boxes turn yellow or green.
- Do not reveal letters in these boxes.
- Do not reveal guessed words of other players.
- Progress indicator must communicate how much is discovered, not which letters were discovered.

## Required Architecture
- Add a dedicated multiplayer client service layer for socket connection and typed events.
- Use shared types from packages/shared for all payloads and snapshots.
- Keep local UI state driven by server snapshots and optimistic updates only where safe.
- Keep existing single-player visual baselines unless feature requires extension.

## UX and Layout Constraints
- Preserve existing top bar and gameplay layout behavior from baseline instructions.
- Add lobby and room controls without introducing layout jumps in gameplay area.
- Keep keyboard and row growth behavior stable.
- No horizontal overflow.
- Keep German copy for user-facing messages where possible.

## Validation and Error Handling
- Handle and render room errors from server.
- Validate user input client-side before emit:
  - non-empty player name,
  - valid short code format,
  - allowed setting ranges.
- Show clear feedback for failed create, join, and start actions.

## Acceptance Checklist
- User can create a room and receive a short code.
- Another user can join via short code.
- Host can configure time limit and word length in lobby.
- Round starts only after host action.
- All players see each participant name.
- Each player row has a gray-to-yellow-green progress strip sized to word length.
- No other player letters or guessed words are exposed.
- Client compiles and tests pass for touched files.
