// input.js — keyboard and mouse state for the game.
// Movement is read as a held-keys set each frame; discrete actions (enter
// car, attack, interact, pause) are edge-triggered through a pressed queue
// the game loop drains once per frame.

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { x: 0, y: 0, down: false, clicked: false };
    this.lastKey = null;
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      this.lastKey = k;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; });
    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = (e.clientX - r.left) * (canvas.width / r.width);
      this.mouse.y = (e.clientY - r.top) * (canvas.height / r.height);
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouse.down = true; this.mouse.clicked = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.down = false;
    });
  }

  /** Held movement axes: x from A/D or arrows, y from W/S or arrows. */
  axes() {
    const k = this.keys;
    const x = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    const y = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);
    return { x, y };
  }

  held(key) { return this.keys.has(key); }

  /** True once per physical press; the loop calls endFrame() after reading. */
  justPressed(key) { return this.pressed.has(key); }

  /** Like justPressed, but the press is eaten: a second reader this
   *  frame will not see it. For keys two systems both watch. */
  consume(key) {
    if (!this.pressed.has(key)) return false;
    this.pressed.delete(key);
    return true;
  }

  /** True once per mouse click this frame (edge-triggered like a key). */
  clicked() { return this.mouse.clicked; }

  /** The most recent key pressed, or null before any key. */
  lastPressed() { return this.lastKey; }

  /** Drain per-frame edge state. Call exactly once at the end of a frame. */
  endFrame() {
    this.pressed.clear();
    this.mouse.clicked = false;
  }
}
