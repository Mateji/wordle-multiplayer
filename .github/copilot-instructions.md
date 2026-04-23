# Copilot Instructions for this Monorepo

These instructions define the baseline architecture and product behavior. Future changes must preserve this baseline unless explicitly requested.

## Repository Architecture (Critical)
- This repository is a monorepo with these roots:
  - `apps/client`: Angular frontend.
  - `apps/server`: Multiplayer backend (Node.js + Socket.IO).
  - `packages/shared`: Shared multiplayer contracts (types/events/payloads).
- Keep multiplayer event names, payloads, and shared DTOs in `packages/shared`.
- Do not duplicate event contract definitions in client or server.
- Any change in shared contracts must be reflected in both client and server usage.

## Package and Workspace Rules
- Use `pnpm` workspaces from repository root.
- Keep workspace packages under `apps/*` and `packages/*`.
- Root scripts should orchestrate package scripts; package-local scripts should run package-local tasks.

## Core Product Baseline (Client)
- Keep this app as a German Wordle variant with umlaut support (`ä`, `ö`, `ü`, `ß`).
- Keep `target-words.json` as the source for target words.
- Keep `allowed-words.json` as the source for valid guesses.
- Only accept guesses that exist in the allowed list for the current word length.

## Layout Baseline (Client, Critical)
- A top action bar exists at the top edge of the viewport.
- The top bar currently contains one action button: `Neues Spiel`.
- The game area below the top bar is horizontally centered.
- Initial state:
  - input row block sits directly above the keyboard block,
  - keyboard + input block are vertically centered in the available game area.
- New rows must be added beneath the previous active row (normal list growth), while the visible block behavior must feel like it grows upward from the keyboard.

## Growth and Scroll Behavior (Client, Critical)
- Input rows must stay visually attached above the keyboard (defined spacing, no large jump).
- As rows increase:
  - first, the keyboard is allowed to move downward within the available area,
  - once the keyboard reaches the lower bound, keyboard position must remain fixed,
  - from that point on, only the input-row region may scroll.
- Do not introduce page-level double scrolling for normal gameplay.
- Horizontal overflow is not allowed.

## Error Feedback Baseline (Client)
- Invalid word submission must:
  - mark the active row red,
  - trigger a shake animation,
  - show a German error message (`Kein gueltiges Wort.`),
  - clear the row after the shake,
  - fade out the message after the configured delay.
- Error message must not clip into input boxes.
- Error feedback must be repeatable on consecutive invalid submissions.

## Win Flow Baseline (Client)
- On correct guess:
  - no new input row is appended,
  - a win popup appears with score/tries,
  - popup includes action to start a new round,
  - popup includes close/cancel action.
- `Neues Spiel` in top bar resets game state and starts a fresh round.

## Server Rules
- Keep `apps/server` stateless enough for local development and simple in-memory room handling.
- Expose health endpoint for local checks.
- Validate payload shape/length on server before applying state changes.
- Broadcast room state updates through shared typed events.

## Performance and Stability Rules
- Avoid layout thrash/flicker when adding rows.
- When changing dynamic layout calculations, keep updates batched and stable.
- Prefer minimal targeted CSS/TS changes over broad rewrites.

## Change Policy
- If a requested feature conflicts with any critical baseline above, call out the conflict before implementation and propose a compatible approach.
- When implementing new features, keep existing behavior unchanged by default and extend around it.
