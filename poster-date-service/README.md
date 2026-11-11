# Great Indian Upcoming Poster Service

An isolated per-title poster proxy for Xperience and AIOMetadata. It fetches the original BetterPosters image and only adds a date label when TMDB returns a confirmed future date and BetterPosters does not already show its own "Coming [date]" tag.

## Isolation
- Lives in its own `poster-date-service/` directory.
- Intended for its own Vercel project with this directory as the root.
- Does not import, edit, or execute the existing catalog worker, manifest, refresh scripts, media jobs, or episode badge code.
- Uses a separate branch and separate deployment target.

## URL pattern
`https://YOUR-SERVICE-DOMAIN/poster/{imdb_id}.jpg`

The service substitutes the IMDb ID into the BetterPosters template:
`https://btttr.cc/poster/imdb/poster-default/{imdb_id}.jpg`

## Existing BetterPosters tag handling
- The original image's top tag row is checked with English OCR.
- If it already contains a "Coming [day month]" label, the source poster is returned unchanged and no second badge is added.
- If OCR cannot run, the service fails safely and returns the original poster rather than risk stacking duplicate labels.
- OCR results are cached in memory by source-image hash to avoid repeating work for the same image.

## Release date rules
- TMDB is the metadata source.
- For films, prefer future India (IN) dates, then US and GB; if none are present, use the earliest future announced country date.
- For series, use the next episode date, or a future premiere date.
- Past and malformed dates are ignored.
- Without an API key or a confirmed future date, the original BetterPosters bytes are returned unchanged.

## Image treatment
- The source poster is not cropped or resized.
- If needed, the added label uses a compact, bold white sans-serif "Coming [day month]" style with a subtle dark glass chip.
- It retains the existing approved overlay anchor and original image dimensions and format.

## Required environment variable
Set `TMDB_API_KEY` in the separate service environment. The key is not committed to this repository.

## Local checks
`npm test`

## Endpoints
- `/poster/tt1234567.jpg` — image endpoint
- `/health` — reports whether the TMDB key is configured
- `/` — service landing page and URL instructions
