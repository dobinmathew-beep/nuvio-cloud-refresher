export async function renderUpcomingBadge(input, isoDate) {
  const labelDate = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(isoDate + 'T00:00:00Z')).toUpperCase();
  const { default: sharp } = await import('sharp');
  const metadata = await sharp(input, { limitInputPixels: 40000000 }).metadata();
  if (!metadata.width || !metadata.height || metadata.width < 160 || metadata.height < 240) {
    throw new Error('Unsupported poster dimensions');
  }

  const width = metadata.width, height = metadata.height;
  // Center the release label beneath the BetterPosters top label.
  const badgeWidth = Math.min(Math.round(width * 0.78), Math.round(width * 0.92));
  const badgeHeight = Math.max(42, Math.round(width * 0.125));
  const left = Math.round((width - badgeWidth) / 2);
  const top = Math.round(height * 0.105);
  const radius = Math.round(badgeHeight * 0.38);
  const fontSize = Math.max(18, Math.round(width * 0.058));
  const blurRadius = Math.max(5, Math.round(width * 0.014));
  const safeLabel = 'REL: ' + labelDate;

  const roundedMask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${badgeWidth}" height="${badgeHeight}"><rect width="${badgeWidth}" height="${badgeHeight}" rx="${radius}" fill="white"/></svg>`
  );
  const blurred = await sharp(input)
    .extract({ left, top, width: badgeWidth, height: badgeHeight })
    .blur(blurRadius)
    .composite([{ input: roundedMask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  const strokeWidth = Math.max(1.2, width * 0.0028);
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${badgeWidth}" height="${badgeHeight}">
    <defs>
      <linearGradient id="goldGlass" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#FFF2B8" stop-opacity=".58"/>
        <stop offset="48%" stop-color="#D6A83D" stop-opacity=".43"/>
        <stop offset="100%" stop-color="#8D641B" stop-opacity=".48"/>
      </linearGradient>
      <linearGradient id="glassShine" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#FFFFFF" stop-opacity=".48"/>
        <stop offset="58%" stop-color="#FFFFFF" stop-opacity=".10"/>
        <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect x="1" y="1" width="${badgeWidth - 2}" height="${badgeHeight - 2}" rx="${radius}" fill="#D9A83F" fill-opacity=".18"/>
    <rect x="1" y="1" width="${badgeWidth - 2}" height="${badgeHeight - 2}" rx="${radius}" fill="url(#goldGlass)" stroke="#FFE7A0" stroke-opacity=".92" stroke-width="${strokeWidth}"/>
    <rect x="2" y="2" width="${badgeWidth - 4}" height="${Math.round(badgeHeight * .52)}" rx="${Math.max(3, radius - 1)}" fill="url(#glassShine)"/>
    <path d="M ${radius} 1 H ${badgeWidth - radius} Q ${badgeWidth - 1} 1 ${badgeWidth - 1} ${radius}" fill="none" stroke="#FFFFFF" stroke-opacity=".76" stroke-width="${strokeWidth}"/>
    <text x="${badgeWidth / 2}" y="${badgeHeight / 2 + fontSize * .34}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="${fontSize}" font-weight="700" letter-spacing="${Math.max(.25, width * .001)}" fill="#FFF9E8" stroke="#4A310B" stroke-opacity=".72" stroke-width="${Math.max(.8, width * .002)}" paint-order="stroke">${safeLabel}</text>
  </svg>`);

  let image = sharp(input).composite([
    { input: blurred, left, top },
    { input: svg, left, top }
  ]);
  if (metadata.format === 'webp') image = image.webp({ quality: 92, effort: 4 });
  else if (metadata.format === 'png') image = image.png({ compressionLevel: 8 });
  else if (metadata.format === 'avif') image = image.avif({ quality: 88, effort: 4 });
  else image = image.jpeg({ quality: 93, mozjpeg: true });
  return image.toBuffer();
}
