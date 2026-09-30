// Playing-surface geometry shared by the wall and the admin event picker.
// Event coordinates are 0–100 percentages of the surface: x along its length
// (left to right), y across it (top to bottom).

// Official playing-area sizes in metres (length along x, width along y).
const DIMENSIONS = {
  Football: { length: 105, width: 68 },
  Cricket: { length: 150, width: 140 },     // bounding box of the boundary oval
  Hockey: { length: 91.4, width: 55 },
  Kabaddi: { length: 13, width: 10 },       // 13 x 8 play area + 1 m lobbies on both long sides
  Basketball: { length: 28, width: 15 },
  Tennis: { length: 23.77, width: 10.97 }   // doubles court
};

export const SPORTS = Object.keys(DIMENSIONS);

// Must match SportEvents.Allowed on the server (Modules/Sports/SportsEntities.cs).
export const EVENT_TYPES = {
  Football: ['Pass', 'Shot', 'Goal', 'Tackle', 'Foul', 'Save', 'OwnGoal', 'YellowCard', 'RedCard', 'Substitution'],
  Cricket: ['Four', 'Six', 'Wicket', 'Catch', 'Delivery'],
  Hockey: ['Pass', 'Shot', 'Goal', 'Tackle', 'PenaltyCorner', 'Save'],
  Kabaddi: ['Raid', 'Tackle', 'Bonus', 'AllOut'],
  Basketball: ['Pass', 'TwoPointer', 'ThreePointer', 'FreeThrow', 'Rebound', 'Foul'],
  Tennis: ['Ace', 'Winner', 'UnforcedError', 'DoubleFault']
};

export const EVENT_COLORS = {
  Pass: '#e5e7eb', Shot: '#fb923c', Goal: '#facc15', Tackle: '#22d3ee', Foul: '#f87171', Save: '#4ade80',
  OwnGoal: '#fb7185', YellowCard: '#fde047', RedCard: '#dc2626', Substitution: '#38bdf8',
  Four: '#60a5fa', Six: '#c084fc', Wicket: '#ef4444', Catch: '#fde047', Delivery: '#94a3b8',
  PenaltyCorner: '#f472b6',
  Raid: '#facc15', Bonus: '#a3e635', AllOut: '#ef4444',
  TwoPointer: '#38bdf8', ThreePointer: '#c084fc', FreeThrow: '#f8fafc', Rebound: '#22d3ee',
  Ace: '#facc15', Winner: '#4ade80', UnforcedError: '#f87171', DoubleFault: '#fb923c'
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

const DRAWERS = {
  Football: drawFootball,
  Cricket: drawCricket,
  Hockey: drawHockey,
  Kabaddi: drawKabaddi,
  Basketball: drawBasketball,
  Tennis: drawTennis
};

export function drawSurface(ctx, rect) {
  ctx.save();
  (DRAWERS[rect.sport] ?? drawFootball)(ctx, rect);
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

function drawHockey(ctx, r) {
  const m = r.w / r.dims.length;
  const midY = r.y + r.h / 2;

  // Blue water-based turf, as used at international level.
  const stripes = 10;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 ? '#1d4f9c' : '#2159a8';
    ctx.fillRect(r.x + (i * r.w) / stripes, r.y, r.w / stripes + 1, r.h);
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = Math.max(1.5, m * 0.18);
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  line(ctx, r.x + r.w / 2, r.y, r.x + r.w / 2, r.y + r.h);
  for (const x of [22.9, r.dims.length - 22.9]) line(ctx, r.x + x * m, r.y, r.x + x * m, r.y + r.h);

  const circleR = 14.63 * m;     // shooting circle radius, centred on each goalpost
  const post = 1.83 * m;         // half the 3.66 m goal width
  for (const side of [0, 1]) {
    const goalX = side ? r.x + r.w : r.x;
    const dir = side ? -1 : 1;
    ctx.beginPath();
    if (side === 0) {
      ctx.arc(goalX, midY - post, circleR, -Math.PI / 2, 0);
      ctx.lineTo(goalX + circleR, midY + post);
      ctx.arc(goalX, midY + post, circleR, 0, Math.PI / 2);
    } else {
      ctx.arc(goalX, midY + post, circleR, Math.PI / 2, Math.PI);
      ctx.lineTo(goalX - circleR, midY - post);
      ctx.arc(goalX, midY - post, circleR, Math.PI, Math.PI * 1.5);
    }
    ctx.stroke();
    dot(ctx, goalX + dir * 6.4 * m, midY, Math.max(2, m * 0.25));   // penalty spot
    boxFromGoalLine(ctx, goalX, midY, -dir, 1.2 * m, 3.66 * m);      // goal
  }
}

function drawKabaddi(ctx, r) {
  const m = r.w / r.dims.length;
  const midX = r.x + r.w / 2;
  const lobby = 1 * m;

  // Orange play area with blue lobbies along both long sides.
  ctx.fillStyle = '#1e3a8a';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = '#c2410c';
  ctx.fillRect(r.x, r.y + lobby, r.w, r.h - lobby * 2);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.lineWidth = Math.max(2, m * 0.06);
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  line(ctx, r.x, r.y + lobby, r.x + r.w, r.y + lobby);
  line(ctx, r.x, r.y + r.h - lobby, r.x + r.w, r.y + r.h - lobby);

  ctx.lineWidth = Math.max(3, m * 0.1);
  line(ctx, midX, r.y, midX, r.y + r.h);                            // midline

  ctx.lineWidth = Math.max(2, m * 0.06);
  for (const dir of [-1, 1]) {
    const baulk = midX + dir * 3.75 * m;
    const bonus = midX + dir * 4.75 * m;
    line(ctx, baulk, r.y + lobby, baulk, r.y + r.h - lobby);         // baulk line
    ctx.setLineDash([m * 0.3, m * 0.2]);
    line(ctx, bonus, r.y + lobby, bonus, r.y + r.h - lobby);         // bonus line
    ctx.setLineDash([]);
  }
}

function drawBasketball(ctx, r) {
  const m = r.w / r.dims.length;
  const midX = r.x + r.w / 2;
  const midY = r.y + r.h / 2;

  // Hardwood: alternating planks.
  const planks = 24;
  for (let i = 0; i < planks; i++) {
    ctx.fillStyle = i % 2 ? '#c98a4b' : '#d19455';
    ctx.fillRect(r.x, r.y + (i * r.h) / planks, r.w, r.h / planks + 1);
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.lineWidth = Math.max(1.5, m * 0.05);
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  line(ctx, midX, r.y, midX, r.y + r.h);
  circle(ctx, midX, midY, 1.8 * m);

  const hoopOffset = 1.575 * m;
  const arcR = 6.75 * m;
  const cornerInset = 0.9 * m;
  // Angle where the 3-point arc meets the straight corner lines.
  const theta = Math.asin((r.h / 2 - cornerInset) / arcR);
  const cornerDepth = hoopOffset + arcR * Math.cos(theta);

  for (const side of [0, 1]) {
    const dir = side ? -1 : 1;
    const baseX = side ? r.x + r.w : r.x;
    const hoopX = baseX + dir * hoopOffset;

    ctx.fillStyle = 'rgba(153, 27, 27, 0.55)';                       // painted key
    const keyX = side ? baseX - 5.8 * m : baseX;
    ctx.fillRect(keyX, midY - 2.45 * m, 5.8 * m, 4.9 * m);
    ctx.strokeRect(keyX, midY - 2.45 * m, 5.8 * m, 4.9 * m);
    circle(ctx, baseX + dir * 5.8 * m, midY, 1.8 * m);               // free-throw circle

    ctx.beginPath();                                                 // 3-point line
    ctx.moveTo(baseX, r.y + cornerInset);
    ctx.lineTo(baseX + dir * cornerDepth, r.y + cornerInset);
    if (side === 0) ctx.arc(hoopX, midY, arcR, -theta, theta);
    else ctx.arc(hoopX, midY, arcR, Math.PI + theta, Math.PI - theta, true);
    ctx.lineTo(baseX, r.y + r.h - cornerInset);
    ctx.stroke();

    ctx.strokeStyle = '#f97316';                                     // hoop
    circle(ctx, hoopX, midY, 0.23 * m);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
  }
}

function drawTennis(ctx, r) {
  const m = r.w / r.dims.length;
  const midX = r.x + r.w / 2;
  const midY = r.y + r.h / 2;
  const alley = 1.37 * m;

  // Green surround, blue hard court. The surround stays inside the canvas margin, so it
  // frames the court instead of bleeding to the card edges.
  const surround = Math.min(2 * m, r.x * 0.75, r.y * 0.75);
  ctx.fillStyle = '#166534';
  ctx.fillRect(r.x - surround, r.y - surround, r.w + surround * 2, r.h + surround * 2);
  ctx.fillStyle = '#1d4ed8';
  ctx.fillRect(r.x, r.y, r.w, r.h);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.lineWidth = Math.max(1.5, m * 0.05);
  ctx.strokeRect(r.x, r.y, r.w, r.h);                                // doubles lines
  line(ctx, r.x, r.y + alley, r.x + r.w, r.y + alley);               // singles sidelines
  line(ctx, r.x, r.y + r.h - alley, r.x + r.w, r.y + r.h - alley);

  for (const dir of [-1, 1]) {
    const service = midX + dir * 6.4 * m;
    line(ctx, service, r.y + alley, service, r.y + r.h - alley);     // service line
    const baseline = dir < 0 ? r.x : r.x + r.w;
    line(ctx, baseline, midY, baseline - dir * 0.3 * m, midY);       // centre mark
  }
  line(ctx, midX - 6.4 * m, midY, midX + 6.4 * m, midY);             // centre service line

  ctx.strokeStyle = 'rgba(15, 23, 42, 0.95)';                        // net
  ctx.lineWidth = Math.max(3, m * 0.12);
  line(ctx, midX, r.y - 0.9 * m, midX, r.y + r.h + 0.9 * m);
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
