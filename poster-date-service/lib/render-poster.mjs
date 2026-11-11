export async function renderUpcomingBadge(input, isoDate) {
  const labelDate = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(isoDate + 'T00:00:00Z')).toUpperCase();
  const { default: sharp } = await import('sharp');
  const metadata = await sharp(input, { limitInputPixels: 40000000 }).metadata();
  if (!metadata.width || !metadata.height || metadata.width < 160 || metadata.height < 240) {
    throw new Error('Unsupported poster dimensions');
  }
  const width = metadata.width, height = metadata.height;
  const left = Math.round(width * 0.055);
  const top = Math.round(height * 0.185);
  const badgeWidth = Math.min(Math.round(width * 0.69), width - left * 2);
  const badgeHeight = Math.round(width * 0.105);
  const radius = Math.round(badgeHeight * 0.31);
  const fontSize = Math.round(width * 0.046);
  const blurRadius = Math.max(4, Math.round(width * 0.012));
  const safeLabel = 'UPCOMING  •  ' + labelDate;

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
      <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#7C6CFF" stop-opacity=".88"/>
        <stop offset="54%" stop-color="#467FEA" stop-opacity=".82"/>
        <stop offset="100%" stop-color="#20C6B5" stop-opacity=".78"/>
      </linearGradient>
      <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#FFFFFF" stop-opacity=".28"/>
        <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect x="1" y="1" width="${badgeWidth - 2}" height="${badgeHeight - 2}" rx="${radius}" fill="url(#glass)" stroke="#FFFFFF" stroke-opacity=".62" stroke-width="${Math.max(1, width * 0.002)}"/>
    <rect x="2" y="2" width="${badgeWidth - 4}" height="${Math.round(badgeHeight * .48)}" rx="${Math.max(2, radius - 1)}" fill="url(#shine)"/>
    <path d="M ${radius} 1 H ${badgeWidth - radius} Q ${badgeWidth - 1} 1 ${badgeWidth - 1} ${radius}" fill="none" stroke="#FFFFFF" stroke-opacity=".68" stroke-width="${Math.max(1, width * 0.002)}"/>
    <text x="${badgeWidth / 2}" y="${badgeHeight / 2 + fontSize * .34}" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="${fontSize}" font-weight="700" letter-spacing="${Math.max(.2, width * .0008)}" fill="#FFFFFF" stroke="#152044" stroke-opacity=".18" stroke-width="${Math.max(.4, width * .001)}" paint-order="stroke">${safeLabel}</text>
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