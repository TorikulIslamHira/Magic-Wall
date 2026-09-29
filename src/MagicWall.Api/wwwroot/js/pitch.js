// Playing-surface geometry shared by the wall and the admin event picker.
// Event coordinates are 0–100 percentages of the surface: x along its length
// (left to right), y across it (top to bottom).

const DIMENSIONS = {
  Football: { length: 105, width: 68 },   // metres
  Cricket: { length: 150, width: 140 }    // bounding box of the boundary oval
};

export const EVENT_TYPES = {
  Football: ['Pass', 'Shot', 'Goal', 'Tackle', 'Foul', 'Save'],
  Cricket: ['Four', 'Six', 'Wicket', 'Catch', 'Delivery']
};

export const EVENT_COLORS = {
  Pass: '#e5e7eb', Shot: '#fb923c', Goal: '#facc15', Tackle: '#22d3ee', Foul: '#f87171', Save: '#4ade80',
  Four: '#60a5fa', Six: '#c084fc', Wicket: '#ef4444', Catch: '#fde047', Delivery: '#94a3b8'
};

/** Largest surface rectangle with the right aspect ratio that fits the canvas. */
export function surfaceRect(canvasWidth, canvasHeight, sport, margin = 24) {
  const dims = DIMENSIONS[sport] ?? DIMENSIONS.Football;
  const aspect = dims.length / dims.width;
  const availableW = Math.max(1, canvasWidth - margin * 2);
  const availableH = Math.max(1, canvasHeight - margin * 2);

  let w = availableW;
  let h = w / aspect;
  if (h > availableH) {
    h = availableH;
    w = h * aspect;
  }
  return { x: (canvasWidth - w) / 2, y: (canvasHeight - h) / 2, w, h, sport, dims };
}

export const toPx = (rect, x, y) => ({ x: rect.x + (x / 100) * rect.w, y: rect.y + (y / 100) * rect.h });

export function fromPx(rect, px, py) {
  const clamp = v => Math.min(100, Math.max(0, Math.round(v * 10) / 10));
  return { x: clamp(((px - rect.x) / rect.w) * 100), y: clamp(((py - rect.y) / rect.h) * 100) };
}

/** Adds the surface outline to the current path (for clipping or filling). */
export function surfacePath(ctx, rect) {
  ctx.beginPath();
  if (rect.sport === 'Cricket') {
    ctx.ellipse(rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w / 2, rect.h / 2, 0, 0, Math.PI * 2);
  } else {
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
  }
}

export function drawSurface(ctx, rect) {
  ctx.save();
  if (rect.sport === 'Cricket') drawCricket(ctx, rect);
  else drawFootball(ctx, rect);
  ctx.restore();
}

function drawFootball(ctx, r) {
  const m = r.w / r.dims.length; // pixels per metre
  const midX = r.x + r.w / 2;
  const midY = r.y + r.h / 2;

  const stripes = 12;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 ? '#2e7d32' : '#338a37';
    ctx.fillRect(r.x + (i * r.w) / stripes, r.y, r.w / stripes + 1, r.h);
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = Math.max(1.5, m * 0.12);

  ctx.strokeRect(r.x, r.y, r.w, r.h);
  line(ctx, midX, r.y, midX, r.y + r.h);
  circle(ctx, midX, midY, 9.15 * m);
  dot(ctx, midX, midY, Math.max(2, m * 0.3));

  for (const side of [0, 1]) {
    const dir = side ? -1 : 1;
    const goalLineX = side ? r.x + r.w : r.x;
    const spotX = goalLineX + dir * 11 * m;

    boxFromGoalLine(ctx, goalLineX, midY, dir, 16.5 * m, 40.32 * m);   // penalty area
    boxFromGoalLine(ctx, goalLineX, midY, dir, 5.5 * m, 18.32 * m);    // goal area
    boxFromGoalLine(ctx, goalLineX, midY, -dir, 2 * m, 7.32 * m);      // goal, behind the line
    dot(ctx, spotX, midY, Math.max(2, m * 0.3));

    // Penalty arc: the part of the 9.15 m circle round the spot that lies outside the box.
    const a = Math.acos((16.5 - 11) / 9.15);
    ctx.beginPath();
    if (side === 0) ctx.arc(spotX, midY, 9.15 * m, -a, a);
    else ctx.arc(spotX, midY, 9.15 * m, Math.PI - a, Math.PI + a);
    ctx.stroke();
  }
}

function drawCricket(ctx, r) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const mx = r.w / r.dims.length;
  const my = r.h / r.dims.width;

  // Mowing rings, outermost first.
  for (let i = 0; i < 8; i++) {
    const k = 1 - i / 8;
    ctx.fillStyle = i % 2 ? '#2e7d32' : '#338a37';
    ctx.beginPath();
    ctx.ellipse(cx, cy, (r.w / 2) * k, (r.h / 2) * k, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
  ctx.stroke();

  // 30-yard fielding circle: 27.43 m arcs round each wicket (10.06 m from the centre),
  // approximated as one oval stretched along the pitch.
  ctx.setLineDash([8, 8]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 27.43 * mx, (27.43 + 10.06) * my, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Pitch strip, 20.12 m long, running top to bottom; drawn at double width to stay visible.
  const pw = 3.05 * mx * 2;
  const ph = 20.12 * my;
  ctx.fillStyle = '#c8b27a';
  ctx.fillRect(cx - pw / 2, cy - ph / 2, pw, ph);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 1.5;
  for (const end of [-1, 1]) {
    const creaseY = cy + end * (ph / 2 - 1.22 * my);
    line(ctx, cx - pw, creaseY, cx + pw, creaseY);
    ctx.fillStyle = '#f5f5f4';
    ctx.fillRect(cx - 3, cy + end * (ph / 2) - 2, 6, 4); // stumps
  }
}

function boxFromGoalLine(ctx, goalLineX, midY, dir, depth, width) {
  const x = dir > 0 ? goalLineX : goalLineX - depth;
  ctx.strokeRect(x, midY - width / 2, depth, width);
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function circle(ctx, x, y, radius) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
}

function dot(ctx, x, y, radius) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

/** Draws an arrow from a to b; `t` (0–1) draws it partially for animation. */
export function drawArrow(ctx, a, b, color, width, t = 1) {
  const x = a.x + (b.x - a.x) * t;
  const y = a.y + (b.y - a.y) * t;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 4;
  line(ctx, a.x, a.y, x, y);

  const length = Math.hypot(x - a.x, y - a.y);
  if (length > width * 3) {
    const angle = Math.atan2(y - a.y, x - a.x);
    const head = width * 3.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - head * Math.cos(angle - 0.45), y - head * Math.sin(angle - 0.45));
    ctx.lineTo(x - head * Math.cos(angle + 0.45), y - head * Math.sin(angle + 0.45));
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Sizes a canvas for the device pixel ratio; returns its CSS size. Drawing uses CSS pixels. */
export function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const { width, height } = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w: width, h: height };
}
