// Story and side work for Sunspire Heat. Missions are data: each step names
// what must happen, and the engine checks it. No mission logic lives here
// beyond the script itself, so the story can be read at a glance.

import { PLACES } from './town.js';

export const STORY_INTRO = 'Dana owes the harbor crew $5,000. Five jobs. One week. No excuses.';

/** The five story jobs, in order. Rewards in dollars. */
export const MISSIONS = [
  {
    id: 'm1-first-fare',
    title: 'Job 1 — First Fare',
    brief: 'Lou needs a cab across town. Steal any car (E), then drive to the Night Market.',
    reward: 350,
    steps: [
      { kind: 'inCar', text: 'Get in a car — press E next to one.' },
      { kind: 'reach', place: 'market', radius: 90, text: 'Drive the fare to the Night Market.', inCar: true },
    ],
  },
  {
    id: 'm2-hot-package',
    title: 'Job 2 — Hot Package',
    brief: 'A parcel is waiting at Meridian Bank. Grab it on foot — the cops are watching, so expect heat.',
    reward: 600,
    steps: [
      { kind: 'reach', place: 'bank', radius: 80, text: 'Pick up the package at Meridian Bank.' },
      { kind: 'wanted', min: 1, text: 'The alarm trips — you are wanted. Lose the heat or outrun it.' },
      { kind: 'reach', place: 'safehouse', radius: 90, text: 'Get the package to the safehouse.' },
    ],
  },
  {
    id: 'm3-harbor-run',
    title: 'Job 3 — Harbor Run',
    brief: 'A Vortex Coupe is parked by Lou\u2019s Garage. Take it, then lose the two-star tail at the pier.',
    reward: 900,
    steps: [
      { kind: 'stealKind', kindName: 'coupe', text: 'Steal the Vortex Coupe near Lou\u2019s Garage.' },
      { kind: 'wanted', min: 2, text: 'SPPD is on you — two stars and climbing.' },
      { kind: 'reach', place: 'pier', radius: 100, text: 'Reach the Sunspire Pier and ditch the tail.', inCar: true },
    ],
  },
  {
    id: 'm4-rooftop-signal',
    title: 'Job 4 — Rooftop Signal',
    brief: 'Hold Sol Plaza against the harbor crew\u2019s rivals until the signal fires. Your pistol is loaded — make it count.',
    reward: 1200,
    steps: [
      { kind: 'reach', place: 'plaza', radius: 90, text: 'Get to Sol Plaza.' },
      { kind: 'survive', seconds: 45, text: 'Hold the plaza — survive the push!' },
    ],
  },
  {
    id: 'm5-big-score',
    title: 'Job 5 — The Big Score',
    brief: 'One last run: lift the Meridian Bank drop, then vanish. Three stars, one safehouse, no mistakes.',
    reward: 1950,
    steps: [
      { kind: 'reach', place: 'bank', radius: 80, text: 'Lift the drop at Meridian Bank.' },
      { kind: 'wanted', min: 3, text: 'Three stars. The whole city is looking for you.' },
      { kind: 'reach', place: 'safehouse', radius: 90, text: 'Bring it home to the safehouse. Finish the week.' },
    ],
  },
];

export const STORY_DEBT = 5000;

/** A taxi fare: pick a pedestrian up, drop them at a random place. */
export function makeTaxiJob(rnd, places) {
  const keys = Object.keys(places);
  const from = places[keys[Math.floor(rnd() * keys.length)]];
  let to = places[keys[Math.floor(rnd() * keys.length)]];
  while (to === from) to = places[keys[Math.floor(rnd() * keys.length)]];
  return {
    kind: 'taxi',
    title: 'Taxi fare',
    text: `Fare waiting at ${from.name} — take them to ${to.name}.`,
    from, to,
    fare: 60 + Math.floor(rnd() * 90),
    stage: 'pickup',
  };
}

/** A courier drop: walk a parcel to a place, on foot or by car. */
export function makeCourierJob(rnd, places) {
  const keys = Object.keys(places);
  const to = places[keys[Math.floor(rnd() * keys.length)]];
  return {
    kind: 'courier',
    title: 'Courier drop',
    text: `Parcel for ${to.name}. Deliver it, no questions.`,
    to,
    fare: 80 + Math.floor(rnd() * 70),
    stage: 'deliver',
  };
}

/** Marker position for a step that names a place. */
export function stepPlace(step) {
  if (!step.place) return null;
  return PLACES[step.place];
}

/** Short label for the current objective, for the HUD. */
export function objectiveLabel(mission, stepIndex) {
  if (!mission) return 'Free roam — press E near a yellow $ marker for side work.';
  const step = mission.steps[stepIndex];
  if (!step) return mission.title;
  return `${mission.title}: ${step.text}`;
}
