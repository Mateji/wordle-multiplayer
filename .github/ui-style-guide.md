# Urban Graffiti Punk UI Style Guide

We are styling a multiplayer Wordle clone with an Urban Graffiti Punk aesthetic.

Core style:
- off-white gritty background
- thick black outlines
- sticker-like cards
- slightly rotated panels
- neon accent colors: lime, cyan, magenta, yellow
- jagged display typography for headings
- clean readable font for inputs and labels
- graffiti arrows connecting related UI elements
- halftone dots, tape strips, small crown/star/lightning doodles
- real UI text must stay readable and selectable, not baked into images

Do:
- Use CSS variables for colors, spacing, borders and shadows.
- Use semantic HTML and accessible form labels.
- Keep inputs usable.
- Make decorative elements non-interactive.
- Prefer CSS/SVG decorations over image-only UI.
- Use reusable classes like .punk-card, .punk-button, .graffiti-label.

Do not:
- Replace functional text with images.
- Make every element rotated.
- Overload form controls with unreadable fonts.
- Add huge dependencies unless necessary.