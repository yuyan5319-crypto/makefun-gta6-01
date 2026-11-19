// Sunspire Heat boot: build the game and start its loop.
// The engine owns the loop, input, missions and saving; this file only
// wires it to the page.
import { Game } from './engine.js';

const game = new Game();
window.__game = game;
game.start();
