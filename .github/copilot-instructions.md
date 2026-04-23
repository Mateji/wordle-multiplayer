# Copilot Instructions for this Wordle Project

These instructions define the current UX and behavior baseline. Future changes must preserve this baseline unless the user explicitly requests a change.

## Core Product Baseline
- Keep this app as a German Wordle variant with umlaut support (`ä`, `ö`, `ü`, `ß`).
- Keep `target-words.json` as the source for target words.
- Keep `allowed-words.json` as the source for valid guesses.
- Only accept guesses that exist in the allowed list for the current word length.

## Layout Baseline (Critical)
- A top action bar exists at the top edge of the viewport.
- The top bar currently contains one action button: `Neues Spiel`.
- The game area below the top bar is horizontally centered.
- Initial state:
  - input row block sits directly above the keyboard block,
  - keyboard + input block are vertically centered in the available game area.
- New rows must be added beneath the previous active row (normal list growth), while the visible block behavior must feel like it grows upward from the keyboard.

## Growth and Scroll Behavior (Critical)
- Input rows must stay visually attached above the keyboard (defined spacing, no large jump).
- As rows increase:
  - first, the keyboard is allowed to move downward within the available area,
  - once the keyboard reaches the lower bound, keyboard position must remain fixed,
  - from that point on, only the input-row region may scroll.
- Do not introduce page-level double scrolling for normal gameplay.
- Horizontal overflow is not allowed.

## Error Feedback Baseline
- Invalid word submission must:
  - mark the active row red,
  - trigger a shake animation,
  - show a German error message (`Kein gueltiges Wort.`),
  - clear the row after the shake,
  - fade out the message after the configured delay.
- Error message must not clip into input boxes.
- Error feedback must be repeatable on consecutive invalid submissions.

## Win Flow Baseline
- On correct guess:
  - no new input row is appended,
  - a win popup appears with score/tries,
  - popup includes action to start a new round,
  - popup includes close/cancel action.
- `Neues Spiel` in top bar resets game state and starts a fresh round.

## Typography and Visual Baseline
- Global text style should remain sans-serif.
- Keyboard and letter inputs must remain visually readable and balanced on desktop/tablet/mobile.
- Avoid regressions that make keys collapse too narrow or overflow viewport.

## Performance and Stability Rules
- Avoid layout thrash/flicker when adding rows.
- When changing dynamic layout calculations, keep updates batched and stable.
- Prefer minimal targeted CSS/TS changes over broad rewrites.

## Change Policy
- If a requested feature conflicts with any critical baseline above, call out the conflict before implementation and propose a compatible approach.
- When implementing new features, keep existing behavior unchanged by default and extend around it.
