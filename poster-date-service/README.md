# Great Indian Upcoming Poster Service

An isolated per-title poster proxy for Xperience, AIOMetadata and the Great Indian Catalog. It preserves BetterPosters artwork, detects existing badges with OCR, adds a confirmed future-date label when needed, and adds a "Just Added" badge for newly published catalog movies when BetterPosters has no matching tag.

## Isolation
- Lives in its own `poster-date-service/` directory.
- Intended for its own Vercel project with this directory as the root.
- Does not import, edit, or execute the existing catalog worker, manifest, refresh scripts, media jobs, or episode badge code.
- Uses a separate branch and separate deployment target.

## URL pattern
`https://YOUR-SERVICE-DOMAIN/poster/{imdb_id}.jpg`

The service substitutes the IMDb ID into the BetterPosters template. It deliberately uses the standard `/poster/` route (not `/poster-q/`). The `rs=IM` query selects IMDb as the rating source; it is not a quality-tag switch.
`https://btttr.cc/poster/imdb/poster-default/{imdb_id}.jpg?rs=IM`

## Existing BetterPosters tag handling
- The original image's top tag row is checked with English OCR.
- If it already contains a "Coming [day month]" label, the source poster is returned unchanged and no second badge is added.
- If OCR confirms a matching "Coming [date]" tag, the source poster is returned unchanged.
- For an explicit `?badge=just-added` request, OCR checks whether BetterPosters already has a "Just Added" tag. If not, the service draws one on the original image. If OCR is unavailable, it applies the requested badge rather than silently omitting it.
- OCR results are cached in memory by source-image hash to avoid repeating work for the same image.

## Just Added badge rules
- The Great Indian Catalog sends `?badge=just-added` only for movie entries newly added to that catalog; the catalog keeps the first-added timestamp for 14 days.
- The service checks BetterPosters for an existing "Just Added" label and avoids stacking a duplicate.
- When BetterPosters has no such label, the service adds a compact dark-glass "Just Added" chip without cropping or resizing the poster.
- This badge is separate from upcoming release labels; only already-released newly added movies are sent this request.

## Release date rules
- TMDB is the metadata source.
- For films, prefer future India (IN) dates, then US and GB; if none are present, use the earliest future announced country date.
- For series, use the next episode date, or a future premiere date.
- Past and malformed dates are ignored, with "today" evaluated in the `Asia/Muscat` time zone.
- Provider dates that contain only a calendar date remain unchanged (for example, a source-listed `2026-11-13` stays `NOV 13`); the service does not invent a release time or shift a date-only value across time zones.
- When a source provides an actual release instant, any future local-time conversion must use that instant and its source time zone rather than guessing from a date-only listing.
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
