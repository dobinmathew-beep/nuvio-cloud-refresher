# Great Indian Upcoming Poster Service

An isolated per-title poster proxy for Xperience and AIOMetadata. It fetches the original BetterPosters image and only adds a date badge when TMDB returns a confirmed future date.

## Isolation
- Lives in its own \`poster-date-service/\` directory.
- Intended for its own Vercel project with this directory as the root.
- Does not import, edit, or execute the existing catalog worker, manifest, refresh scripts, media jobs, or episode badge code.
- Uses a separate branch and separate deployment target.

## URL pattern
\`https://YOUR-SERVICE-DOMAIN/poster/{imdb_id}.jpg\`

The service substitutes the IMDb ID into the existing BetterPosters template:
\`https://btttr.cc/poster-q/imdb/poster-default/{imdb_id}.jpg?rs=IM\`

## Release date rules
- TMDB is the metadata source.
- For films, prefer future India (IN) dates, then US and GB; if none are present, use the earliest future announced country date.
- For series, use the next episode date, or a future premiere date.
- Past and malformed dates are ignored.
- Without an API key, a confirmed date, or a successful date lookup, the original BetterPosters bytes are returned unchanged.
- The date is checked against the current UTC day on every request, so a cached metadata date cannot keep showing after it passes.

## Image treatment
The source poster is not cropped or resized. The glass-gradient badge is composited over a softly blurred patch of the original image. It is placed below the top tag row, leaving the top corners free for BetterPosters labels. The output retains the source image format and dimensions.

## Required environment variable
Set \`TMDB_API_KEY\` in the separate Vercel project for Production and Preview. The key is not committed to this repository.

## Local checks
\`npm test\`

## Endpoints
- \`/poster/tt1234567.jpg\` — image endpoint
- \`/health\` — reports whether the TMDB key is configured
- \`/\` — service landing page and URL instructions