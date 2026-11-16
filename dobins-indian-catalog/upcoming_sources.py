"""Conservative discovery of confirmed upcoming Indian OTT releases.

Only announced/confirmed dates are emitted. Predictions, expected dates and
unverified theatrical-to-OTT estimates are deliberately excluded.
"""
from datetime import datetime, timedelta, date
from bs4 import BeautifulSoup
import re

SOURCES = [
    ("Cinebuds upcoming calendar", "https://cinebuds.com/ott-releases-this-week/"),
    ("OTTASIA confirmed calendar", "https://ottasia.com/ott-releases-this-week?country=IN"),
    ("New Indian Movies OTT calendar", "https://newindianmovies.com/"),
]
LANG_NAMES = {
    "malayalam": "malayalam",
    "tamil": "tamil",
    "telugu": "telugu",
    "hindi": "hindi",
}
PLATFORMS = (
    "Prime Video", "Amazon Prime Video", "Netflix", "JioHotstar",
    "Disney+ Hotstar", "Hotstar", "ZEE5", "SonyLIV", "ManoramaMAX",
    "Manorama Max", "Aha", "Sun NXT", "Simply South", "JioCinema",
    "Lionsgate Play", "ETV Win", "aha", "YouTube", "YouTube Premium",
)
UNCERTAIN = re.compile(r"\b(expected|prediction|predicted|tentative|rumou?red|unconfirmed|not confirmed)\b", re.I)
REPORTED = re.compile(r"\breported\b", re.I)
CONFIRMED = re.compile(r"\b(confirmed|announced|officially announced|makers confirmed|platform confirmed)\b", re.I)
SERIES = re.compile(r"\b(series|web series|tv series|season \d+|mini-series)\b", re.I)
DATE_PATTERNS = (
    "%Y-%m-%d", "%d %B %Y", "%b %d, %Y", "%B %d, %Y",
    "%d %b %Y", "%d/%m/%Y",
)

def _date(text):
    value = str(text or "").strip()[:10] if re.match(r"^\d{4}-\d{2}-\d{2}", str(text or "")) else str(text or "").strip()
    for fmt in DATE_PATTERNS:
        try:
            return datetime.strptime(value, fmt).date().isoformat()
        except ValueError:
            pass
    return None

def _date_with_current_year(text, today):
    parsed = _date(text)
    if parsed:
        return parsed
    value = str(text or '').strip()
    for fmt in ('%a %d %b', '%a %d %B', '%d %b', '%d %B', '%b %d', '%B %d'):
        try:
            part = datetime.strptime(value, fmt)
            year = int(today[:4])
            candidate = date(year, part.month, part.day)
            current = date.fromisoformat(today)
            if candidate < current and (current - candidate).days > 180:
                candidate = date(year + 1, part.month, part.day)
            return candidate.isoformat()
        except ValueError:
            pass
    return None

def _languages(text, langs):
    lower = str(text or "").lower()
    found = [name for name in LANG_NAMES if name in langs and re.search(r"\b" + re.escape(name) + r"\b", lower)]
    return list(dict.fromkeys(found))

def _title_link(node):
    for selector in (".ott-title", "h2 a", "h3 a", "h4 a", "[itemprop='name'] a"):
        a = node.select_one(selector)
        if a and a.get_text(" ", strip=True):
            return a
    links = [a for a in node.select("a[href]") if len(a.get_text(" ", strip=True)) > 2]
    return max(links, key=lambda a: len(a.get_text(" ", strip=True))) if links else None

def _record(node, source_name, source_url, today, langs, norm, trusted_context=False):
    text = node.get_text(" ", strip=True)
    if not text or UNCERTAIN.search(text) or not (CONFIRMED.search(text) or REPORTED.search(text) or trusted_context):
        return []
    title_node = _title_link(node)
    if not title_node:
        return []
    name = title_node.get_text(" ", strip=True)
    if not name or len(name) > 140:
        return []
    time_node = node.select_one("time[datetime]")
    day = _date_with_current_year(time_node.get("datetime"), today) if time_node else None
    if not day:
        for candidate in re.findall(r"\b(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+)?\d{1,2}\s+[A-Za-z]{3,9}(?:\s+20\d{2})?|\b20\d{2}-\d{2}-\d{2}|\b[A-Za-z]{3,9}\s+\d{1,2},?(?:\s+20\d{2})?", text):
            day = _date_with_current_year(candidate, today)
            if day:
                break
    if not day or day < today:
        return []
    language_node = node.select_one(".ott-lang, [data-language], [itemprop='inLanguage']")
    language_text = language_node.get_text(" ", strip=True) if language_node else text
    # Prefer an explicitly declared original language. Otherwise accept only a
    # single language, or the primary language before "also/dubbed/available in".
    explicit = re.search(r"original(?:ly)?\s+language\s*[:=-]\s*(malayalam|tamil|telugu|hindi)\b", text, re.I)
    if explicit:
        languages = [explicit.group(1).lower()]
    else:
        primary_text = re.split(r"\b(?:also\s+in|dubbed\s+in|available\s+in|languages?\s*[:=-])\b", language_text, maxsplit=1, flags=re.I)[0]
        languages = _languages(primary_text, langs)
        if len(languages) != 1:
            languages = _languages(language_text, langs)
        if len(languages) != 1:
            return []
    kind_node = node.select_one(".ott-type, .ott-kind, [data-type], [itemprop='genre']")
    kind_text = (kind_node.get_text(" ", strip=True) if kind_node else "") + " " + text
    typ = "series" if SERIES.search(kind_text) else "movie"
    platform_text = text
    platforms = [p for p in PLATFORMS if re.search(re.escape(p), platform_text, re.I)]
    platforms = list(dict.fromkeys(platforms))
    if not platforms:
        return []
    image = node.select_one("img[src]")
    poster = image.get("src") if image else None
    href = title_node.get("href")
    detail = href if href and href.startswith("http") else (source_url.rstrip("/") + "/" + href.lstrip("/") if href else None)
    return [{
        "name": name, "language": language, "type": typ, "ottDate": day,
        "platforms": platforms, "poster": poster, "year": None,
        "source": source_url, "sources": [source_url],
        "detail": detail, "confirmed": True, "releaseKind": "digital",
        "releaseDateBasis": "confirmed announcement",
        "sourceRecord": {"title": name, "releaseDate": day, "source": source_url},
    } for language in languages]

def _cinebuds(soup, source_name, source_url, today, langs, norm):
    rows = soup.select("tr.ott-row")
    if not rows:
        rows = soup.select("table.ott-table--upcoming tr, table tr")
    out = []
    for row in rows:
        out.extend(_record(row, source_name, source_url, today, langs, norm))
    return out


def _links_between_headings(soup, start_text, end_text):
    """Return links inside a named section, stopping before the next section."""
    active = False
    out = []
    for node in soup.descendants:
        if getattr(node, 'name', None) in ('h1', 'h2', 'h3', 'h4'):
            heading = node.get_text(' ', strip=True).lower()
            if start_text.lower() in heading:
                active = True
                continue
            if active and end_text.lower() in heading:
                break
        elif active and getattr(node, 'name', None) == 'a' and node.get('href'):
            out.append(node)
    return out


def _ottasia(soup, source_name, source_url, today, langs, norm):
    """Parse only OTTASIA's explicitly confirmed upcoming section, never predictions."""
    links = _links_between_headings(
        soup, 'Upcoming OTT releases in India: confirmed dates', 'Predicted next on OTT'
    )
    out = []
    seen = set()
    for anchor in links:
        title = anchor.get_text(' ', strip=True)
        if not title or len(title) < 3:
            continue
        node = None
        for parent in anchor.parents:
            if getattr(parent, 'name', None) not in ('div', 'li', 'article', 'section'):
                continue
            text = parent.get_text(' ', strip=True)
            has_language = re.search(r'\b(?:malayalam|tamil|telugu|hindi)\b', text, re.I)
            has_date = re.search(r'\b(?:\d{1,2}\s+[A-Za-z]{3,9}|[A-Za-z]{3,9}\s+\d{1,2})', text)
            has_platform = any(re.search(re.escape(p), text, re.I) for p in PLATFORMS)
            if has_language and has_date and has_platform:
                node = parent
                break
        if not node:
            continue
        marker = (title.lower(), node.get_text(' ', strip=True)[:220])
        if marker in seen:
            continue
        seen.add(marker)
        out.extend(_record(node, source_name, source_url, today, langs, norm, trusted_context=True))
    return out


def _new_indian_movies(soup, source_name, source_url, today, langs, norm):
    """Parse dated OTT cards from New Indian Movies' 'New on OTT this week' rail."""
    links = _links_between_headings(soup, 'New on OTT this week', 'In cinemas now')
    out = []
    seen = set()
    date_re = re.compile(r'\b(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+)?\d{1,2}\s+[A-Za-z]{3,9}(?:\s+20\d{2})?\b', re.I)
    for anchor in links:
        raw = anchor.get_text(' ', strip=True)
        if not raw or re.search(r'\bcinemas?\b', raw, re.I):
            continue
        date_match = date_re.search(raw)
        if not date_match:
            continue
        day = _date_with_current_year(date_match.group(0), today)
        if not day or day < today:
            continue
        languages = _languages(raw, langs)
        if len(languages) != 1:
            continue
        platforms = [p for p in PLATFORMS if re.search(re.escape(p), raw, re.I)]
        if not platforms:
            continue
        name = raw[date_match.end():]
        for language in LANG_NAMES:
            name = re.sub(r'\b' + re.escape(language) + r'\b', ' ', name, flags=re.I)
        for platform in sorted(PLATFORMS, key=len, reverse=True):
            name = re.sub(re.escape(platform), ' ', name, flags=re.I)
        name = re.sub(r'\b(?:series|film|new|streaming|ott)\b', ' ', name, flags=re.I)
        name = re.sub(r'[·|•→]+', ' ', name)
        name = re.sub(r'\s+', ' ', name).strip(' -–—')
        if not name:
            continue
        key = (languages[0], norm(name))
        if key in seen:
            continue
        seen.add(key)
        image = anchor.select_one('img[src]')
        href = anchor.get('href')
        detail = href if href and href.startswith('http') else (source_url.rstrip('/') + '/' + href.lstrip('/') if href else None)
        out.append({
            'name': name, 'language': languages[0],
            'type': 'series' if SERIES.search(raw) else 'movie',
            'ottDate': day, 'platforms': list(dict.fromkeys(platforms)),
            'poster': image.get('src') if image else None, 'year': None,
            'source': source_url, 'sources': [source_url], 'detail': detail,
            'confirmed': True, 'releaseKind': 'digital',
            'releaseDateBasis': 'confirmed or reported OTT calendar date',
            'sourceRecord': {'title': name, 'releaseDate': day, 'source': source_url}
        })
    return out


def _generic(soup, source_name, source_url, today, langs, norm):
    selectors = (
        "article", "tr.ott-row", "[data-release-date]", ".release-card",
        ".ott-card", ".movie-card", ".upcoming-card", "li",
    )
    nodes = []
    seen = set()
    for selector in selectors:
        for node in soup.select(selector):
            marker = (node.name, node.get("id"), tuple(node.get("class") or []), node.get_text(" ", strip=True)[:180])
            if marker in seen:
                continue
            seen.add(marker)
            nodes.append(node)
    out = []
    for node in nodes:
        out.extend(_record(node, source_name, source_url, today, langs, norm))
    return out

def _dailyott(rows, source_url, today, langs):
    out = []
    for row in rows:
        day = str(row.get('releaseDate') or '')[:10]
        typ = {'Movie': 'movie', 'Series': 'series'}.get(row.get('type'))
        if not typ or not re.fullmatch(r'20\d{2}-\d{2}-\d{2}', day) or day < today:
            continue
        if not (row.get('verified') or row.get('source_verified')):
            continue
        details = row.get('tmdbDetails') or {}
        original = str(details.get('originalLanguage') or row.get('original_language') or '').lower()
        language = next((name for name, code in langs.items() if original in (name, code)), None)
        if not language:
            raw = [str(x).lower() for x in row.get('languages', [])]
            found = [name for name in langs if name in raw]
            if len(found) != 1:
                continue
            language = found[0]
        platform = str(row.get('platform') or '').strip()
        title = str(row.get('title') or '').strip()
        if not platform or not title:
            continue
        out.append({'name': title, 'language': language, 'type': typ, 'ottDate': day,
            'platforms': [platform], 'poster': row.get('posterUrl'),
            'year': str(details.get('releaseDate') or '')[:4] or None,
            'source': source_url, 'sources': [source_url], 'confirmed': True,
            'releaseKind': 'digital', 'releaseDateBasis': 'verified DailyOTT date',
            'sourceRecord': row})
    return out

def _recent_cinebuds(soup, source_url, today, langs):
    out = []
    for row in soup.select('table.ott-table--recent tr.ott-row'):
        time_node = row.select_one('time[datetime]')
        title_node = row.select_one('.ott-title')
        lang_node = row.select_one('.ott-lang')
        if not time_node or not title_node or not lang_node:
            continue
        day = _date(time_node.get('datetime'))
        if not day or day < today:
            continue
        lang_text = lang_node.get_text(' ', strip=True)
        primary = re.split(r'\b(?:also\s+in|dubbed\s+in|available\s+in)\b', lang_text, maxsplit=1, flags=re.I)[0]
        found = _languages(primary, langs)
        if len(found) != 1:
            continue
        text = row.get_text(' ', strip=True)
        platforms = [p for p in PLATFORMS if re.search(re.escape(p), text, re.I)]
        if not platforms or UNCERTAIN.search(text):
            continue
        title = title_node.get_text(' ', strip=True)
        if not title:
            continue
        out.append({'name': title, 'language': found[0], 'type': 'series' if SERIES.search(text) else 'movie',
            'ottDate': day, 'platforms': list(dict.fromkeys(platforms)), 'poster': None,
            'year': None, 'source': source_url, 'sources': [source_url],
            'confirmed': True, 'releaseKind': 'digital', 'releaseDateBasis': 'Cinebuds dated OTT listing',
            'sourceRecord': {'title': title, 'releaseDate': day, 'source': source_url}})
    return out

def collect(get, today, langs, norm):
    events = []
    health = []
    for name, url in SOURCES:
        try:
            html = get(url, False)
            soup = BeautifulSoup(html, "html.parser")
            if "cinebuds.com" in url:
                rows = _cinebuds(soup, name, url, today, langs, norm)
            elif "ottasia.com" in url:
                rows = _ottasia(soup, name, url, today, langs, norm)
            elif "newindianmovies.com" in url:
                rows = _new_indian_movies(soup, name, url, today, langs, norm)
            else:
                rows = _generic(soup, name, url, today, langs, norm)
            # A page returning HTML is not enough: report a parser failure if
            # its structure yielded no confirmed, dated records.
            if not rows:
                raise ValueError("No confirmed upcoming rows recognised")
            events.extend(rows)
            health.append({"source": name, "url": url, "state": "live", "records": len(rows)})
        except Exception as error:
            health.append({"source": name, "url": url, "state": "failed", "records": 0, "error": str(error)[:240]})
    # Re-check the primary sources used by the main catalog collector. Their
    # future dates were previously filtered out before the Coming badge stage.
    daily_url = 'https://www.dailyott.in/api/movies?limit=200&page=1'
    try:
        first = get(daily_url)
        if first.get('status') != 'success':
            raise ValueError('DailyOTT API did not return success')
        daily_rows = list(first.get('movies', []))
        pages = min(int(first.get('totalPages', 1)), 8)
        for page in range(2, pages + 1):
            daily_rows.extend(get(f'https://www.dailyott.in/api/movies?limit=200&page={page}').get('movies', []))
        parsed = _dailyott(daily_rows, 'https://www.dailyott.in/', today, langs)
        if parsed:
            events.extend(parsed)
            health.append({'source': 'DailyOTT upcoming dates', 'url': daily_url, 'state': 'live', 'records': len(parsed)})
        else:
            health.append({'source': 'DailyOTT upcoming dates', 'url': daily_url, 'state': 'no_confirmed_upcoming', 'records': 0, 'note': 'DailyOTT is live; no verified future dates were present in the returned API pages.'})
    except Exception as error:
        health.append({'source': 'DailyOTT upcoming dates', 'url': daily_url, 'state': 'failed', 'records': 0, 'error': str(error)[:240]})
    # Recent Cinebuds arrivals are already ingested by the primary collector above.
    # Its recent table contains past release dates by design, so zero future
    # rows there is not a parser failure.
    recent_url = 'https://cinebuds.com/ott-release-dates/'
    health.append({'source': 'Cinebuds recent OTT dates', 'url': recent_url, 'state': 'covered_by_primary_collector', 'records': 0})
    # TVmaze is also used by the catalog's series discovery pipeline. Query
    # its upcoming web schedule so confirmed future OTT episodes can be marked.
    tvmaze_records = 0
    tvmaze_errors = 0
    for offset in range(1, 15):
        day = (datetime.fromisoformat(today) + timedelta(days=offset)).date().isoformat()
        schedule_url = 'https://api.tvmaze.com/schedule/web?date=' + day
        try:
            for episode in get(schedule_url):
                show = (episode.get('_embedded') or {}).get('show') or episode.get('show') or {}
                language = str(show.get('language') or '').lower()
                release_day = str(episode.get('airdate') or '')[:10]
                channel = show.get('webChannel') or {}
                if language not in langs or release_day < today or not channel.get('name') or not show.get('name'):
                    continue
                events.append({'name': show['name'], 'language': language, 'type': 'series',
                    'ottDate': release_day, 'platforms': [channel['name']], 'poster': (show.get('image') or {}).get('original'),
                    'year': str(show.get('premiered') or '')[:4] or None, 'source': 'https://api.tvmaze.com/schedule/web',
                    'sources': ['https://api.tvmaze.com/schedule/web', show.get('url', 'https://www.tvmaze.com/')],
                    'confirmed': True, 'releaseKind': 'digital', 'releaseDateBasis': 'TVmaze scheduled web episode',
                    'sourceRecord': {'title': show['name'], 'releaseDate': release_day, 'source': schedule_url}})
                tvmaze_records += 1
        except Exception:
            tvmaze_errors += 1
    health.append({'source': 'TVmaze upcoming web schedule', 'url': 'https://api.tvmaze.com/schedule/web', 'state': 'live' if tvmaze_errors < 14 else 'failed', 'records': tvmaze_records, 'errors': tvmaze_errors})
    # Deduplicate language/title/date rows while preserving corroborating URLs.
    merged = {}
    for event in events:
        key = (event["language"], event["type"], norm(event["name"]))
        if key not in merged:
            merged[key] = event
        else:
            old = merged[key]
            old["sources"] = list(dict.fromkeys(old.get("sources", []) + event.get("sources", [])))
            old["platforms"] = list(dict.fromkeys(old.get("platforms", []) + event.get("platforms", [])))
            old_day = str(old.get('ottDate') or '')
            new_day = str(event.get('ottDate') or '')
            old_rank = (0, old_day) if old_day > today else (1, old_day)
            new_rank = (0, new_day) if new_day > today else (1, new_day)
            if new_rank < old_rank:
                for field in ('ottDate', 'releaseKind', 'releaseDateBasis', 'sourceRecord', 'year'):
                    if event.get(field) is not None:
                        old[field] = event[field]
                old['name'] = event.get('name') or old.get('name')
            if not old.get("poster") and event.get("poster"):
                old["poster"] = event["poster"]
    return list(merged.values()), health
