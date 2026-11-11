export async function renderUpcomingBadge(input, isoDate, kind = 'premiere') {
  const date = new Date(isoDate + 'T00:00:00Z');
  const month = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' }).format(date);
  const day = String(date.getUTCDate());
  const label = (kind === 'episode' ? 'New Episode ' : 'Coming ') + day + ' ' + month;
  const { default: sharp } = await import('sharp');
  const metadata = await sharp(input, { limitInputPixels: 40000000 }).metadata();
  if (!metadata.width || !metadata.height || metadata.width < 160 || metadata.height < 240) {
    throw new Error('Unsupported poster dimensions');
  }

  const width = metadata.width, height = metadata.height;
  // Keep the previously approved anchor, but match the compact proportions of BetterPosters' own tag.
  const badgeWidth = Math.round(width * 0.78);
  const badgeHeight = Math.max(40, Math.round(width * 0.135));
  const left = Math.round((width - badgeWidth) / 2);
  const top = Math.round(height * 0.105);
  const radius = Math.round(badgeHeight * 0.18);
  const blurRadius = Math.max(4, Math.round(width * 0.012));

  const roundedMask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${badgeWidth}" height="${badgeHeight}"><rect width="${badgeWidth}" height="${badgeHeight}" rx="${radius}" fill="white"/></svg>`
  );
  const blurred = await sharp(input)
    .extract({ left, top, width: badgeWidth, height: badgeHeight })
    .blur(blurRadius)
    .composite([{ input: roundedMask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  const fontSize = Math.round(badgeHeight * 0.56);
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${badgeWidth}" height="${badgeHeight}">
    <defs>
      <linearGradient id="chip" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#555548" stop-opacity=".94"/>
        <stop offset="100%" stop-color="#3F4036" stop-opacity=".94"/>
      </linearGradient>
      <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#FFFFFF" stop-opacity=".12"/>
        <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect x=".75" y=".75" width="${badgeWidth - 1.5}" height="${badgeHeight - 1.5}" rx="${radius}" fill="url(#chip)" stroke="#FFFFFF" stroke-opacity=".18" stroke-width="1.5"/>
    <rect x="2" y="2" width="${badgeWidth - 4}" height="${Math.round(badgeHeight * .42)}" rx="${Math.max(4, radius - 1)}" fill="url(#sheen)"/>
    <text x="${badgeWidth / 2}" y="${badgeHeight / 2}" text-anchor="middle" dominant-baseline="central"
      font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}"
      font-weight="700" letter-spacing="0" fill="#FFFFFF">${label}</text>
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
