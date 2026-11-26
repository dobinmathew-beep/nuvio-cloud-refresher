"""Select the first real, poster-backed IMDb-linked movie in each IndianRegional catalog order."""
from datetime import datetime, timezone
from pathlib import Path
import json, re, subprocess

SOURCE = 'https://83e20802dcf1-indian-streams.baby-beamup.club'
LANGS = {'hindi': 'hi', 'tamil': 'ta', 'malayalam': 'ml', 'telugu': 'te'}


def get(url):
    p = subprocess.run(
        ['curl', '-fsSL', '--retry', '1', '--connect-timeout', '10', '--max-time', '40', url],
        capture_output=True,
    )
    if p.returncode:
        raise RuntimeError('Catalog download failed; retaining last-good selection')
    return json.loads(p.stdout)


def valid_id(value):
    """General metadata IDs may be IMDb or TMDB."""
    return bool(re.fullmatch(r'tt\d+|tmdb:\d+', str(value or '')))


def valid_center_id(value):
    """Backdrop and reel centre/opening eligibility is IMDb-only."""
    return bool(re.fullmatch(r'tt\d+', str(value or '')))


def valid_backdrop_center_id(value):
    """Keep the historical public backdrop contract: TMDB-only items cannot lead."""
    return valid_center_id(value)


def valid(m, lang=None):
    mid = str(m.get('id', '')).split('||', 1)[0]
    name = str(m.get('name', ''))
    return (
        valid_backdrop_center_id(mid)
        and m.get('type') == 'movie'
        and bool(m.get('poster'))
        and not re.search(r'OTT\s*Releases|Hindi\s*Dubbed|promo|unlock', name, re.I)
    )


def first_valid(metas, lang=None):
    """Return the first eligible IMDb-linked movie in source order; never sort by date."""
    return next((m for m in metas if valid(m, lang)), None)


def select_featured(state):
    state = Path(state)
    state.mkdir(parents=True, exist_ok=True)
    pages_file = state / 'catalog-pages.json'
    pages = json.loads(pages_file.read_text()) if pages_file.exists() else {}
    now = datetime.now(timezone.utc).isoformat()
    languages = {}

    # Fail atomically on source errors. Never substitute an unrelated feed.
    for lang, cat in LANGS.items():
        url = f'{SOURCE}/catalog/movie/{cat}.json'
        data = get(url)
        metas = data.get('metas', [])
        chosen = first_valid(metas, lang)
        if not chosen:
            raise RuntimeError(lang + ': no eligible IMDb-linked catalog head; last-good selection retained')
        pages[url] = {'checked_at': now, 'metas': metas}
        languages[lang] = {
            'id': str(chosen['id']).split('||', 1)[0],
            'name': chosen['name'],
            'poster': chosen['poster'],
            'catalog': cat,
            'type': 'movie',
            'catalog_source': url,
            'selection': 'catalog-order',
            'catalogRank': 0,
            'eligibility': 'IMDb-linked movie',
            'verifiedAt': now,
        }
        print('FEATURED', lang, chosen['name'], 'catalog head', flush=True)

    result = {
        'version': 3,
        'checkedAt': now,
        'selection': 'first eligible IMDb-linked movie in matching IndianRegional catalog order; no external release-date filtering',
        'languages': languages,
        'warnings': [],
    }
    pages_file.write_text(json.dumps(pages))
    (state / 'featured-movies.json').write_text(json.dumps(result, indent=2))
    return result


if __name__ == '__main__':
    import sys
    print(json.dumps(select_featured(Path(sys.argv[1] if len(sys.argv) > 1 else 'state')), indent=2))
