export async function renderUpcomingBadge(input, isoDate) {
  const date = new Date(isoDate + 'T00:00:00Z');
  const month = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' }).format(date).toUpperCase();
  const day = String(date.getUTCDate());
  const label = 'REL ' + month + ' ' + day;
  const { default: sharp } = await import('sharp');
  const metadata = await sharp(input, { limitInputPixels: 40000000 }).metadata();
  if (!metadata.width || !metadata.height || metadata.width < 160 || metadata.height < 240) {
    throw new Error('Unsupported poster dimensions');
  }

  const width = metadata.width, height = metadata.height;
  // Preserve the approved centerline and vertical anchor; enlarge the glass chip around them.
  const badgeWidth = Math.round(width * 0.88);
  const badgeHeight = Math.max(48, Math.round(width * 0.16));
  const left = Math.round((width - badgeWidth) / 2);
  const top = Math.round(height * 0.105);
  const radius = Math.round(badgeHeight * 0.34);
  const blurRadius = Math.max(6, Math.round(width * 0.022));

  const crop = await sharp(input).extract({ left, top, width: badgeWidth, height: badgeHeight }).stats();
  const channels = crop.channels;
  const rgb = channels.slice(0, 3).map(c => Math.max(0, Math.min(255, Math.round(c.mean))));
  const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const textColor = luminance > 148 ? '#111820' : '#FFFFFF';
  const textOutline = luminance > 148 ? '#FFFFFF' : '#101820';
  const tint = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;

  // Use vector-drawn glyphs rather than SVG text. This avoids server font discovery
  // entirely, so letters and digits cannot turn into missing-font square glyphs.
  // The bold, rounded geometric strokes are intentionally close to a compact sans badge face.
  const glyphs = {
    R: 'M1 13 V1 H7 Q10 1 10 4.5 Q10 8 7 8 H1 M6 8 L10 13',
    A: 'M1 13 L5.5 1 L10 13 M2.5 9 H8.5',
    P: 'M1 13 V1 H7 Q10 1 10 4.5 Q10 8 7 8 H1',
    M: 'M1 13 V1 L5.5 7 L10 1 V13',
    U: 'M1 1 V9 Q1 13 5.5 13 Q10 13 10 9 V1',
    G: 'M10 3 Q8 1 5.5 1 Q1 1 1 7 Q1 13 5.5 13 H10 V8 H6',
    S: 'M10 2 Q8 1 5 1 Q1 1 1 4 Q1 6 5.5 7 Q10 8 10 10 Q10 13 6 13 H1',
    N: 'M1 13 V1 L10 13 V1',
    O: 'M3.5 1 H7.5 Q10 1 10 4 V10 Q10 13 7.5 13 H3.5 Q1 13 1 10 V4 Q1 1 3.5 1 Z',
    V: 'M1 1 L5.5 13 L10 1',
    T: 'M1 1 H10 M5.5 1 V13',
    E: 'M10 1 H1 V13 H10 M1 7 H8',
    L: 'M1 1 V13 H10',
    D: 'M1 1 V13 H5.5 Q10 13 10 7 Q10 1 5.5 1 Z',
    C: 'M10 2 Q1 -1 1 7 Q1 15 10 12',
    '2': 'M1 4 Q1 1 4 1 H7 Q10 1 10 4 V6 L1 13 H10',
    '0': 'M3.5 1 H7.5 Q10 1 10 4 V10 Q10 13 7.5 13 H3.5 Q1 13 1 10 V4 Q1 1 3.5 1 Z',
    '1': 'M3 4 L6 1 V13 M3 13 H9',
    '3': 'M1 1 H7 Q10 1 10 4 V5 Q10 7 7 7 H4 M7 7 Q10 7 10 10 V10 Q10 13 7 13 H1',
    '4': 'M8 13 V1 L1 9 H10',
    '5': 'M10 1 H2 L1 7 H7 Q10 7 10 10 Q10 13 7 13 H1',
    '6': 'M9 1 H4 Q1 1 1 5 V10 Q1 13 4 13 H7 Q10 13 10 10 Q10 7 7 7 H1',
    '7': 'M1 1 H10 L4 13'
  };
  const advance = 11.8;
  const totalUnits = label.length * advance - 1.5;
  const scale = Math.min((badgeHeight * 0.68) / 14, (badgeWidth * 0.90) / totalUnits);
  const textWidth = totalUnits * scale;
  const textHeight = 14 * scale;
  const startX = (badgeWidth - textWidth) / 2;
  const startY = (badgeHeight - textHeight) / 2;
  const strokeWidth = 2.15 * scale;
  let glyphPaths = '';
  for (let i = 0; i < label.length; i++) {
    const ch = label[i];
    if (ch === ' ') continue;
    const path = glyphs[ch];
    if (!path) throw new Error('Unsupported release badge character: ' + ch);
    glyphPaths += `<path d="${path}" transform="translate(${startX + i * advance * scale} ${startY}) scale(${scale})"/>`;
  }

  const roundedMask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${badgeWidth}" height="${badgeHeight}"><rect width="${badgeWidth}" height="${badgeHeight}" rx="${radius}" fill="white"/></svg>`
  );
  const blurred = await sharp(input)
    .extract({ left, top, width: badgeWidth, height: badgeHeight })
    .blur(blurRadius)
    .composite([{ input: roundedMask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${badgeWidth}" height="${badgeHeight}">
    <defs>
      <linearGradient id="glass" x1="0" y1="0" x2="0.9" y2="1">
        <stop offset="0%" stop-color="#FFFFFF" stop-opacity=".24"/>
        <stop offset="48%" stop-color="${tint}" stop-opacity=".34"/>
        <stop offset="100%" stop-color="${tint}" stop-opacity=".52"/>
      </linearGradient>
      <linearGradient id="reflection" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#FFFFFF" stop-opacity=".36"/>
        <stop offset="52%" stop-color="#FFFFFF" stop-opacity=".10"/>
        <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect x="1" y="1" width="${badgeWidth - 2}" height="${badgeHeight - 2}" rx="${radius}" fill="${tint}" fill-opacity=".22" stroke="#FFFFFF" stroke-opacity=".58" stroke-width="${Math.max(1.5, width * .0032)}"/>
    <rect x="2" y="2" width="${badgeWidth - 4}" height="${badgeHeight - 4}" rx="${radius - 1}" fill="url(#glass)"/>
    <rect x="3" y="3" width="${badgeWidth - 6}" height="${Math.round(badgeHeight * .54)}" rx="${Math.max(4, radius - 2)}" fill="url(#reflection)"/>
    <path d="M ${radius} 1 H ${badgeWidth - radius} Q ${badgeWidth - 1} 1 ${badgeWidth - 1} ${radius}" fill="none" stroke="#FFFFFF" stroke-opacity=".76" stroke-width="${Math.max(1.2, width * .0028)}"/>
    <g fill="none" stroke="${textColor}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" opacity=".98">${glyphPaths}</g>
    <g fill="none" stroke="${textOutline}" stroke-width="${Math.max(.65, strokeWidth * .18)}" stroke-linecap="round" stroke-linejoin="round" opacity=".20">${glyphPaths}</g>
  </svg>`);

  let image = sharp(input).composite([
    { input: blurred, left, top },
    { input: svg, left, top }
  ]);
  if (metadata.format === 'webp') image = image.webp({ quality: 94, effort: 4 });
  else if (metadata.format === 'png') image = image.png({ compressionLevel: 8 });
  else if (metadata.format === 'avif') image = image.avif({ quality: 90, effort: 4 });
  else image = image.jpeg({ quality: 94, mozjpeg: true });
  return image.toBuffer();
}
