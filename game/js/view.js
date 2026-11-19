// Rendering for Sunspire Heat: the top-down city, cars, people, markers and
// the minimap. Pure drawing — it reads game state and never mutates it.

import {
  TILE, WORLD_W, WORLD_H, ROAD_ROWS, ROAD_COLS, ROAD_HALF, BEACH_Y, SEA_Y,
} from './town.js';
import { clamp } from './rng.js';

const VIEW_W = 1280;
const VIEW_H = 720;

/** Camera centred on (cx,cy), clamped to the world. */
export function cameraFor(cx, cy) {
  return {
    x: clamp(cx - VIEW_W / 2, 0, WORLD_W - VIEW_W),
    y: clamp(cy - VIEW_H / 2, 0, WORLD_H - VIEW_H),
  };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draw the whole world for one frame. S is the engine's state snapshot. */
export function drawWorld(ctx, S, town, cam, time) {
  ctx.save();
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  ctx.translate(-cam.x, -cam.y);

  // --- Ground: lawn green, sand at the south shore, sea below it.
  ctx.fillStyle = '#4a7a3f';
  ctx.fillRect(cam.x - 4, cam.y - 4, VIEW_W + 8, VIEW_H + 8);
  ctx.fillStyle = '#e8d29a';
  ctx.fillRect(cam.x - 4, BEACH_Y, VIEW_W + 8, SEA_Y - BEACH_Y);
  ctx.fillStyle = '#2e7fa8';
  ctx.fillRect(cam.x - 4, SEA_Y, VIEW_W + 8, WORLD_H - SEA_Y + 4);
  // Pier decking.
  ctx.fillStyle = '#8a6a4a';
  ctx.fillRect(21.5 * TILE - 26, SEA_Y - 120, 52, 220);

  drawRoads(ctx, cam);
  drawBuildings(ctx, town, cam);
  drawProps(ctx, town, cam, time);
  drawCoins(ctx, town, cam, time);
  if (S.marker) drawMarker(ctx, S.marker, time);
  if (S.jobMarker) drawJobMarker(ctx, S.jobMarker, time);
  for (const car of S.cars) drawCar(ctx, car, time);
  for (const ped of S.peds) drawPed(ctx, ped, time);
  for (const cop of S.cops) drawCop(ctx, cop, time);
  drawPlayer(ctx, S.player, S.aim, time);
  drawParticles(ctx, S.particles);
  ctx.restore();

  // Wanted vignette: red pulse at high heat.
  if (S.wanted >= 3) {
    const pulse = 0.10 + 0.06 * Math.sin(time * 5);
    const grad = ctx.createRadialGradient(
      VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.35, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.75);
    grad.addColorStop(0, 'rgba(200,20,20,0)');
    grad.addColorStop(1, `rgba(200,20,20,${pulse})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
}

function drawRoads(ctx, cam) {
  const x0 = cam.x, y0 = cam.y, x1 = cam.x + VIEW_W, y1 = cam.y + VIEW_H;
  ctx.fillStyle = '#3a3d44';
  for (const r of ROAD_ROWS) {
    const cy = (r + 0.5) * TILE;
    ctx.fillRect(x0, cy - ROAD_HALF, VIEW_W, ROAD_HALF * 2);
  }
  for (const c of ROAD_COLS) {
    const cx = (c + 0.5) * TILE;
    ctx.fillRect(cx - ROAD_HALF, y0, ROAD_HALF * 2, VIEW_H);
  }
  // Sidewalk edges.
  ctx.fillStyle = '#9a9a8e';
  for (const r of ROAD_ROWS) {
    const cy = (r + 0.5) * TILE;
    ctx.fillRect(x0, cy - ROAD_HALF - 10, VIEW_W, 6);
    ctx.fillRect(x0, cy + ROAD_HALF + 4, VIEW_W, 6);
  }
  for (const c of ROAD_COLS) {
    const cx = (c + 0.5) * TILE;
    ctx.fillRect(cx - ROAD_HALF - 10, y0, 6, VIEW_H);
    ctx.fillRect(cx + ROAD_HALF + 4, y0, 6, VIEW_H);
  }
  // Lane dashes.
  ctx.fillStyle = '#e8d44f';
  for (const r of ROAD_ROWS) {
    const cy = (r + 0.5) * TILE;
    for (let x = Math.floor(x0 / 44) * 44; x < x1; x += 44) ctx.fillRect(x, cy - 2, 24, 4);
  }
  for (const c of ROAD_COLS) {
    const cx = (c + 0.5) * TILE;
    for (let y = Math.floor(y0 / 44) * 44; y < y1; y += 44) ctx.fillRect(cx - 2, y, 4, 24);
  }
  // Crosswalks at intersections.
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  for (const r of ROAD_ROWS) {
    for (const c of ROAD_COLS) {
      const cx = (c + 0.5) * TILE, cy = (r + 0.5) * TILE;
      for (let i = -2; i <= 2; i++) {
        ctx.fillRect(cx - 44 + i * 18, cy - ROAD_HALF + 8, 10, 18);
        ctx.fillRect(cx - 44 + i * 18, cy + ROAD_HALF - 26, 10, 18);
      }
    }
  }
}

function drawBuildings(ctx, town, cam) {
  for (const b of town.buildings) {
    if (b.x + b.w < cam.x || b.x > cam.x + VIEW_W || b.y + b.h < cam.y || b.y > cam.y + VIEW_H) continue;
    // Drop shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(b.x + 6, b.y + 8, b.w, b.h);
    // Body.
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    // Roof rim.
    ctx.strokeStyle = b.roof;
    ctx.lineWidth = 7;
    ctx.strokeRect(b.x + 3, b.y + 3, b.w - 6, b.h - 6);
    // Windows.
    ctx.fillStyle = b.tall ? '#ffe9a8' : '#dfe9f2';
    const cols = Math.max(1, b.windows);
    const rows = Math.max(1, b.floors);
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const wx = b.x + 12 + i * ((b.w - 24) / cols);
        const wy = b.y + 12 + j * ((b.h - 24) / rows);
        ctx.fillRect(wx, wy, 13, 17);
      }
    }
    if (b.tall) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(b.x + b.w * 0.2, b.y + 6, 8, b.h - 12);
    }
  }
}

function drawProps(ctx, town, cam, time) {
  // Palms: trunk + swaying fronds.
  for (const p of town.palms) {
    if (p.x < cam.x - 40 || p.x > cam.x + VIEW_W + 40 || p.y < cam.y - 40 || p.y > cam.y + VIEW_H + 40) continue;
    const sway = Math.sin(time * 1.2 + p.x) * 0.08 + p.lean;
    ctx.strokeStyle = '#6b4a2e';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + Math.sin(sway) * 14, p.y - 34);
    ctx.stroke();
    ctx.strokeStyle = '#2e7a3a';
    ctx.lineWidth = 4;
    const tx = p.x + Math.sin(sway) * 14, ty = p.y - 34;
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.55;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + Math.cos(a) * 20, ty + Math.sin(a) * 12 + 6);
      ctx.stroke();
    }
  }
  // Lamps.
  ctx.fillStyle = '#3c3f46';
  for (const l of town.lamps) {
    if (l.x < cam.x - 10 || l.x > cam.x + VIEW_W + 10 || l.y < cam.y - 10 || l.y > cam.y + VIEW_H + 10) continue;
    ctx.fillRect(l.x - 2, l.y - 2, 5, 5);
  }
}

function drawCoins(ctx, town, cam, time) {
  for (const coin of town.coins) {
    if (coin.taken) continue;
    if (coin.x < cam.x - 20 || coin.x > cam.x + VIEW_W + 20 || coin.y < cam.y - 20 || coin.y > cam.y + VIEW_H + 20) continue;
    const bob = Math.sin(time * 3 + coin.phase) * 3;
    const squish = Math.abs(Math.cos(time * 2 + coin.phase)) * 0.6 + 0.4;
    ctx.fillStyle = '#ffd23c';
    ctx.beginPath();
    ctx.ellipse(coin.x, coin.y + bob, 9 * squish, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b8860b';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('S', coin.x, coin.y + bob);
  }
}

function drawMarker(ctx, marker, time) {
  const pulse = 1 + Math.sin(time * 4) * 0.12;
  ctx.save();
  ctx.translate(marker.x, marker.y);
  ctx.strokeStyle = '#ffd23c';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, 34 * pulse, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,210,60,0.18)';
  ctx.beginPath();
  ctx.arc(0, 0, 34 * pulse, 0, Math.PI * 2);
  ctx.fill();
  // Down arrow.
  ctx.fillStyle = '#ffd23c';
  const bob = Math.sin(time * 4) * 5;
  ctx.beginPath();
  ctx.moveTo(0, -62 + bob);
  ctx.lineTo(-11, -44 + bob);
  ctx.lineTo(11, -44 + bob);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawJobMarker(ctx, marker, time) {
  ctx.save();
  ctx.translate(marker.x, marker.y);
  ctx.fillStyle = '#7dff9a';
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const bob = Math.sin(time * 3) * 3;
  ctx.fillText('$', 0, bob);
  ctx.strokeStyle = '#7dff9a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 20 + Math.sin(time * 3) * 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawCar(ctx, car, time) {
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  const def = car.def;
  const L = def.len, W = def.wid;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  roundRect(ctx, -L / 2 + 3, -W / 2 + 4, L, W, 7);
  ctx.fill();
  ctx.fillStyle = def.color;
  roundRect(ctx, -L / 2, -W / 2, L, W, 7);
  ctx.fill();
  // Windshield + rear window.
  ctx.fillStyle = '#1c2733';
  roundRect(ctx, L * 0.08, -W / 2 + 3, L * 0.2, W - 6, 3);
  ctx.fill();
  roundRect(ctx, -L * 0.32, -W / 2 + 3, L * 0.14, W - 6, 3);
  ctx.fill();
  if (car.police) {
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(-L * 0.05, -W / 2, L * 0.1, W);
    const blink = Math.floor(time * 6) % 2 === 0;
    ctx.fillStyle = blink ? '#ff2e2e' : '#2e6bff';
    ctx.beginPath();
    ctx.arc(-L * 0.05, -W / 2 + 2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = blink ? '#2e6bff' : '#ff2e2e';
    ctx.beginPath();
    ctx.arc(-L * 0.05, W / 2 - 2, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  if (car.kind === 'taxi') {
    ctx.fillStyle = '#14141a';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('TAXI', 0, 3);
  }
  if (car.brakeLight) {
    ctx.fillStyle = '#ff2e2e';
    ctx.fillRect(-L / 2 - 2, -W / 2 + 2, 3, 5);
    ctx.fillRect(-L / 2 - 2, W / 2 - 7, 3, 5);
  }
  ctx.restore();
}

function drawPed(ctx, ped) {
  ctx.save();
  ctx.translate(ped.x, ped.y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(2, 4, 10, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ped.panic ? '#ff5a3c' : ped.color;
  ctx.beginPath();
  ctx.arc(0, 0, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f2d7b8';
  ctx.beginPath();
  ctx.arc(Math.cos(ped.angle) * 3, Math.sin(ped.angle) * 3, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCop(ctx, cop) {
  ctx.save();
  ctx.translate(cop.x, cop.y);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(2, 4, 11, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#20242e';
  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2e6bff';
  ctx.beginPath();
  ctx.arc(0, 0, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPlayer(ctx, player, aim, time) {
  if (player.inCar) return; // The car drawing shows the driver.
  ctx.save();
  ctx.translate(player.x, player.y);
  const blink = player.invuln > 0 && Math.floor(time * 12) % 2 === 0;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(2, 5, 12, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  if (!blink) {
    ctx.fillStyle = '#ff5a3c';
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd23c';
    ctx.beginPath();
    ctx.arc(Math.cos(player.angle) * 4, Math.sin(player.angle) * 4, 6, 0, Math.PI * 2);
    ctx.fill();
    // Pistol direction tick.
    ctx.strokeStyle = '#20242e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(player.angle) * 22, Math.sin(player.angle) * 22);
    ctx.stroke();
  }
  if (player.muzzle > 0) {
    ctx.fillStyle = '#ffe9a8';
    ctx.beginPath();
    ctx.arc(Math.cos(player.angle) * 26, Math.sin(player.angle) * 26, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // Aim reticle at the mouse (world coords).
  if (aim) {
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(aim.x, aim.y, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(aim.x - 14, aim.y);
    ctx.lineTo(aim.x - 6, aim.y);
    ctx.moveTo(aim.x + 6, aim.y);
    ctx.lineTo(aim.x + 14, aim.y);
    ctx.moveTo(aim.x, aim.y - 14);
    ctx.lineTo(aim.x, aim.y - 6);
    ctx.moveTo(aim.x, aim.y + 6);
    ctx.lineTo(aim.x, aim.y + 14);
    ctx.stroke();
  }
}

function drawParticles(ctx, particles) {
  for (const p of particles) {
    const t = p.life / p.maxLife;
    ctx.globalAlpha = Math.max(0, t);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

/** Draw the minimap: roads, buildings, sea, blips. */
export function drawMinimap(mapCtx, S, town) {
  const mw = 220, mh = 168;
  const scale = Math.min(mw / WORLD_W, mh / WORLD_H);
  const ox = (mw - WORLD_W * scale) / 2;
  const oy = (mh - WORLD_H * scale) / 2;
  mapCtx.clearRect(0, 0, mw, mh);
  mapCtx.fillStyle = '#1a2b1a';
  mapCtx.fillRect(0, 0, mw, mh);
  // Sea.
  mapCtx.fillStyle = '#2e7fa8';
  mapCtx.fillRect(ox, oy + (SEA_Y) * scale, WORLD_W * scale, (WORLD_H - SEA_Y) * scale);
  // Roads.
  mapCtx.fillStyle = '#6a6d75';
  for (const r of ROAD_ROWS) {
    const cy = (r + 0.5) * TILE;
    mapCtx.fillRect(ox, oy + (cy - ROAD_HALF) * scale, WORLD_W * scale, ROAD_HALF * 2 * scale);
  }
  for (const c of ROAD_COLS) {
    const cx = (c + 0.5) * TILE;
    mapCtx.fillRect(ox + (cx - ROAD_HALF) * scale, oy, ROAD_HALF * 2 * scale, WORLD_H * scale);
  }
  // Buildings.
  mapCtx.fillStyle = '#3a4152';
  for (const b of town.buildings) {
    mapCtx.fillRect(ox + b.x * scale, oy + b.y * scale, Math.max(1, b.w * scale), Math.max(1, b.h * scale));
  }
  const dot = (x, y, color, r) => {
    mapCtx.fillStyle = color;
    mapCtx.beginPath();
    mapCtx.arc(ox + x * scale, oy + y * scale, r, 0, Math.PI * 2);
    mapCtx.fill();
  };
  if (S.jobMarker) dot(S.jobMarker.x, S.jobMarker.y, '#7dff9a', 4);
  if (S.marker) dot(S.marker.x, S.marker.y, '#ffd23c', 5);
  for (const car of S.cars) if (car.police) dot(car.x, car.y, '#ff2e2e', 3);
  for (const cop of S.cops) dot(cop.x, cop.y, '#2e6bff', 2.5);
  const px = S.player.inCar ? S.player.inCar.x : S.player.x;
  const py = S.player.inCar ? S.player.inCar.y : S.player.y;
  // Player: white dot with dark ring.
  mapCtx.strokeStyle = '#000';
  mapCtx.lineWidth = 2;
  mapCtx.beginPath();
  mapCtx.arc(ox + px * scale, oy + py * scale, 5, 0, Math.PI * 2);
  mapCtx.stroke();
  dot(px, py, '#ffffff', 4);
}
