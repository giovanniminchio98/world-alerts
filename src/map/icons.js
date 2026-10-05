// Hazard icons and area textures drawn on a canvas (no sprite or font needed).
// Icons: a disc in the hazard colour with a white pictogram. Textures: small
// repeating tiles used as fill patterns over affected areas.

import { HAZARDS, hazardOf } from './hazards.js';

const SIZE = 44;
const RATIO = 2;

function canvas(w = SIZE, h = SIZE) {
  const c = document.createElement('canvas');
  c.width = w * RATIO;
  c.height = h * RATIO;
  const ctx = c.getContext('2d');
  ctx.scale(RATIO, RATIO);
  return { c, ctx };
}

const GLYPHS = {
  earthquake(ctx) {
    ctx.beginPath();
    ctx.moveTo(9, 22);
    ctx.lineTo(15, 22);
    ctx.lineTo(18, 13);
    ctx.lineTo(22, 31);
    ctx.lineTo(26, 16);
    ctx.lineTo(29, 22);
    ctx.lineTo(35, 22);
    ctx.stroke();
  },
  storm(ctx) {
    ctx.beginPath();
    ctx.arc(22, 22, 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(22, 22, 10, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(22, 22, 10, Math.PI * 0.1, Math.PI * 0.9);
    ctx.stroke();
  },
  flood(ctx) {
    for (const y of [16, 22, 28]) {
      ctx.beginPath();
      ctx.moveTo(10, y);
      ctx.bezierCurveTo(14, y - 4, 18, y + 4, 22, y);
      ctx.bezierCurveTo(26, y - 4, 30, y + 4, 34, y);
      ctx.stroke();
    }
  },
  volcano(ctx) {
    ctx.beginPath();
    ctx.moveTo(10, 32);
    ctx.lineTo(19, 17);
    ctx.lineTo(25, 17);
    ctx.lineTo(34, 32);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(22, 14);
    ctx.lineTo(22, 9);
    ctx.moveTo(18, 13);
    ctx.lineTo(16, 9);
    ctx.moveTo(26, 13);
    ctx.lineTo(28, 9);
    ctx.stroke();
  },
  drought(ctx) {
    ctx.beginPath();
    ctx.arc(22, 22, 5.5, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(22 + Math.cos(a) * 9, 22 + Math.sin(a) * 9);
      ctx.lineTo(22 + Math.cos(a) * 12.5, 22 + Math.sin(a) * 12.5);
      ctx.stroke();
    }
  },
  wildfire(ctx) {
    ctx.beginPath();
    ctx.moveTo(22, 9);
    ctx.bezierCurveTo(30, 18, 31, 24, 28, 29);
    ctx.bezierCurveTo(25, 34, 19, 34, 16, 29);
    ctx.bezierCurveTo(13, 24, 16, 19, 19, 16);
    ctx.bezierCurveTo(19, 21, 21, 23, 23, 23);
    ctx.bezierCurveTo(22, 18, 21, 13, 22, 9);
    ctx.stroke();
  },
  tsunami(ctx) {
    ctx.beginPath();
    ctx.moveTo(9, 31);
    ctx.bezierCurveTo(12, 20, 22, 11, 32, 15);
    ctx.bezierCurveTo(26, 16, 23, 22, 27, 26);
    ctx.lineTo(35, 31);
    ctx.stroke();
  },
  landslide(ctx) {
    ctx.beginPath();
    ctx.moveTo(9, 32);
    ctx.lineTo(35, 32);
    ctx.lineTo(35, 14);
    ctx.closePath();
    ctx.stroke();
    for (const [x, y] of [[16, 25], [21, 28], [13, 30]]) {
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  snow(ctx) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(22 + Math.cos(a) * 11, 22 + Math.sin(a) * 11);
      ctx.lineTo(22 - Math.cos(a) * 11, 22 - Math.sin(a) * 11);
      ctx.stroke();
    }
  },
  heat(ctx) {
    ctx.beginPath();
    ctx.moveTo(20, 27);
    ctx.lineTo(20, 12);
    ctx.arc(22, 12, 2, Math.PI, 0);
    ctx.lineTo(24, 27);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(22, 30, 4, 0, Math.PI * 2);
    ctx.fill();
  },
  dust(ctx) {
    for (const y of [16, 22, 28]) {
      ctx.beginPath();
      ctx.moveTo(11, y);
      ctx.bezierCurveTo(17, y - 3, 23, y + 3, 33, y);
      ctx.stroke();
    }
  },
  other(ctx) {
    ctx.beginPath();
    ctx.moveTo(22, 12);
    ctx.lineTo(22, 25);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(22, 31, 1.5, 0, Math.PI * 2);
    ctx.fill();
  },
};

export function drawIcon(code) {
  const hazard = hazardOf(code);
  const { ctx } = canvas();
  ctx.fillStyle = HAZARDS[hazard].color;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.fillStyle = '#ffffff';
  (GLYPHS[hazard] || GLYPHS.other)(ctx);
  return ctx.getImageData(0, 0, SIZE * RATIO, SIZE * RATIO);
}

// --- Area textures -------------------------------------------------------------

const TILE = 24;

const PATTERNS = {
  // "Pixels": a grid of small squares (floods, tsunamis).
  pixels(ctx, color) {
    ctx.fillStyle = color;
    for (let y = 0; y < TILE; y += 6) for (let x = (y / 6) % 2 ? 3 : 0; x < TILE; x += 6) ctx.fillRect(x + 1, y + 1, 3, 3);
  },
  // Curved wind streaks (storms, cyclones, tornadoes).
  wind(ctx, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    for (const [y, x0] of [[6, 1], [18, 9]]) {
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.bezierCurveTo(x0 + 5, y - 3, x0 + 9, y + 3, x0 + 14, y);
      ctx.stroke();
    }
  },
  // Small flame strokes (wildfires).
  flames(ctx, color) {
    ctx.fillStyle = color;
    for (const [x, y] of [[5, 8], [17, 20], [17, 6], [5, 20]]) {
      ctx.beginPath();
      ctx.moveTo(x, y - 4);
      ctx.quadraticCurveTo(x + 3.5, y, x, y + 3);
      ctx.quadraticCurveTo(x - 3.5, y, x, y - 4);
      ctx.fill();
    }
  },
  // Dense glowing dots (volcanoes).
  embers(ctx, color) {
    ctx.fillStyle = color;
    for (const [x, y, r] of [[4, 4, 2.2], [14, 9, 1.6], [8, 16, 2], [19, 19, 2.2], [20, 3, 1.4]]) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  // Dry-ground cracks (drought).
  cracks(ctx, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(0, 8);
    ctx.lineTo(7, 10);
    ctx.lineTo(10, 4);
    ctx.moveTo(7, 10);
    ctx.lineTo(9, 18);
    ctx.lineTo(18, 16);
    ctx.lineTo(24, 20);
    ctx.moveTo(18, 16);
    ctx.lineTo(20, 9);
    ctx.stroke();
  },
  // Zigzag lines (earthquakes, landslides).
  zigzag(ctx, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    for (const y of [7, 19]) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 3; x <= TILE; x += 3) ctx.lineTo(x, y + ((x / 3) % 2 ? -3 : 3));
      ctx.stroke();
    }
  },
  // Wavy vertical heat-shimmer lines (heat alerts), so they are not mistaken for fire dots.
  haze(ctx, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    for (const x of [6, 18]) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 3, 4, x - 3, 8, x, 12);
      ctx.bezierCurveTo(x + 3, 16, x - 3, 20, x, 24);
      ctx.stroke();
    }
  },
  dots(ctx, color) {
    ctx.fillStyle = color;
    for (const [x, y] of [[6, 6], [18, 18]]) {
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

export function drawPattern(hazard) {
  const h = HAZARDS[hazard] || HAZARDS.other;
  const { ctx } = canvas(TILE, TILE);
  ctx.globalAlpha = 0.8;
  (PATTERNS[h.pattern] || PATTERNS.dots)(ctx, h.color);
  return ctx.getImageData(0, 0, TILE * RATIO, TILE * RATIO);
}

/** Data URL versions for legends and popups. */
export function iconDataUrl(code) {
  const { c, ctx } = canvas();
  ctx.putImageData(drawIcon(code), 0, 0);
  return c.toDataURL('image/png');
}

export function patternDataUrl(hazard) {
  const { c, ctx } = canvas(TILE, TILE);
  ctx.putImageData(drawPattern(hazard), 0, 0);
  return c.toDataURL('image/png');
}

/** White chevron used as an SDF icon along tracks, so it can take the hazard colour. */
export function drawArrow() {
  const { ctx } = canvas(24, 24);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(8, 5);
  ctx.lineTo(16, 12);
  ctx.lineTo(8, 19);
  ctx.stroke();
  return ctx.getImageData(0, 0, 24 * RATIO, 24 * RATIO);
}

export function registerIcons(map) {
  if (!map.hasImage('track-arrow')) map.addImage('track-arrow', drawArrow(), { pixelRatio: RATIO, sdf: true });
  for (const hazard of Object.keys(HAZARDS)) {
    if (!map.hasImage(`hz-${hazard}`)) map.addImage(`hz-${hazard}`, drawIcon(hazard), { pixelRatio: RATIO });
    if (!map.hasImage(`pat-${hazard}`)) map.addImage(`pat-${hazard}`, drawPattern(hazard), { pixelRatio: RATIO });
  }
}
