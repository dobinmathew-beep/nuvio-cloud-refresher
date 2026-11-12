"""Conservative discovery of confirmed upcoming Indian OTT releases.

Only announced/confirmed dates are emitted. Predictions, expected dates and
unverified theatrical-to-OTT estimates are deliberately excluded.
"""
from datetime import datetime, timedelta
from bs4 import BeautifulSoup
import re

SOURCES = [
    ("Cinebuds upcoming calendar", "https://cinebuds.com/ott-releases-this-week/"),
    ("OTTASIA confirmed calendar", "https://ottasia.com/ott-releases-this-week?country=IN"),
    ("New Indian Movies OTT calendar", "https://newindianmovies.com/ott-releases"),
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
    "Lionsgate Play", "ETV Win", "aha",
)
UNCERTAIN = re.compile(r"\b(expected|prediction|predicted|tentative|reported|rumou?red|unconfirmed|not confirmed)\b", re.I)
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

def _record(node, source_name, source_url, today, langs, norm):
    text = node.get_text(" ", strip=True)
    if not text or UNCERTAIN.search(text) or not CONFIRMED.search(text):
        return []
    title_node = _title_link(node)
    if not title_node:
        return []
    name = title_node.get_text(" ", strip=True)
    if not name or len(name) > 140:
        return []
    time_node = node.select_one("time[datetime]")
    day = _date(time_node.get("datetime")) if time_node else None
    if not day:
        for candidate in re.findall(r"\b(?:20\d{2}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\s+20\d{2}|[A-Za-z]{3,9}\s+\d{1,2},?\s+20\d{2})\b", text):
            day = _date(candidate)
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

def _generic(soup, source_name, source_url, today, langs, norm):
    selectors = (
        "article", "tr.ott-row", "[data-release-date]", ".release-card",
        ".ott-card", ".movie-card", ".upcoming-card", "li",
    )
    nodes = []
    seen = set()
    for selector in selectors:
        for node in soup.select(selector):
            marker = (node.name, node.get("id"), node.get("class"), node.get_text(" ", strip=True)[:180])
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
        if not parsed:
            raise ValueError('No verified future DailyOTT records recognised')
        events.extend(parsed)
        health.append({'source': 'DailyOTT upcoming dates', 'url': daily_url, 'state': 'live', 'records': len(parsed)})
    except Exception as error:
        health.append({'source': 'DailyOTT upcoming dates', 'url': daily_url, 'state': 'failed', 'records': 0, 'error': str(error)[:240]})
    recent_url = 'https://cinebuds.com/ott-release-dates/'
    try:
        soup = BeautifulSoup(get(recent_url, False), 'html.parser')
        parsed = _recent_cinebuds(soup, recent_url, today, langs)
        if not parsed:
            raise ValueError('No future Cinebuds recent-listing rows recognised')
        events.extend(parsed)
        health.append({'source': 'Cinebuds recent OTT dates', 'url': recent_url, 'state': 'live', 'records': len(parsed)})
    except Exception as error:
        health.append({'source': 'Cinebuds recent OTT dates', 'url': recent_url, 'state': 'failed', 'records': 0, 'error': str(error)[:240]})
    # TVmaze is also used by the catalog's series discovery pipeline. Query
    # its upcoming web schedule so confirmed future OTT episodes can be marked.
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
        except Exception as error:
            health.append({'source': 'TVmaze upcoming web schedule', 'url': schedule_url, 'state': 'failed', 'records': 0, 'error': str(error)[:240]})
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
            old_rank = (0, old_day) if old_day >= today else (1, old_day)
            new_rank = (0, new_day) if new_day >= today else (1, new_day)
            if new_rank < old_rank:
                for field in ('ottDate', 'releaseKind', 'releaseDateBasis', 'sourceRecord', 'year'):
                    if event.get(field) is not None:
                        old[field] = event[field]
                old['name'] = event.get('name') or old.get('name')
            if not old.get("poster") and event.get("poster"):
                old["poster"] = event["poster"]
    return list(merged.values()), health
