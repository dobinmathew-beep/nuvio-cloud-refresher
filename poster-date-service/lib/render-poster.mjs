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

  // Sample the poster beneath the badge so the glass tint continues to blend with its artwork.
  const crop = await sharp(input).extract({ left, top, width: badgeWidth, height: badgeHeight }).stats();
  const rgb = crop.channels.slice(0, 3).map(c => Math.max(0, Math.min(255, Math.round(c.mean))));
  const tint = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;

  // Keep the release label consistently pure white for strong contrast on every poster.
  // Use a conventional bold sans-serif face instead of hand-drawn outline glyphs.
  const fontSize = Math.round(badgeHeight * 0.40);
  const letterSpacing = Math.max(0.5, width * 0.0018);
  const textShadow = '#101820';



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
    <text x="${badgeWidth / 2}" y="${badgeHeight / 2}" text-anchor="middle" dominant-baseline="central"
      font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" font-size="${fontSize}"
      font-weight="700" letter-spacing="${letterSpacing}" fill="#FFFFFF"
      stroke="${textShadow}" stroke-opacity=".34" stroke-width="${Math.max(0.8, fontSize * 0.035)}"
      stroke-linejoin="round" paint-order="stroke fill">${label}</text>
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
