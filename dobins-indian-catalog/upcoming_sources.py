import json
"""Conservative discovery of confirmed upcoming Indian OTT releases.

Only announced/confirmed dates are emitted. Predictions, expected dates and
unverified theatrical-to-OTT estimates are deliberately excluded.
"""
from datetime import datetime, timedelta, date
from urllib.parse import urljoin, urlsplit
from bs4 import BeautifulSoup
import re

SOURCES = [
    ("Cinebuds upcoming calendar", "https://cinebuds.com/ott-releases-this-week/"),
    ("OTTASIA confirmed calendar", "https://ottasia.com/ott-releases-this-week?country=IN"),
    ("Vi weekly OTT calendar", "https://www.myvi.in/blog/ott-releases-this-week"),
    ("Vi Malayalam weekly OTT calendar", "https://www.myvi.in/blog/malayalam-ott-releases-this-week"),
    ("Vi monthly OTT calendar", "https://www.myvi.in/blog/ott-releases-this-month"),
    ("Simply Mollywood Malayalam OTT calendar", "https://simplymollywood.com/ott"),
    ("New Indian Movies OTT calendar", "https://newindianmovies.com/"),
    ("Indian Movie Reviews OTT calendar", "https://indianmoviereviews.com/ott-releases/"),
    ("OTTClock confirmed upcoming calendar", "https://ottclock.com/upcoming-ott-releases/"),
    ("OTTChecker Malayalam recent releases", "https://www.ottchecker.com/ott-releases/malayalam"),
    ("OTTChecker Tamil recent releases", "https://www.ottchecker.com/ott-releases/tamil"),
    ("OTTChecker Telugu recent releases", "https://www.ottchecker.com/ott-releases/telugu"),
    ("OTTChecker Hindi recent releases", "https://www.ottchecker.com/ott-releases/hindi"),
    ("Kerala TV multi-language OTT releases", "https://www.keralatv.in/channel/ott/"),
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
    "Lionsgate Play", "ETV Win", "aha", "YouTube", "YouTube Premium", "SimplySouth",
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
    raw_name = title_node.get_text(" ", strip=True)
    name = re.sub(r"^(?:(?:O|S)\s+)?(?:Coming|New)\s+(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+)?\d{1,2}\s+[A-Za-z]{3,9}\s+", "", raw_name, flags=re.I)
    name = re.sub(r"\s+(?:Malayalam|Tamil|Telugu|Hindi)\s*[·•]\s*(?:Series|Movie|Film)\b.*$", "", name, flags=re.I)
    name = re.sub(r"\s+(?:Malayalam|Tamil|Telugu|Hindi)\s+(?:Series|Movie|Film)\b.*$", "", name, flags=re.I)
    name = re.sub(r"\s+(?:App not announced|Not announced|Netflix|ZEE5|SonyLIV|JioHotstar|JioHotStar|YouTube|Prime Video)\b.*$", "", name, flags=re.I)
    name = re.sub(r"\s+(?:Malayalam|Tamil|Telugu|Hindi)$", "", name, flags=re.I)
    name = re.sub(r"\s+\d+(?:\.\d+)?\s*/\s*5.*$", "", name, flags=re.I).strip(" ·|–—-")
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
    href = title_node.get("href") or ""
    href_path = urlsplit(urljoin(source_url, href)).path.lower()
    if "/series/" in href_path or "/tv/" in href_path:
        typ = "series"
    elif "/movie/" in href_path:
        typ = "movie"
    else:
        typ = "series" if SERIES.search(kind_text) else "movie"
    platform_text = text
    platforms = [p for p in PLATFORMS if re.search(re.escape(p), platform_text, re.I)]
    platforms = list(dict.fromkeys(platforms))
    # Some editorial calendars confirm a date and platform category but do not
    # name the streamer. Keep those dated records; the IMDb gate still controls
    # whether they can ever enter the published upcoming index.
    if not platforms and not trusted_context:
        return []
    image = node.select_one("img[src]")
    poster = image.get("src") if image else None
    href = title_node.get("href")
    detail = urljoin(source_url, href) if href else None
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
    """Parse only OTTASIA's explicitly confirmed upcoming cards."""
    links = _links_between_headings(
        soup, "Upcoming OTT releases in India: confirmed dates", "Predicted next on OTT"
    )
    if not links:
        links = _links_between_headings(soup, "Upcoming OTT releases", "Predicted next on OTT")

    out = []
    seen = set()
    date_pattern = re.compile(
        r"\b(?:from|on)\s+(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+)?"
        r"([A-Za-z]{3,9}\s+\d{1,2},?\s+20\d{2}|[A-Za-z]{3,9}\s+\d{1,2})",
        re.I,
    )
    kind_pattern = re.compile(
        r"\b(Series|Film)\s*[·•]\s*(Malayalam|Tamil|Telugu|Hindi)\b", re.I
    )

    for anchor in links:
        title = anchor.get_text(" ", strip=True)
        if not title or len(title) > 140:
            continue
        node = anchor
        for _ in range(10):
            node = getattr(node, "parent", None)
            if node is None or not hasattr(node, "get_text"):
                break
            card_text = node.get_text(" ", strip=True)
            if len(card_text) > 1600 or title.casefold() not in card_text.casefold():
                continue
            kind_match = kind_pattern.search(card_text)
            date_match = date_pattern.search(card_text)
            if not kind_match or not date_match:
                continue
            if re.search(r"\b(predicted|prediction|rumou?red|expected)\b", card_text, re.I):
                continue
            day = _date_with_current_year(date_match.group(1), today)
            language = kind_match.group(2).lower()
            if not day or day < today or language not in langs:
                continue
            key = (language, norm(title))
            if key in seen:
                break
            seen.add(key)
            image = node.select_one("img[alt][src]")
            platforms = [p for p in PLATFORMS if re.search(re.escape(p), card_text, re.I)]
            href = anchor.get("href")
            detail = urljoin(source_url, href) if href else None
            detail_path = urlsplit(detail).path.lower() if detail else ""
            if "/title/movie/" in detail_path:
                title_type = "movie"
            elif "/title/tv/" in detail_path:
                title_type = "series"
            else:
                title_type = "series" if kind_match.group(1).lower() == "series" else "movie"
            out.append({
                "name": title,
                "language": language,
                "type": title_type,
                "ottDate": day,
                "platforms": list(dict.fromkeys(platforms)),
                "poster": image.get("src") if image else None,
                "year": None,
                "source": source_url,
                "sources": [source_url],
                "detail": detail,
                "confirmed": True,
                "releaseKind": "digital",
                "releaseDateBasis": "OTTASIA confirmed upcoming calendar",
                "sourceRecord": {"title": title, "releaseDate": day, "source": source_url},
            })
            break

    # Text fallback for a layout where the title/type/date are separate
    # siblings and no single card ancestor contains all three.
    # Also inspect the section's text sequence: some OTTASIA cards expose
    # title/type/date as siblings without a shared card wrapper.
    if soup is not None:
        visible = soup.get_text("\n", strip=True)
        lower = visible.lower()
        start = lower.find("upcoming ott releases")
        if start >= 0:
            stop = lower.find("predicted next on ott", start)
            section = visible[start:stop if stop >= 0 else len(visible)]
            lines = [line.strip() for line in section.splitlines() if line.strip()]
            for index, line in enumerate(lines):
                kind_match = re.match(
                    r"^(Series|Film)\s*[·•]\s*(Malayalam|Tamil|Telugu|Hindi)\b", line, re.I
                )
                if not kind_match:
                    continue
                title = lines[index - 1] if index else ""
                if title.lower().startswith("image:"):
                    title = title.split(":", 1)[-1].strip()
                if not title or len(title) > 140 or index + 1 >= len(lines):
                    continue
                date_match = date_pattern.search(lines[index + 1])
                if not date_match:
                    continue
                day = _date_with_current_year(date_match.group(1), today)
                language = kind_match.group(2).lower()
                if not day or day < today or language not in langs:
                    continue
                key = (language, norm(title))
                if key in seen:
                    continue
                seen.add(key)
                anchor = next(
                    (a for a in soup.select("a[href]") if a.get_text(" ", strip=True).casefold() == title.casefold()),
                    None,
                )
                platforms = [p for p in PLATFORMS if re.search(re.escape(p), lines[index + 1], re.I)]
                detail = urljoin(source_url, anchor.get("href")) if anchor and anchor.get("href") else None
                detail_path = urlsplit(detail).path.lower() if detail else ""
                if "/title/movie/" in detail_path:
                    title_type = "movie"
                elif "/title/tv/" in detail_path:
                    title_type = "series"
                else:
                    title_type = "series" if kind_match.group(1).lower() == "series" else "movie"
                out.append({
                    "name": title,
                    "language": language,
                    "type": title_type,
                    "ottDate": day,
                    "platforms": list(dict.fromkeys(platforms)),
                    "poster": None,
                    "year": None,
                    "source": source_url,
                    "sources": [source_url],
                    "detail": detail,
                    "confirmed": True,
                    "releaseKind": "digital",
                    "releaseDateBasis": "OTTASIA confirmed upcoming calendar",
                    "sourceRecord": {"title": title, "releaseDate": day, "source": source_url},
                })
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
        detail = urljoin(source_url, href) if href else None
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


def _myvi(soup, source_name, source_url, today, langs, norm):
    """Parse Vi's structured OTT release table.

    A week-long range is an availability window, not a premiere date; only
    a single explicit future date is eligible for the upcoming feed.
    """
    out = []
    seen = set()
    for table in soup.select("table"):
        rows = table.select("tr")
        if len(rows) < 2:
            continue
        header_cells = rows[0].find_all(["th", "td"], recursive=False)
        headers = [re.sub(r"[^a-z]", "", x.get_text(" ", strip=True).lower()) for x in header_cells]
        def col(*names):
            for name in names:
                if name in headers:
                    return headers.index(name)
            return None
        title_i = col("movieshowsports", "movieshow", "title", "content")
        platform_i = col("platform", "ottplatform")
        date_i = col("releasedate", "date")
        language_i = col("language", "languages", "audiolanguage")
        genre_i = col("genre", "category")
        if title_i is None or date_i is None or language_i is None:
            continue
        for row in rows[1:]:
            cells = row.find_all(["th", "td"], recursive=False)
            values = [x.get_text(" ", strip=True) for x in cells]
            if max(title_i, date_i, language_i) >= len(values):
                continue
            raw_title = values[title_i].strip()
            date_text = values[date_i].strip()
            genre = values[genre_i] if genre_i is not None and genre_i < len(values) else ""
            if not raw_title or re.search(r"\b(sports?|wwe|league|champions league)\b", raw_title, re.I) or re.search(r"\bsports?\b", genre, re.I):
                continue
            # A weekly availability span does not establish a new premiere.
            if re.search(r"\b[A-Za-z]{3,9}\s+\d{1,2}\s*[-–]\s*(?:[A-Za-z]{3,9}\s+)?\d{1,2}\b", date_text):
                continue
            day = _date_with_current_year(date_text, today)
            if not day or day <= today:
                continue
            languages = _languages(values[language_i], langs)
            if not languages:
                continue
            platform_text = values[platform_i] if platform_i is not None and platform_i < len(values) else ""
            platforms = [p for p in PLATFORMS if re.search(re.escape(p), platform_text, re.I)]
            if not platforms:
                continue
            kind_text = raw_title + " " + genre
            typ = "series" if SERIES.search(kind_text) or re.search(r"\b(show|reality tv|reality show)\b", genre, re.I) else "movie"
            link = row.select_one("a[href]")
            detail = urljoin(source_url, link.get("href")) if link else source_url
            for language in languages:
                key = (language, typ, norm(raw_title), day)
                if key in seen:
                    continue
                seen.add(key)
                out.append({
                    "name": raw_title, "language": language, "type": typ,
                    "ottDate": day, "platforms": list(dict.fromkeys(platforms)),
                    "poster": None, "year": None, "source": source_url,
                    "sources": [source_url], "detail": detail, "confirmed": True,
                    "releaseKind": "digital", "releaseDateBasis": "Vi dated OTT release calendar",
                    "sourceRecord": {"title": raw_title, "releaseDate": day, "source": source_url,
                                     "languageText": values[language_i], "dateText": date_text}
                })
    return out


def _simply_mollywood(soup, source_name, source_url, today, langs, norm):
    """Read dated title entries from Simply Mollywood's OTT release calendar."""
    out = []
    seen = set()
    date_re = re.compile(r"\b(?:\d{1,2}\s+[A-Za-z]{3,9},?\s+20\d{2}|[A-Za-z]{3,9}\s+\d{1,2},?\s+20\d{2})\b", re.I)
    for anchor in soup.select("a[href]"):
        raw = anchor.get_text(" ", strip=True)
        if not raw or len(raw) > 500:
            continue
        date_match = date_re.search(raw)
        if not date_match:
            continue
        day = _date_with_current_year(date_match.group(0), today)
        if not day or day <= today:
            continue
        languages = _languages(raw, langs)
        if not languages:
            continue
        before_date = raw[:date_match.start()].strip(" ·|–-")
        platforms = [p for p in PLATFORMS if re.search(re.escape(p), before_date, re.I)]
        if not platforms:
            continue
        title = before_date
        for platform in sorted(PLATFORMS, key=len, reverse=True):
            title = re.sub(re.escape(platform), " ", title, flags=re.I)
        title = re.sub(r"\b(?:web\s+series|series|season\s+\d+)\b", " ", title, flags=re.I)
        title = re.sub(r"\s+", " ", title).strip(" ·|–-")
        for language in LANG_NAMES:
            title = re.sub(r"\b" + re.escape(language) + r"\b", " ", title, flags=re.I)
        title = re.sub(r"\s+", " ", title).strip(" ·|–-")
        if not title or len(title) > 140:
            continue
        typ = "series" if SERIES.search(raw) else "movie"
        for language in languages:
            key = (language, typ, norm(title), day)
            if key in seen:
                continue
            seen.add(key)
            out.append({
                "name": title, "language": language, "type": typ,
                "ottDate": day, "platforms": list(dict.fromkeys(platforms)),
                "poster": None, "year": None, "source": source_url,
                "sources": [source_url], "detail": urljoin(source_url, anchor.get("href")),
                "confirmed": True, "releaseKind": "digital",
                "releaseDateBasis": "Simply Mollywood dated OTT release calendar",
                "sourceRecord": {"title": title, "releaseDate": day, "source": source_url,
                                 "calendarText": raw}
            })
    return out


def _keralatv(soup, source_name, source_url, today, langs, norm, get):
    """Discover dated OTT announcements from Kerala TV's cross-language feed.

    The feed includes article headlines and excerpts. We require an explicit
    streaming/premiere phrase, a date, a primary language and a named platform;
    the article's publication date alone is never treated as the OTT date.
    """
    out = []
    seen = set()
    cutoff = (date.fromisoformat(today) - timedelta(days=35)).isoformat()
    # The category is paginated. Inspect up to four pages so a 35-day
    # release audit is not limited to the newest ten editorial posts.
    page_soups = [soup]
    page_links = {}
    for link in soup.select("a[href]"):
        absolute = urljoin(source_url, link.get("href", ""))
        match = re.search(r"/page/(\d+)/?$", urlsplit(absolute).path)
        if match and 2 <= int(match.group(1)) <= 4:
            page_links[int(match.group(1))] = absolute
    for page_number in sorted(page_links):
        page_html = get(page_links[page_number], False)
        page_soups.append(BeautifulSoup(page_html, "html.parser"))
    anchors = []
    for page_soup in page_soups:
        page_anchors = page_soup.select("h2 a[href], h3 a[href], article h2 a[href], article h3 a[href]")
        if not page_anchors:
            page_anchors = [a for a in page_soup.select("a[href]") if re.search(r"OTT Release|OTT Date", a.get_text(" ", strip=True), re.I)]
        anchors.extend(page_anchors)
    for anchor in anchors:
        headline = anchor.get_text(" ", strip=True)
        href = anchor.get("href")
        if not headline or not href or len(headline) > 300:
            continue
        detail = urljoin(source_url, href)
        # The listing excerpt often contains all required facts; fetch the
        # detail page only when the excerpt is incomplete.
        node = anchor
        card_text = ""
        for _ in range(6):
            node = getattr(node, "parent", None)
            if node is None or not hasattr(node, "get_text"):
                break
            candidate = node.get_text(" ", strip=True)
            if len(candidate) >= len(headline) and len(candidate) <= 1800:
                card_text = candidate
                if re.search(
                    r"(?:started\s+streaming\s+(?:on|from)|stream(?:ing)?\s+(?:from|on)|premier(?:e|es|ed)\s+(?:on|from)|available\s+(?:on|from)|(?:OTT|digital)\s+release\s+date\s*[:=-])"
                    r"[^.]{0,150}?(?:\d{1,2}\s+[A-Za-z]{3,9},?\s+20\d{2}|"
                    r"[A-Za-z]{3,9}\s+\d{1,2},?\s+20\d{2}|20\d{2}-\d{2}-\d{2})",
                    candidate, re.I,
                ):
                    break
        text = card_text or headline
        release_phrase = re.search(
            r"(?:started\s+streaming\s+(?:on|from)|stream(?:ing)?\s+(?:from|on)|premier(?:e|es|ed)\s+(?:on|from)|available\s+(?:on|from)|(?:OTT|digital)\s+release\s+date\s*[:=-])"
            r"[^.]{0,150}?(\d{1,2}\s+[A-Za-z]{3,9},?\s+20\d{2}|"
            r"[A-Za-z]{3,9}\s+\d{1,2},?\s+20\d{2}|20\d{2}-\d{2}-\d{2})",
            text, re.I,
        )
        if not release_phrase:
            try:
                detail_html = get(detail, False)
                detail_soup = BeautifulSoup(detail_html, "html.parser")
                text = detail_soup.get_text(" ", strip=True)
                h1 = detail_soup.select_one("h1")
                if h1:
                    headline = h1.get_text(" ", strip=True)
                release_phrase = re.search(
                    r"(?:started\s+streaming\s+(?:on|from)|stream(?:ing)?\s+(?:from|on)|premier(?:e|es|ed)\s+(?:on|from)|available\s+(?:on|from)|(?:OTT|digital)\s+release\s+date\s*[:=-])"
                    r"[^.]{0,150}?(\d{1,2}\s+[A-Za-z]{3,9},?\s+20\d{2}|"
                    r"[A-Za-z]{3,9}\s+\d{1,2},?\s+20\d{2}|20\d{2}-\d{2}-\d{2})",
                    text, re.I,
                )
            except Exception:
                continue
        if not release_phrase:
            continue
        if re.search(r"(?:streaming|release)\s+date\s+(?:awaiting|awaited|not\s+announced|to\s+be\s+announced|tba)", headline + " " + text, re.I):
            continue
        day = _date_with_current_year(release_phrase.group(1), today)
        if not day or day < cutoff:
            continue
        # Accept only a primary-language cue. A list of dubbed/audio
        # languages is not evidence of the title's original language.
        lang_match = re.search(
            r"original(?:ly)?\s+language\s*[:=-]?\s*(Malayalam|Tamil|Telugu|Hindi)\b",
            text, re.I,
        )
        if not lang_match:
            lang_match = re.search(
                r"\b(Malayalam|Tamil|Telugu|Hindi)\s+(?:original|movie|film|series|web\s+series|"
                r"family\s+drama|romantic\s+drama|thriller|action\s+thriller|drama)\b",
                headline, re.I,
            )
        if not lang_match:
            lang_match = re.search(
                r"\b(Malayalam|Tamil|Telugu|Hindi)\s+(?:original|movie|film|series|web\s+series)\b",
                text[:350], re.I,
            )
        if not lang_match:
            continue
        language = lang_match.group(1).lower()
        if language not in langs:
            continue
        platforms = [p for p in sorted(PLATFORMS, key=len, reverse=True) if re.search(re.escape(p), text, re.I)]
        platforms = [p for p in platforms if not any(p.lower() != q.lower() and p.lower() in q.lower() for q in platforms)]
        if not platforms:
            continue
        if re.fullmatch(r"(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2}", headline, re.I):
            continue
        title = re.split(r"\s+(?:Trailer\s+Released|Now\s+Streaming|OTT\s+Release|Movie\s+OTT|Series\s+OTT|OTT\s+Date|Streaming\s+Updates|Streaming\s+From|Streaming\s+Soon)", headline, maxsplit=1, flags=re.I)[0].strip(" –—:-")
        title = re.sub(r"\s+(?:Malayalam|Tamil|Telugu|Hindi)\s+(?:Movie|Film|Series|Web\s+Series)$", "", title, flags=re.I).strip()
        title = re.sub(r"\s+(?:Malayalam|Tamil|Telugu|Hindi)$", "", title, flags=re.I).strip()
        if not title or len(title) > 140:
            continue
        if re.search(r"\b(?:movie|film)\b", headline, re.I):
            typ = "movie"
        elif re.search(r"\b(?:series|web\s+series|season\s+\d+)\b", headline, re.I):
            typ = "series"
        elif "/series/" in urlsplit(detail).path.lower() or "/tv/" in urlsplit(detail).path.lower():
            typ = "series"
        elif "/movie/" in urlsplit(detail).path.lower():
            typ = "movie"
        else:
            continue
        key = (language, typ, norm(title))
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "name": title, "language": language, "type": typ, "ottDate": day,
            "platforms": list(dict.fromkeys(platforms)), "poster": None, "year": None,
            "source": source_url, "sources": [source_url], "detail": detail,
            "confirmed": True, "releaseKind": "digital",
            "releaseDateBasis": "Kerala TV dated OTT announcement",
            "sourceRecord": {"title": title, "releaseDate": day, "source": source_url,
                             "headline": headline},
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



def _ottclock(soup, source_name, source_url, today, langs, norm):
    """Parse OTTClock's compact, linked release rows (e.g. 'Movie 20 Nov Netflix …')."""
    out = []
    seen = set()
    platforms = sorted(PLATFORMS + ("Apple TV+", "Saina Play"), key=len, reverse=True)
    for anchor in soup.select("a[href]"):
        raw = anchor.get_text(" ", strip=True)
        match = re.match(r"^(?:New|Movie|Series)\s+(?P<date>\d{1,2}\s+[A-Za-z]{3,9}|TBA)\s+(?P<rest>.+)$", raw, re.I)
        if not match or match.group("date").upper() == "TBA":
            continue
        day = _date_with_current_year(match.group("date"), today)
        if not day or day < today:
            continue
        rest = match.group("rest").strip()
        kind = re.search(r"\b(?P<kind>Movie|Series)\s*[·•]\s*(?P<language>[^·•]+)$", rest, re.I)
        if not kind:
            continue
        language_hits = _languages(kind.group("language"), langs)
        if len(language_hits) != 1:
            continue
        prefix = rest[:kind.start()].strip()
        platform = next((p for p in platforms if prefix.lower().startswith(p.lower())), None)
        if not platform:
            continue
        title = prefix[len(platform):].strip(" ·|–—-")
        if not title or len(title) > 140:
            continue
        typ = "series" if kind.group("kind").lower() == "series" else "movie"
        key = (language_hits[0], typ, norm(title))
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "name": title, "language": language_hits[0], "type": typ,
            "ottDate": day, "platforms": [platform], "poster": None,
            "year": None, "source": source_url, "sources": [source_url],
            "detail": urljoin(source_url, anchor.get("href", "")),
            "confirmed": True, "releaseKind": "digital",
            "releaseDateBasis": "OTTClock confirmed upcoming release",
            "sourceRecord": {"title": title, "releaseDate": day, "source": source_url},
        })
    return out

def _calendar_cards(soup, source_name, source_url, today, langs, norm):
    """Parse dated OTT calendar cards without requiring a particular CSS class.

    Each candidate still needs a title link, explicit date and unambiguous
    tracked language. Predicted/TBA entries are excluded by _record.
    """
    selectors = (
        "article", "li", "tr", "[data-release-date]", ".release-card",
        ".ott-card", ".movie-card", ".show-card", "[class*=release]",
        "[class*=movie]", "[class*=show]",
    )
    out = []
    seen = set()
    for selector in selectors:
        for node in soup.select(selector):
            text = node.get_text(" ", strip=True)
            if not text or len(text) > 1800:
                continue
            marker = (node.name, node.get("id"), tuple(node.get("class") or []), text[:220])
            if marker in seen:
                continue
            seen.add(marker)
            parsed = _record(node, source_name, source_url, today, langs, norm, trusted_context=True)
            for row in parsed:
                row["confirmed"] = False
                row["releaseDateBasis"] = source_name + " reported OTT calendar date"
            out.extend(parsed)
    merged = {}
    for row in out:
        key = (row["language"], row["type"], norm(row["name"]))
        if key not in merged or len(row["name"]) < len(merged[key]["name"]):
            merged[key] = row
    return list(merged.values())

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

def _ottchecker_recent(soup, source_url, today, langs):
    """Parse explicit streaming dates from OTTChecker's four language pages."""
    language = source_url.rstrip("/").rsplit("/", 1)[-1].lower()
    if language not in langs:
        raise ValueError("OTTChecker language route is not tracked")
    out = []
    cutoff = (date.fromisoformat(today) - timedelta(days=35)).isoformat()
    for node in soup.select("li"):
        text = node.get_text(" ", strip=True)
        streaming = re.search(
            r"\bStreaming\s+since\s+((?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+)?\d{1,2}\s+[A-Za-z]{3,9}(?:\s+20\d{2})?)",
            text, re.I,
        )
        if not streaming:
            continue
        title_node = node.select_one("a[href]")
        kind_matches = list(re.finditer(r"\b(Movie|Series)\b", text, re.I))
        if not title_node or not kind_matches:
            continue
        kind = kind_matches[-1]
        day = _date_with_current_year(streaming.group(1), today)
        if not day or day > today or day < cutoff:
            continue
        anchor_text = title_node.get_text(" ", strip=True)
        if not anchor_text or len(anchor_text) > 500:
            continue
        # Some OTTChecker cards wrap the entire row in the title link; others
        # link only the title. Use the last type token so words like "Series"
        # inside a movie/show title are not mistaken for the row's content type.
        anchor_kinds = list(re.finditer(r"\b(Movie|Series)\b", anchor_text, re.I))
        if anchor_kinds:
            anchor_kind = anchor_kinds[-1]
            prefix = anchor_text[:anchor_kind.start()].strip()
            year_match = re.search(r"\((20\d{2})\)\s*$", prefix)
            year = year_match.group(1) if year_match else None
            name = prefix[:year_match.start()].strip() if year_match else prefix
            row_kind = anchor_kind.group(1).lower()
        else:
            name = anchor_text
            year_match = re.search(r"\((20\d{2})\)", name) or re.search(r"\((20\d{2})\)", text)
            year = year_match.group(1) if year_match else None
            name = re.sub(r"\s*\(20\d{2}\)\s*$", "", name).strip()
            row_kind = kind.group(1).lower()
        # A future-dated film cannot already be a confirmed recent stream.
        if year and int(year) > int(today[:4]):
            continue
        if not name or len(name) > 140:
            continue
        platform_text = text[kind.end():streaming.start()]
        platform_text = re.sub(r"·?\s*IMDb\s*[0-9]+(?:\.[0-9]+)?", " ", platform_text, flags=re.I)
        matches = [p for p in sorted(PLATFORMS, key=len, reverse=True)
                   if re.search(re.escape(p), platform_text, re.I)]
        platforms = [p for p in matches if not any(
            p.lower() != other.lower() and p.lower() in other.lower()
            for other in matches
        )]
        deduplicated_platforms = []
        for platform in platforms:
            lower = platform.lower()
            if any(lower == existing.lower() or lower in existing.lower()
                   for existing in deduplicated_platforms):
                continue
            deduplicated_platforms.append(platform)
        platforms = deduplicated_platforms
        if not platforms:
            continue
        image = node.select_one("img[src]")
        href = title_node.get("href")
        out.append({
            "name": name, "language": language,
            "type": "series" if row_kind == "series" else "movie",
            "ottDate": day, "platforms": platforms,
            "poster": image.get("src") if image else None, "year": year,
            "source": source_url, "sources": [source_url],
            "detail": urljoin(source_url, href) if href else None,
            "confirmed": True, "releaseKind": "digital",
            "releaseDateBasis": "OTTChecker explicit streaming-since date",
            "sourceRecord": {
                "title": name, "releaseDate": day, "language": language,
                "platforms": platforms, "source": source_url,
            },
        })
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
            elif "myvi.in" in url:
                rows = _myvi(soup, name, url, today, langs, norm)
            elif "simplymollywood.com" in url:
                rows = _simply_mollywood(soup, name, url, today, langs, norm)
            elif "newindianmovies.com" in url:
                rows = _new_indian_movies(soup, name, url, today, langs, norm)
            elif "ottclock.com" in url:
                rows = _ottclock(soup, name, url, today, langs, norm)
            elif "ottchecker.com" in url:
                rows = _ottchecker_recent(soup, url, today, langs)
            elif "keralatv.in" in url:
                rows = _keralatv(soup, name, url, today, langs, norm, get)
            elif "indianmoviereviews.com" in url:
                rows = _calendar_cards(soup, name, url, today, langs, norm)
            else:
                rows = _generic(soup, name, url, today, langs, norm)
            # An intact calendar section with no eligible future Indian titles
            # is informational, not a parser failure. Missing section headings
            # still signal markup drift and trigger a half-hour retry.
            if not rows and "keralatv.in" in url:
                visible = soup.get_text(" ", strip=True).lower()
                article_links = soup.select("h2 a[href], h3 a[href], article h2 a[href], article h3 a[href]")
                date_pattern = r"(?:stream(?:ing)?|premier(?:e|es|ed)|release\s+date|released)[^.]{0,150}?((?:\d{1,2}\s+[A-Za-z]{3,9},?\s+20\d{2})|(?:[A-Za-z]{3,9}\s+\d{1,2},?\s+20\d{2})|20\d{2}-\d{2}-\d{2})"
                cutoff = (date.fromisoformat(today) - timedelta(days=35)).isoformat()
                recent_dated_evidence = any(
                    (parsed := _date_with_current_year(match.group(1), today)) and parsed >= cutoff
                    for match in re.finditer(date_pattern, visible, re.I)
                )
                if article_links and recent_dated_evidence:
                    raise ValueError("Kerala TV has recent dated OTT article cards but no records were extracted; parser drift suspected")
                if "ott releases" in visible:
                    health.append({"source": name, "url": url, "state": "no_confirmed_recent_releases", "records": 0,
                                   "note": "Feed loaded; no parseable recent confirmed releases were present in the rolling 35-day window."})
                    continue
                raise ValueError("Kerala TV OTT feed did not expose its expected release listing")
            if not rows and "ottchecker.com" in url:
                visible = soup.get_text(" ", strip=True).lower()
                if "streaming since" in visible and re.search(r"\b(Movie|Series)\b", visible, re.I):
                    raise ValueError("OTTChecker streaming rows exist but parser extracted none; markup may have changed")
                health.append({"source": name, "url": url, "state": "no_recent_releases", "records": 0,
                               "note": "Page loaded; no dated releases in the rolling 35-day window."})
                continue
            if not rows:
                visible = soup.get_text(' ', strip=True).lower()
                if "myvi.in" in url:
                    section_present = "what's new on ott platforms" in visible or "ott releases this month" in visible or "ott releases this week" in visible
                elif "simplymollywood.com" in url:
                    section_present = "release calendar" in visible and "ott releases" in visible
                elif "ottasia.com" in url:
                    raw_lines = soup.get_text('\n', strip=True)
                    section_start = re.search(r'upcoming\s+ott\s+releases', raw_lines, re.I)
                    section_text = raw_lines[section_start.start():] if section_start else raw_lines
                    section_text = re.split(r'predicted next on ott', section_text, maxsplit=1, flags=re.I)[0]
                    kind_lines = [x.strip() for x in section_text.splitlines() if re.search(r'(?:Series|Film)\s*[·|•]\s*(?:Malayalam|Tamil|Telugu|Hindi)', x, re.I)]
                    date_lines = [x.strip() for x in section_text.splitlines() if re.search(r'\b(?:from|on)\s+.{0,45}\b(?:19|20)\d{2}\b', x, re.I)]
                    headings = [raw_lines[m.start():m.start()+100].replace('\\n',' | ') for m in re.finditer(r'upcoming\s+ott\s+releases', raw_lines, re.I)]
                    has_tracked_kind = bool(kind_lines)
                    has_dated_row = bool(date_lines)
                    if has_tracked_kind and has_dated_row:
                        raise ValueError('OTTASIA confirmed section parser extracted no rows; headings=' + repr(headings[:4]) + '; kinds=' + repr(kind_lines[:8]) + '; dates=' + repr(date_lines[:8]))
                    section_present = bool(section_start)
                elif "newindianmovies.com" in url:
                    section_present = 'new on ott this week' in visible
                elif "indianmoviereviews.com" in url:
                    section_present = 'ott release calendar' in visible or ('this week' in visible and 'coming next' in visible)
                elif "ottclock.com" in url:
                    section_present = 'upcoming ott releases' in visible
                else:
                    section_present = 'upcoming' in visible and 'ott' in visible and ('release' in visible or 'this week' in visible)
                if section_present:
                    health.append({'source': name, 'url': url, 'state': 'no_confirmed_upcoming', 'records': 0, 'note': 'Calendar section is present; no eligible future releases for the four tracked languages were found.'})
                    continue
                raise ValueError("Expected upcoming calendar section not found or parser returned no confirmed rows")
            events.extend(rows)
            health.append({"source": name, "url": url, "state": "live", "records": len(rows)})
        except Exception as error:
            health.append({"source": name, "url": url, "state": "failed", "records": 0, "error": str(error)[:1000]})
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
    # Publish source coverage for every language. A general feed is an
    # independent check for all four languages; language-specific feeds only
    # count for their own language. Failed sources remain visible per language.
    healthy_states = {"live", "no_confirmed_upcoming", "no_confirmed_recent_releases",
                      "no_recent_releases", "covered_by_primary_collector", "frontend-fallback"}
    source_coverage = {}
    for language in langs:
        checked = []
        for item in health:
            url = str(item.get("url") or "")
            source_name = str(item.get("source") or "")
            scoped = re.search(r"/(malayalam|tamil|telugu|hindi)(?:/|$)", url, re.I)
            named_scope = next((x for x in LANG_NAMES if x in source_name.lower()), None)
            scope = (scoped.group(1).lower() if scoped else named_scope)
            if scope and scope != language:
                continue
            records = sum(1 for event in events if event.get("language") == language and
                          (url in (event.get("sources") or [event.get("source")]) or
                           (source_name == "TVmaze upcoming web schedule" and event.get("source") == url)))
            state = item.get("state", "unknown")
            checked.append({"source": source_name, "url": url, "state": state,
                            "languageState": "failed" if state == "failed" else "records_found" if records else "checked_no_records",
                            "records": records})
        # Count independent publishers, not URLs: three Vi pages or four
        # OTTChecker language pages are one publisher each, not three/four
        # independent confirmations.
        domain_states = {}
        for item in checked:
            host = urlsplit(item["url"]).netloc.lower().removeprefix("www.")
            if not host:
                continue
            domain_states.setdefault(host, set()).add(item["state"])
        healthy_domains = sorted(host for host, states in domain_states.items()
                                if states.intersection(healthy_states))
        failed_domains = sorted(host for host, states in domain_states.items()
                               if "failed" in states and not states.intersection(healthy_states))
        healthy = len(healthy_domains)
        failed = len(failed_domains)
        record_domains = sorted({
            urlsplit(item["url"]).netloc.lower().removeprefix("www.")
            for item in checked
            if item["records"] and item["state"] in healthy_states and urlsplit(item["url"]).netloc
        })
        record_sources = len(record_domains)
        source_coverage[language] = {
            "checkedFeeds": len(checked), "checkedSources": len(domain_states),
            "healthySources": healthy, "failedSources": failed,
            "healthySourceDomains": healthy_domains, "failedSourceDomains": failed_domains,
            "sourcesWithRecords": record_sources, "sourceDomainsWithRecords": record_domains,
            "detectedRecords": sum(x["records"] for x in checked),
            "coverageStatus": "ok" if healthy >= 2 and record_sources >= 2 and failed == 0 else "partial" if healthy >= 2 else "degraded",
            "sources": checked,
        }
    health.append({"source": "Per-language source coverage", "url": "internal://source-coverage",
                   "state": "live" if all(x["coverageStatus"] == "ok" for x in source_coverage.values()) else "partial",
                   "records": sum(x["detectedRecords"] for x in source_coverage.values()),
                   "languageCoverage": source_coverage})
    return list(merged.values()), health
