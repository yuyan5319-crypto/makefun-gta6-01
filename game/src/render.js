// render.js — everything the player sees, drawn on one 2D canvas.
// The city is drawn top-down around the camera: sea, beach, roads with lane
// markings, sidewalks, neon-signed buildings with lit windows, palms and
// lamps; then cars, pedestrians, Marisol, effects; then the HUD — health,
// cash, wanted stars, the objective line and a circular minimap — and the
// full-screen states (title, pause, busted, wasted, story complete).

import {
  WORLD_W, WORLD_H, WATER_Y, ROAD, clamp, dist,
} from './world.js';
import { SCREEN, currentStage, missionOfferPoint } from './game.js';
import { MISSIONS } from './missions.js';

const DAY_SKY = ['#f7a56b', '#e35d8f', '#5b4b8a', '#1c1440', '#5b4b8a', '#f7a56b'];

/** Blend of the ambient tint for a time of day (0 dawn … 0.5 noon … 1). */
function ambient(game) {
  const t = game.dayT;
  // Simple keyframes: [time, darkness 0..1]
  const keys = [[0, 0.25], [0.22, 0], [0.45, 0.05], [0.58, 0.45], [0.72, 0.85], [0.9, 0.9], [1, 0.25]];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, d0] = keys[i];
    const [t1, d1] = keys[i + 1];
    if (t >= t0 && t <= t1) return d0 + (d1 - d0) * ((t - t0) / (t1 - t0));
  }
  return 0.3;
}

/** Rounded rectangle path helper. */
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draw the static city inside the camera view. */
function drawCity(ctx, game, cam, vw, vh) {
  const city = game.city;
  const dark = ambient(game);
  // Ground: block interiors (plazas/sidewalk slabs).
  ctx.fillStyle = '#241b3d';
  ctx.fillRect(cam.x, cam.y, vw, vh);
  // Sea and beach.
  ctx.fillStyle = '#f2c98a';
  ctx.fillRect(cam.x, WATER_Y - 96, vw, 96);
  const seaGrad = ctx.createLinearGradient(0, WATER_Y, 0, WORLD_H);
  seaGrad.addColorStop(0, '#155e75');
  seaGrad.addColorStop(1, '#0c2d4d');
  ctx.fillStyle = seaGrad;
  ctx.fillRect(cam.x, WATER_Y, vw, WORLD_H - WATER_Y);
  // Animated wave sparkles.
  ctx.fillStyle = 'rgba(165,243,252,0.5)';
  const wt = game.time * 0.7;
  for (let i = 0; i < 60; i++) {
    const wx = ((i * 173 + Math.sin(wt + i) * 12) % WORLD_W + WORLD_W) % WORLD_W;
    const wy = WATER_Y + 12 + ((i * 61) % 150);
    if (wx > cam.x - 20 && wx < cam.x + vw + 20 && wy > cam.y - 10 && wy < cam.y + vh + 10) {
      ctx.fillRect(wx, wy + Math.sin(wt * 2 + i * 1.7) * 2, 14, 2);
    }
  }
  // Roads.
  ctx.fillStyle = '#17141f';
  for (const road of city.roads) {
    ctx.fillRect(road.x, road.y, road.w, road.h);
  }
  // Lane dashes.
  ctx.fillStyle = 'rgba(250,204,21,0.55)';
  for (const road of city.roads) {
    if (road.axis === 'v') {
      for (let y = 10; y < road.h; y += 34) ctx.fillRect(road.x + road.w / 2 - 1.5, road.y + y, 3, 18);
    } else {
      for (let x = 10; x < road.w; x += 34) ctx.fillRect(road.x + x, road.y + road.h / 2 - 1.5, 18, 3);
    }
  }
  // Crosswalks at intersections (simple zebra stripes).
  ctx.fillStyle = 'rgba(226,232,240,0.35)';
  for (let c = 0; c <= 14; c++) {
    for (let r = 0; r <= 11; r++) {
      const ix = c * 176, iy = r * 176;
      if (ix + ROAD < cam.x || iy + ROAD < cam.y || ix > cam.x + vw || iy > cam.y + vh) continue;
      for (let s = 0; s < 4; s++) ctx.fillRect(ix + 6 + s * 12, iy + 2, 6, 8);
      for (let s = 0; s < 4; s++) ctx.fillRect(ix + 6 + s * 12, iy + ROAD - 10, 6, 8);
    }
  }
  // The pier.
  ctx.fillStyle = '#7c5a36';
  ctx.fillRect(city.pier.x, city.pier.y, city.pier.w, city.pier.h);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = city.pier.y + 8; y < city.pier.y + city.pier.h; y += 14) ctx.fillRect(city.pier.x, y, city.pier.w, 3);
  // Beach umbrellas.
  for (const u of city.umbrellas) {
    ctx.fillStyle = u.color;
    ctx.beginPath(); ctx.arc(u.x, u.y, 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath(); ctx.arc(u.x, u.y, 3.5, 0, Math.PI * 2); ctx.fill();
  }
  // Buildings: body, roof inset, lit windows, neon edge at night.
  for (const b of city.buildings) {
    if (b.x + b.w < cam.x || b.y + b.h < cam.y || b.x > cam.x + vw || b.y > cam.y + vh) continue;
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = b.roof;
    ctx.fillRect(b.x + 5, b.y + 5, b.w - 10, b.h - 10);
    for (const win of b.windows) {
      const lit = dark > 0.25 || win.warm;
      ctx.fillStyle = lit ? (win.warm ? 'rgba(253,224,171,0.95)' : 'rgba(165,243,252,0.9)') : 'rgba(148,163,184,0.35)';
      ctx.fillRect(b.x + win.x, b.y + win.y, 7, 9);
    }
    if (b.sign) {
      ctx.strokeStyle = b.neon;
      ctx.globalAlpha = 0.55 + dark * 0.45;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(b.x + 2, b.y + 2, b.w - 4, b.h - 4);
      ctx.globalAlpha = 1;
    }
  }
  // Palms: trunk dot + fronds.
  for (const t of city.trees) {
    if (t.x < cam.x - 30 || t.y < cam.y - 30 || t.x > cam.x + vw + 30 || t.y > cam.y + vh + 30) continue;
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 2.4 * t.s;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.4;
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.quadraticCurveTo(t.x + Math.cos(a) * 9 * t.s, t.y + Math.sin(a) * 9 * t.s - 3, t.x + Math.cos(a) * 15 * t.s, t.y + Math.sin(a) * 15 * t.s + 3);
      ctx.stroke();
    }
    ctx.fillStyle = '#92400e';
    ctx.beginPath(); ctx.arc(t.x, t.y, 3 * t.s, 0, Math.PI * 2); ctx.fill();
  }
  // Lamp glow pools at night.
  if (dark > 0.3) {
    for (const l of city.lamps) {
      if (l.x < cam.x - 60 || l.y < cam.y - 60 || l.x > cam.x + vw + 60 || l.y > cam.y + vh + 60) continue;
      const g = ctx.createRadialGradient(l.x, l.y, 2, l.x, l.y, 36);
      g.addColorStop(0, 'rgba(253,224,171,0.20)');
      g.addColorStop(1, 'rgba(253,224,171,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(l.x, l.y, 36, 0, Math.PI * 2); ctx.fill();
    }
  }
}

/** One car, top-down, with lights, windows and damage smoke. */
function drawCar(ctx, game, car) {
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  const w = car.w, h = car.h;
  // Shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  rr(ctx, -w / 2 + 3, -h / 2 + 4, w, h, 7); ctx.fill();
  // Body.
  ctx.fillStyle = car.dead ? '#3f3f46' : car.color;
  rr(ctx, -w / 2, -h / 2, w, h, 7); ctx.fill();
  // Police livery.
  if (car.kind === 'police') {
    ctx.fillStyle = '#1e3a8a';
    ctx.fillRect(-w / 2, -h / 2, w, 5);
    ctx.fillRect(-w / 2, h / 2 - 5, w, 5);
    const flash = Math.sin(car.sirenPhase) > 0;
    ctx.fillStyle = flash ? '#ef4444' : '#3b82f6';
    ctx.fillRect(-4, -5, 8, 10);
    ctx.fillStyle = flash ? 'rgba(239,68,68,0.30)' : 'rgba(59,130,246,0.30)';
    ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.fill();
  }
  // Cabin and windows.
  ctx.fillStyle = 'rgba(15,23,42,0.9)';
  rr(ctx, -w * 0.18, -h * 0.36, w * 0.4, h * 0.72, 4); ctx.fill();
  ctx.fillStyle = 'rgba(125,211,252,0.5)';
  ctx.fillRect(w * 0.16, -h * 0.32, 3.5, h * 0.64);
  // Headlights / taillights.
  ctx.fillStyle = '#fef9c3';
  ctx.fillRect(w / 2 - 3, -h / 2 + 2, 3, 5);
  ctx.fillRect(w / 2 - 3, h / 2 - 7, 3, 5);
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(-w / 2, -h / 2 + 2, 3, 5);
  ctx.fillRect(-w / 2, h / 2 - 7, 3, 5);
  ctx.restore();
  // Damage smoke.
  if (!car.dead && car.health < 45) {
    ctx.fillStyle = 'rgba(148,163,184,0.5)';
    const puffs = 3;
    for (let i = 0; i < puffs; i++) {
      const px = car.x + Math.sin(game.time * 3 + i * 2.1) * 6;
      const py = car.y - 8 - ((game.time * 22 + i * 13) % 18);
      ctx.beginPath(); ctx.arc(px, py, 3 + i * 1.6, 0, Math.PI * 2); ctx.fill();
    }
  }
  if (car.dead && car.health <= 0) {
    ctx.fillStyle = 'rgba(249,115,22,0.75)';
    ctx.beginPath(); ctx.arc(car.x, car.y, 8 + Math.sin(game.time * 11) * 2.5, 0, Math.PI * 2); ctx.fill();
  }
}

/** One pedestrian (or Marisol when `hero` is set). */
function drawPed(ctx, game, ped, hero) {
  const bob = ped.state === 'flee' || hero ? Math.sin(game.time * 12 + ped.x * 0.05) * 1.6 : Math.sin(game.time * 6 + ped.y * 0.05) * 1.1;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(ped.x, ped.y + 7, 7, 3.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = hero ? '#ff5da2' : ped.color;
  ctx.beginPath(); ctx.arc(ped.x, ped.y + bob * 0.3, hero ? 8 : 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = hero ? '#7c2d12' : '#334155';
  ctx.beginPath(); ctx.arc(ped.x, ped.y - 3 + bob * 0.3, 4.2, 0, Math.PI * 2); ctx.fill();
  if (ped.kind === 'cop') {
    ctx.fillStyle = '#1e3a8a';
    ctx.fillRect(ped.x - 5, ped.y - 9 + bob * 0.3, 10, 4);
    ctx.fillStyle = '#facc15';
    ctx.fillRect(ped.x - 1, ped.y - 8 + bob * 0.3, 2, 2);
  }
  if (hero) {
    // Direction tick so the player reads her facing.
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ped.x + Math.cos(ped.angle) * 9, ped.y + Math.sin(ped.angle) * 9);
    ctx.lineTo(ped.x + Math.cos(ped.angle) * 14, ped.y + Math.sin(ped.angle) * 14);
    ctx.stroke();
  }
}

/** Pulsing objective marker: a beacon column and ground ring. */
function drawMarker(ctx, game, x, y, color) {
  const pulse = 1 + Math.sin(game.time * 4) * 0.15;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(x, y, 20 * pulse, 0, Math.PI * 2); ctx.stroke();
  const grad = ctx.createLinearGradient(0, y - 130, 0, y);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(1, color);
  ctx.fillStyle = grad;
  ctx.globalAlpha = 0.35;
  ctx.fillRect(x - 3, y - 130, 6, 130);
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - 34 - Math.sin(game.time * 4) * 4);
  ctx.lineTo(x - 8, y - 48 - Math.sin(game.time * 4) * 4);
  ctx.lineTo(x + 8, y - 48 - Math.sin(game.time * 4) * 4);
  ctx.closePath(); ctx.fill();
}

/** The circular minimap: roads, water, markers, police and the player. */
function drawMinimap(ctx, game, vw) {
  const size = 168;
  const cx = vw - size / 2 - 16;
  const cy = size / 2 + 16;
  const scale = size / WORLD_W;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, size / 2, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#191233';
  ctx.fillRect(cx - size / 2, cy - size / 2, size, size * (WORLD_H / WORLD_W));
  ctx.fillStyle = '#0e7490';
  ctx.fillRect(cx - size / 2, cy - size / 2 + WATER_Y * scale, size, (WORLD_H - WATER_Y) * scale);
  ctx.strokeStyle = 'rgba(226,232,240,0.32)';
  ctx.lineWidth = 1;
  for (const road of game.city.roads) {
    ctx.beginPath();
    if (road.axis === 'v') {
      ctx.moveTo(cx - size / 2 + (road.x + ROAD / 2) * scale, cy - size / 2);
      ctx.lineTo(cx - size / 2 + (road.x + ROAD / 2) * scale, cy - size / 2 + WORLD_H * scale);
    } else {
      ctx.moveTo(cx - size / 2, cy - size / 2 + (road.y + ROAD / 2) * scale);
      ctx.lineTo(cx - size / 2 + WORLD_W * scale, cy - size / 2 + (road.y + ROAD / 2) * scale);
    }
    ctx.stroke();
  }
  const stage = currentStage(game);
  const offer = missionOfferPoint(game);
  const dot = (x, y, color, r) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx - size / 2 + x * scale, cy - size / 2 + y * scale, r, 0, Math.PI * 2);
    ctx.fill();
  };
  for (const car of game.cars) {
    if (car.kind === 'police' && !car.dead) dot(car.x, car.y, Math.sin(game.time * 9) > 0 ? '#ef4444' : '#3b82f6', 2.6);
  }
  if (stage) {
    if (stage.kind === 'trial') {
      const pt = stage.points[game.mission.checkpoint];
      if (pt) dot(pt.x, pt.y, '#22d3ee', 3.4);
    } else if (stage.kind === 'steal' && game.mission.targetCarId) {
      const car = game.cars.find((c) => c.id === game.mission.targetCarId);
      if (car) dot(car.x, car.y, '#facc15', 3.4);
    } else if (stage.x !== undefined) dot(stage.x, stage.y, '#facc15', 3.4);
  } else if (offer) dot(offer.x, offer.y, '#a3e635', 3.2);
  for (const pk of game.pickups) if (!pk.taken) dot(pk.x, pk.y, '#a3e635', 1.8);
  // Player arrow.
  const px = cx - size / 2 + game.player.x * scale;
  const py = cy - size / 2 + game.player.y * scale;
  ctx.translate(px, py);
  ctx.rotate(game.player.angle);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(6, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, size / 2, 0, Math.PI * 2); ctx.stroke();
}

/** Wanted stars, filled for the current level. */
function drawStars(ctx, game, vw) {
  const y = 196;
  for (let i = 0; i < 5; i++) {
    const x = vw - 34 - i * 30;
    ctx.font = '24px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = i < game.wanted ? '#facc15' : 'rgba(255,255,255,0.22)';
    ctx.fillText('★', x, y);
  }
  if (game.player.bustMeter > 0.05) {
    ctx.fillStyle = 'rgba(239,68,68,0.85)';
    rr(ctx, vw - 184, y + 8, 150 * clamp(game.player.bustMeter / 1.6, 0, 1), 7, 3); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('BUSTED?', vw - 34, y + 30);
  }
}

/** The HUD: health, armour of information — cash, district, objective. */
function drawHud(ctx, game, vw, vh, locationName) {
  const p = game.player;
  // Health bar, bottom left.
  ctx.fillStyle = 'rgba(10,6,24,0.66)';
  rr(ctx, 16, vh - 64, 224, 48, 10); ctx.fill();
  ctx.fillStyle = '#3f1d38';
  rr(ctx, 26, vh - 52, 160, 13, 6); ctx.fill();
  ctx.fillStyle = p.health > 30 ? '#ff5da2' : '#ef4444';
  rr(ctx, 26, vh - 52, 160 * clamp(p.health / 100, 0, 1), 13, 6); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('MARISOL', 26, vh - 24);
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText(p.car ? 'DRIVING' : 'ON FOOT', 108, vh - 24);
  // Cash + district, top left.
  ctx.fillStyle = 'rgba(10,6,24,0.66)';
  rr(ctx, 16, 16, 252, 62, 10); ctx.fill();
  ctx.fillStyle = '#a3e635';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillText(`$${game.money.toLocaleString('en-US')}`, 28, 44);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillText(locationName, 28, 66);
  // Objective panel under the cash.
  const stage = currentStage(game);
  const offer = missionOfferPoint(game);
  let objective = null;
  if (stage) {
    objective = stage.kind === 'trial'
      ? `${stage.label} — checkpoint ${game.mission.checkpoint + 1}/${stage.points.length}`
      : stage.label;
  } else if (offer) objective = game.storyDone ? 'Free roam — the harbour is yours' : 'Go to the green phone marker to take the next job';
  if (objective) {
    ctx.font = '14px system-ui, sans-serif';
    const wText = Math.min(430, ctx.measureText(objective).width + 28);
    ctx.fillStyle = 'rgba(10,6,24,0.66)';
    rr(ctx, 16, 88, wText, 34, 10); ctx.fill();
    ctx.fillStyle = '#fde68a';
    ctx.fillText(objective, 28, 110);
  }
  if (game.mission && game.mission.timer !== null && game.mission.timer !== undefined) {
    const t = Math.max(0, game.mission.timer);
    ctx.fillStyle = t < 12 ? '#ef4444' : '#22d3ee';
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`, vw / 2, 44);
  }
  drawMinimap(ctx, game, vw);
  drawStars(ctx, game, vw);
  // Transient centre message.
  if (game.messageT > 0 && game.message) {
    ctx.globalAlpha = clamp(game.messageT, 0, 1);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 21px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 8;
    ctx.fillText(game.message, vw / 2, vh * 0.24);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
  // Dialogue box.
  if (game.dialogue && game.dialogue.length) {
    const line = game.dialogue[0];
    const colon = line.indexOf(':');
    const who = colon > 0 ? line.slice(0, colon) : '';
    const text = colon > 0 ? line.slice(colon + 1).trim() : line;
    ctx.fillStyle = 'rgba(8,4,20,0.82)';
    rr(ctx, vw / 2 - 330, vh - 128, 660, 56, 12); ctx.fill();
    ctx.strokeStyle = 'rgba(255,93,162,0.6)';
    ctx.lineWidth = 1.5;
    rr(ctx, vw / 2 - 330, vh - 128, 660, 56, 12); ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ff5da2';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText(who.toUpperCase(), vw / 2 - 312, vh - 104);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '15px system-ui, sans-serif';
    ctx.fillText(text, vw / 2 - 312 + ctx.measureText(who.toUpperCase()).width + 12, vh - 104);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('The harbour listens…', vw / 2 - 312, vh - 84);
  }
  // Hurt vignette.
  if (p.hurtFlash > 0) {
    ctx.fillStyle = `rgba(220,38,38,${p.hurtFlash * 0.55})`;
    ctx.fillRect(0, 0, vw, vh);
  }
  // Interaction prompt.
  if (!p.car && game.screen === SCREEN.PLAY) {
    let nearCar = false;
    for (const car of game.cars) if (!car.dead && dist(car.x, car.y, p.x, p.y) < 40) { nearCar = true; break; }
    if (nearCar) {
      ctx.fillStyle = 'rgba(10,6,24,0.75)';
      rr(ctx, vw / 2 - 70, vh - 108, 140, 26, 8); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('E — get in', vw / 2, vh - 90);
    }
  }
}

/** Title / pause / end screens: one painter with variants. */
function drawScreen(ctx, game, vw, vh) {
  const s = game.screen;
  if (s === SCREEN.PLAY) return;
  ctx.fillStyle = s === SCREEN.TITLE ? 'rgba(9,4,22,0.55)' : 'rgba(9,4,22,0.72)';
  ctx.fillRect(0, 0, vw, vh);
  ctx.textAlign = 'center';
  if (s === SCREEN.TITLE) {
    const grad = ctx.createLinearGradient(0, vh * 0.16, 0, vh * 0.42);
    grad.addColorStop(0, '#facc15');
    grad.addColorStop(0.55, '#ff5da2');
    grad.addColorStop(1, '#22d3ee');
    ctx.fillStyle = grad;
    ctx.font = 'bold 84px system-ui, sans-serif';
    ctx.fillText('MARISOL HEAT', vw / 2, vh * 0.34);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '28px system-ui, sans-serif';
    ctx.fillText('— NEON HARBOR —', vw / 2, vh * 0.34 + 44);
    ctx.font = '17px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(248,250,252,0.9)';
    ctx.fillText('An open-world crime story in a neon harbour city.', vw / 2, vh * 0.52);
    ctx.fillText('Explore on foot and by car. Run jobs. Dodge the harbour patrol.', vw / 2, vh * 0.52 + 26);
    ctx.font = 'bold 19px system-ui, sans-serif';
    ctx.fillStyle = '#a3e635';
    const hasSave = game.missionIndex > 0 || game.money !== 40;
    ctx.fillText(hasSave ? 'Press ENTER to continue  ·  N for a new game' : 'Press ENTER to start', vw / 2, vh * 0.64);
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(248,250,252,0.75)';
    ctx.fillText('WASD / arrows move · E enter car · mouse aim, click or F attack · Shift sprint · H horn · P pause · M mute', vw / 2, vh * 0.70);
    ctx.fillText(`Jobs done: ${game.missionIndex}/${MISSIONS.length} · Cash earned: $${game.stats.earned.toLocaleString('en-US')} · Cars stolen: ${game.stats.carsStolen}`, vw / 2, vh * 0.76);
  } else if (s === SCREEN.PAUSED) {
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.fillText('PAUSED', vw / 2, vh * 0.42);
    ctx.font = '17px system-ui, sans-serif';
    ctx.fillText('P or Esc to resume · progress saves itself as you play', vw / 2, vh * 0.42 + 36);
  } else if (s === SCREEN.BUSTED) {
    ctx.fillStyle = '#facc15';
    ctx.font = 'bold 64px system-ui, sans-serif';
    ctx.fillText('BUSTED', vw / 2, vh * 0.42);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillText('The harbour patrol walks Marisol to a cell. The fine stings.', vw / 2, vh * 0.42 + 40);
    ctx.fillText('Press ENTER to walk out and keep playing', vw / 2, vh * 0.42 + 70);
  } else if (s === SCREEN.WASTED) {
    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 64px system-ui, sans-serif';
    ctx.fillText('WASTED', vw / 2, vh * 0.42);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillText('Marisol wakes at the harbour clinic, lighter in the pocket.', vw / 2, vh * 0.42 + 40);
    ctx.fillText('Press ENTER to keep playing', vw / 2, vh * 0.42 + 70);
  } else if (s === SCREEN.COMPLETE) {
    ctx.fillStyle = '#a3e635';
    ctx.font = 'bold 52px system-ui, sans-serif';
    ctx.fillText('DEBT PAID', vw / 2, vh * 0.4);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillText('Marisol Heat owns her harbour now. The city stays open.', vw / 2, vh * 0.4 + 40);
    ctx.fillText('Press ENTER to free-roam Neon Harbor', vw / 2, vh * 0.4 + 70);
  }
}

/**
 * Draw one frame. `cam` is the camera centre in world coordinates; the
 * canvas is translated so the world renders around it, then the HUD is
 * drawn in screen space.
 */
export function render(ctx, game, vw, vh, cam, locationName) {
  ctx.fillStyle = '#0b0614';
  ctx.fillRect(0, 0, vw, vh);
  const shakeX = game.shake ? (Math.random() - 0.5) * game.shake : 0;
  const shakeY = game.shake ? (Math.random() - 0.5) * game.shake : 0;
  const view = { x: cam.x - vw / 2 + shakeX, y: cam.y - vh / 2 + shakeY, w: vw, h: vh };
  ctx.save();
  ctx.translate(-view.x, -view.y);
  drawCity(ctx, game, view, vw, vh);
  // Mission markers.
  const stage = currentStage(game);
  const offer = missionOfferPoint(game);
  if (game.screen !== SCREEN.TITLE) {
    if (stage) {
      if (stage.kind === 'trial') {
        const pt = stage.points[game.mission.checkpoint];
        if (pt) drawMarker(ctx, game, pt.x, pt.y, '#22d3ee');
      } else if (stage.kind === 'steal' && game.mission.targetCarId) {
        const car = game.cars.find((c) => c.id === game.mission.targetCarId);
        if (car) drawMarker(ctx, game, car.x, car.y, '#facc15');
      } else if (stage.x !== undefined) {
        drawMarker(ctx, game, stage.x, stage.y, stage.kind === 'escape' ? '#f472b6' : '#facc15');
      }
    } else if (offer) {
      drawMarker(ctx, game, offer.x, offer.y, '#a3e635');
    }
  }
  // Cash pickups.
  for (const pk of game.pickups) {
    if (pk.taken) continue;
    ctx.fillStyle = '#a3e635';
    ctx.save();
    ctx.translate(pk.x, pk.y + Math.sin(game.time * 3 + pk.x) * 2);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-5, -5, 10, 10);
    ctx.restore();
  }
  // Entities: cars under peds under the hero.
  for (const car of game.cars) {
    if (car.x < view.x - 80 || car.y < view.y - 80 || car.x > view.x + vw + 80 || car.y > view.y + vh + 80) continue;
    if (car === game.player.car) continue;
    drawCar(ctx, game, car);
  }
  for (const ped of game.peds) {
    if (ped.dead) {
      ctx.fillStyle = 'rgba(30,27,40,0.8)';
      ctx.beginPath(); ctx.ellipse(ped.x, ped.y, 9, 5, ped.angle, 0, Math.PI * 2); ctx.fill();
      continue;
    }
    drawPed(ctx, game, ped, false);
  }
  if (game.player.car) drawCar(ctx, game, game.player.car);
  else if (!game.player.dead || game.screen === SCREEN.TITLE) drawPed(ctx, game, { ...game.player, state: 'walk' }, true);
  // Bullets as tracers.
  ctx.strokeStyle = '#fde68a';
  ctx.lineWidth = 2;
  for (const b of game.bullets) {
    ctx.beginPath();
    ctx.moveTo(b.x - b.vx * 0.014, b.y - b.vy * 0.014);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  // Particles and floaters.
  for (const pt of game.particles) {
    ctx.globalAlpha = clamp(pt.life / pt.maxLife, 0, 1);
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
  }
  ctx.globalAlpha = 1;
  ctx.font = 'bold 14px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const f of game.floaters) {
    ctx.globalAlpha = clamp(f.life, 0, 1);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  // Night tint over the world (HUD stays bright).
  const dark = ambient(game);
  if (dark > 0.02) {
    ctx.fillStyle = `rgba(8,6,38,${dark * 0.34})`;
    ctx.fillRect(0, 0, vw, vh);
  }
  if (game.screen !== SCREEN.TITLE) drawHud(ctx, game, vw, vh, locationName);
  drawScreen(ctx, game, vw, vh);
}
