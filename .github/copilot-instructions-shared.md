# Copilot Instructions: Shared Contracts Scope (packages/shared)

This file defines shared multiplayer contract requirements.
Use it together with the monorepo baseline instructions.

## Scope
- Applies only to packages/shared.
- Single source of truth for multiplayer events, DTOs, and snapshots.
- Any contract change must be consumed by both client and server.

## Contract Goals To Implement
- Model full room lifecycle:
  - lobby,
  - in-game,
  - finished.
- Model host-controlled settings including:
  - word length,
  - time limit,
  - optional max guesses if retained.
- Model round timing fields needed by clients:
  - round start time,
  - round end time,
  - remaining status.

## Multiplayer Progress Contract (Critical)
- Include player list and presence fields.
- Include safe per-player progress summary for UI strips:
  - fixed-size progress cells based on selected word length,
  - cell states limited to unset, present, correct.
- Do not include other players letters or guessed word strings in public room snapshots.

## Event Design Requirements
- Define events for:
  - room create,
  - room join,
  - lobby settings update,
  - round start,
  - guess submit,
  - round reset or new round,
  - room state broadcast,
  - typed server errors.
- Keep ack payloads explicit and strongly typed.
- Keep event names stable once introduced.

## Backward Safety Rules
- Prefer additive changes where possible.
- If breaking changes are required, update both apps in same implementation.
- Keep naming consistent and domain-focused.

## Acceptance Checklist
- Shared package exports all multiplayer contracts from one entry point.
- Client and server compile against updated contracts without local redefinitions.
- Contracts cover lobby, timer, host settings, and safe player progress.
- No sensitive gameplay data is present in public snapshot types.
- Shared package builds and tests pass for touched files.
