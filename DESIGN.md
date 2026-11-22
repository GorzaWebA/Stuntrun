# Stuntrun art direction

Stuntrun is a **travelling stunt show set up in a desert canyon**. Every track is an act in the show programme, and the whole game looks like it was painted for that show: fairground signage, slab lettering, marquee bulbs, admission tickets, rosettes. The 3D world and the interface share one palette so they read as the same place.

## Palette

| Name | Hex | Used for |
| --- | --- | --- |
| Ink | `#2a1f33` | Panels, text on light, gate frames, outlines |
| Marquee | `#ffc42e` | Everything you can press, tickets, the track structure |
| Show red | `#e23b2e` | Signs, curbs, the start banner, warnings |
| Bone | `#f6ead2` | Text on dark, curb stripes, lettering |
| Canyon teal | `#2a9d9a` | Checkpoints, "faster" splits, secondary info |
| Sand | `#e4b878` | The desert floor |

Rules:

- **Marquee yellow means "press this".** Primary buttons and track tickets are yellow, and nothing decorative is.
- **Solid colours and hard shadows** (`0 4px 0` ink) like printed signs. No glass blur, no glows, and no gradients except the sky.
- The track is always yellow underneath, with red and bone stripes on top, so it reads the same on the ground, on walls and upside down.

## Type

- **Alfa Slab One** (woodtype slab) is the show lettering: the logo, panel titles, track names and stunt callouts.
- **Barlow Condensed** 500 / 600 / 700 is the instrument type: buttons, body text and every number. Numbers always use tabular figures, so timers don't jitter.
- Sentence case everywhere. Capitals appear only on the painted signs in the 3D world.

## Shapes

- Buttons: 6 px radius with a hard 4 px ink shadow. When pressed they move down and the shadow shrinks.
- Panels: 12 px radius, ink, with a 2 px bone inner rule (`inset 0 0 0 2px`).
- Tracks are **tickets**. They have a stub with the act number, a perforation with notches, and a minimap of the actual route.
- Medals are **rosettes** (gold, silver, bronze), never coloured dots.

## Motion

One signature motion: the bulbs around the logo chase on the main menu. The start lights fill one by one in the countdown. Everything else only moves in answer to the player (button presses, callouts, results).

## World

- Sand ground, layered red-rock mesas on the horizon, saguaro cacti, desert scrub and rust-coloured rocks.
- Warm afternoon light, peach horizon, a visible sun, flat soft clouds.
- Gates are show signs: an ink frame, marquee bulbs, bunting, and painted lettering (START, CHECKPOINT, FINISH).
- Open areas are concrete arena floor with red and bone edge stripes like the curbs. Obstacles use the same red, bone, yellow and ink.
- Effects stay low-poly: tyre smoke and dust as faceted puffs, sparks on impacts, confetti at the finish.
