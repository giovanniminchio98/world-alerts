// GDACS hazard icons drawn on a canvas (no external sprite or font needed).
// Each icon is a dark disc with a white pictogram; the alert level is shown by
// a separate halo layer and in text, never by colour alone.

const SIZE = 44;
const RATIO = 2;

function canvas() {
  const c = document.createElement('canvas');
  c.width = SIZE * RATIO;
  c.height = SIZE * RATIO;
  const ctx = c.getContext('2d');
  ctx.scale(RATIO, RATIO);
  return { c, ctx };
}

const GLYPHS = {
  EQ(ctx) {
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
  TC(ctx) {
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
  FL(ctx) {
    for (const y of [16, 22, 28]) {
      ctx.beginPath();
      ctx.moveTo(10, y);
      ctx.bezierCurveTo(14, y - 4, 18, y + 4, 22, y);
      ctx.bezierCurveTo(26, y - 4, 30, y + 4, 34, y);
      ctx.stroke();
    }
  },
  VO(ctx) {
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
  DR(ctx) {
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
  WF(ctx) {
    ctx.beginPath();
    ctx.moveTo(22, 9);
    ctx.bezierCurveTo(30, 18, 31, 24, 28, 29);
    ctx.bezierCurveTo(25, 34, 19, 34, 16, 29);
    ctx.bezierCurveTo(13, 24, 16, 19, 19, 16);
    ctx.bezierCurveTo(19, 21, 21, 23, 23, 23);
    ctx.bezierCurveTo(22, 18, 21, 13, 22, 9);
    ctx.stroke();
  },
  TS(ctx) {
    ctx.beginPath();
    ctx.moveTo(9, 31);
    ctx.bezierCurveTo(12, 20, 22, 11, 32, 15);
    ctx.bezierCurveTo(26, 16, 23, 22, 27, 26);
    ctx.lineTo(35, 31);
    ctx.stroke();
  },
  default(ctx) {
    ctx.beginPath();
    ctx.moveTo(22, 12);
    ctx.lineTo(22, 25);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(22, 31, 1.5, 0, Math.PI * 2);
    ctx.fill();
  },
};

export const ICON_TYPES = ['EQ', 'TC', 'FL', 'VO', 'DR', 'WF', 'TS', 'default'];

export function drawIcon(type) {
  const { c, ctx } = canvas();
  ctx.fillStyle = '#1f2a37';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.fillStyle = '#ffffff';
  (GLYPHS[type] || GLYPHS.default)(ctx);
  return ctx.getImageData(0, 0, SIZE * RATIO, SIZE * RATIO);
}

/** Data URL version for use in the legend / popups. */
export function iconDataUrl(type) {
  const { c, ctx } = canvas();
  ctx.putImageData(drawIcon(type), 0, 0);
  return c.toDataURL('image/png');
}

export function registerIcons(map) {
  for (const t of ICON_TYPES) {
    const id = `gdacs-${t}`;
    if (!map.hasImage(id)) map.addImage(id, drawIcon(t), { pixelRatio: RATIO });
  }
}
