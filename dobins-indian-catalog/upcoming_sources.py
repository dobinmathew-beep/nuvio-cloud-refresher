"""Conservative discovery of confirmed upcoming Indian OTT releases.

Only announced/confirmed dates are emitted. Predictions, expected dates and
unverified theatrical-to-OTT estimates are deliberately excluded.
"""
from datetime import datetime
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
    languages = _languages(language_text, langs)
    if not languages:
        languages = _languages(text, langs)
    if not languages:
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
            if not old.get("poster") and event.get("poster"):
                old["poster"] = event["poster"]
    return list(merged.values()), health
