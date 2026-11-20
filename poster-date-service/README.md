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
- Every normal GET through the shared URL checks the BetterPosters top tag row for an existing "Just Added" label. When found, the service replaces it with the exact title-case "Just Added" artwork. This normalization applies to Xperience, both AIOmetadata instances, and the Great Indian catalogs whenever they use this URL.
- An explicit `?badge=just-added` request forces the same artwork even when BetterPosters has no such label. The caller should send this flag only for titles that are genuinely newly added.
- OCR results are cached in memory by source-image hash to avoid repeating work for the same image.

## Just Added badge rules
- The Great Indian Catalog sends `?badge=just-added` for movie entries newly added to that catalog; the catalog keeps the first-added timestamp for 14 days.
- Other clients automatically receive title-case normalization when BetterPosters itself already marks the poster "Just Added".
- For a title that BetterPosters does not mark, another client must pass `?badge=just-added` only when its own catalog metadata confirms that the title is newly added. The shared poster service cannot infer a title's first-added date from an IMDb ID alone.
- When the flag is present, the service adds a compact dark-glass "Just Added" chip without cropping or resizing the poster.
- This badge is separate from upcoming release labels. A title is not marked "Just Added" merely because it passes through the shared URL.

## Release date rules
- TMDB is the metadata source.
- For films, prefer future India (IN) dates, then US and GB; if none are present, use the earliest future announced country date.
- For series, use the next episode date, or a future premiere date.
- Past and malformed dates are ignored, with "today" evaluated in the `Asia/Muscat` time zone.
- Provider dates that contain only a calendar date remain unchanged (for example, a source-listed `2026-11-13` stays `NOV 13`); the service does not invent a release time or shift a date-only value across time zones.
- When a source provides an actual release instant, any future local-time conversion must use that instant and its source time zone rather than guessing from a date-only listing.
- Without a TMDB API key/read token or a confirmed future date, the original BetterPosters bytes are returned unchanged (except for a detected BetterPosters "Just Added" tag, which is normalized).

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
