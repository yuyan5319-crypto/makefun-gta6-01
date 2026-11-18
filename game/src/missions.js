// missions.js — "Marisol Heat": a five-job story arc in Neon Harbor.
// Marisol Vega, a dock courier who owes money to the wrong people, takes a
// string of escalating jobs for fixer Delia "Dee" Okafor: a quiet delivery,
// a borrowed boat of a car, a loud escape, a harbour time trial, and one
// last run to the pier that pays the debt off — or buries her.
// Each mission is data: a briefing, a sequence of stages (go somewhere, be
// in a specific car, survive a wanted level, beat a clock) and a payout.

import { avenueX, streetY, WORLD_W, WATER_Y } from './world.js';

/** A story contact: name and the colour their dialogue is drawn in. */
export const CONTACTS = {
  dee: { name: 'Dee Okafor', color: '#22d3ee' },
  marisol: { name: 'Marisol', color: '#ff5da2' },
  renzo: { name: 'Renzo', color: '#facc15' },
};

/**
 * Stage kinds the game loop understands:
 *   goto     — reach the marker (on foot or driving, as `anyVehicle` says)
 *   steal    — enter the highlighted car, then reach the marker
 *   escape   — hold a wanted level, then lose it / reach the safehouse
 *   trial    — pass every checkpoint before the clock runs out
 *   deliver  — reach the marker while driving any car, against the clock
 */
export const MISSIONS = [
  {
    id: 'first-fare',
    title: 'First Fare',
    from: 'dee',
    brief: [
      'Dee: Marisol. You owe the Cannery three months. Work it off.',
      'Dee: Take the envelope from the Neon Mile kiosk to Renzo at the docks. Quiet. On foot is fine, a car is faster.',
      'Marisol: One envelope. How hard can it be?',
    ],
    reward: 250,
    stages: [
      { kind: 'goto', label: 'Pick up the envelope at the Neon Mile kiosk', x: avenueX(7) + 30, y: streetY(3) + 30, r: 42, anyVehicle: true },
      { kind: 'goto', label: 'Deliver the envelope to Renzo at the South Docks', x: avenueX(4) + 26, y: streetY(9) + 24, r: 46, anyVehicle: true },
    ],
    outro: ['Renzo: Dee sends a courier with soft hands. Cute.', 'Renzo: Tell her the docks remember favours.'],
  },
  {
    id: 'borrowed-wheels',
    title: 'Borrowed Wheels',
    from: 'dee',
    brief: [
      'Dee: A collector in Cielo Heights left a vermilion coupe by the curb. He will not miss it for an hour.',
      'Dee: Take it — yes, steal it — and park it in the Portside garage. If the harbour patrol notices, that is your problem.',
      'Marisol: Grand theft, second job in. Love the career ladder.',
    ],
    reward: 600,
    stages: [
      { kind: 'steal', label: 'Steal the vermilion coupe in Cielo Heights', x: avenueX(11) - 20, y: streetY(2) + 20, r: 60 },
      { kind: 'goto', label: 'Park the coupe at the Portside garage', x: avenueX(1) + 26, y: streetY(5) + 26, r: 46, anyVehicle: false, needVehicle: true },
    ],
    outro: ['Dee: Clean work. The collector is still at brunch.', 'Dee: Your cut grows. So does the attention.'],
  },
  {
    id: 'loud-exit',
    title: 'Loud Exit',
    from: 'renzo',
    brief: [
      'Renzo: The Cannery deal went loud, Marisol. Half the harbour patrol is rolling.',
      'Renzo: Draw them out, shake them, and get to the safehouse on Old Cannery Row. Do not lead them to my door.',
      'Marisol: So the plan is: be the bait. Great plan, Renzo.',
    ],
    reward: 900,
    stages: [
      { kind: 'escape', label: 'Make noise downtown until the patrol responds (2 stars)', x: avenueX(7), y: streetY(5), r: 300, stars: 2 },
      { kind: 'goto', label: 'Lose the heat and reach the Cannery Row safehouse', x: avenueX(2) + 24, y: streetY(4) + 24, r: 48, anyVehicle: true, needCalm: true },
    ],
    outro: ['Renzo: You are either very good or very lucky.', 'Marisol: Both. Invoice is in the mail.'],
  },
  {
    id: 'harbour-trial',
    title: 'Harbour Trial',
    from: 'dee',
    brief: [
      'Dee: A buyer wants proof Neon Harbor freight moves fast. Six checkpoints, one clock, harbour to heights.',
      'Dee: Any car you like. Try not to redecorate it with pedestrians.',
      'Marisol: Six checkpoints. Tell him to watch the skyline.',
    ],
    reward: 1200,
    stages: [
      {
        kind: 'trial', label: 'Run the six harbour checkpoints before the clock dies', time: 105,
        points: [
          { x: avenueX(2), y: streetY(8) }, { x: avenueX(5), y: streetY(6) },
          { x: avenueX(8), y: streetY(7) }, { x: avenueX(10), y: streetY(4) },
          { x: avenueX(7), y: streetY(2) }, { x: avenueX(12), y: streetY(1) },
        ],
        r: 52,
      },
    ],
    outro: ['Dee: The buyer doubled his order. Everyone wants the fast girl.', 'Dee: One more run pays your whole debt. Sleep first.'],
  },
  {
    id: 'last-run',
    title: 'The Last Run',
    from: 'renzo',
    brief: [
      'Renzo: A crate comes off the night ferry. Take it to the end of the pier before dawn — the patrol will try to stop you.',
      'Renzo: Finish this and the Cannery debt is ash, Marisol. Fail, and the harbour keeps you.',
      'Marisol: Then watch the pier lights, Renzo. I am coming home.',
    ],
    reward: 2500,
    stages: [
      { kind: 'goto', label: 'Collect the crate at the ferry dock', x: avenueX(10) + 20, y: streetY(10) + 16, r: 46, anyVehicle: true, heat: 2 },
      { kind: 'deliver', label: 'Drive the crate to the end of the pier', x: WORLD_W / 2, y: WATER_Y + 96, r: 52, time: 90, needVehicle: true },
    ],
    outro: [
      'Renzo: Debt paid. The harbour is yours now, Marisol.',
      'Marisol: It always was. It just did not know it yet.',
      '— MARISOL HEAT: story complete. The city stays open: drive, earn, and try the trial again from the start screen.',
    ],
  },
];

/** Side income: cash pickups that respawn around the docks. */
export function pickupSpots() {
  return [
    { x: avenueX(3) + 18, y: streetY(7) + 18 },
    { x: avenueX(9) - 16, y: streetY(8) + 20 },
    { x: avenueX(6) + 20, y: streetY(1) + 18 },
    { x: avenueX(12) + 14, y: streetY(6) - 16 },
    { x: avenueX(1) - 14, y: streetY(2) + 20 },
  ];
}
