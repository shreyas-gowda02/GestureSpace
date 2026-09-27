# GestureSpace — how to use every feature

The user guide: every control of every experience, kept up to date whenever a feature is built or
changed. If the app and this file disagree, the file is out of date. Please say so.

_Last updated: 2026-09-27, Phase 9 (Hand Strings)._

| Key | Experience          | Status                                                                 |
| --- | ------------------- | ---------------------------------------------------------------------- |
| 1   | Voxel Builder       | ✅ Ready (building, depth layers, move / resize / twist, 3D fist turn) |
| 2   | Spatial Panel       | ✅ Ready (hold, move, resize, rotate; pictures, camera, your own)      |
| 3   | Air Draw            | ✅ Ready (point to draw, fist eraser)                                  |
| 4   | Hand Strings        | ✅ Ready (glowing joints, elastic threads, fingertip trails, 3 styles) |
| 5   | Filter Lab          | 🚧 Placeholder — coming in Phase 10                                    |
| 6   | Portal / Dimensions | 🚧 Placeholder — coming in Phase 10                                    |
| 7   | 3D Object Lab       | 🚧 Placeholder — coming in Phase 11                                    |

---

## 1. Getting started

1. Run `npm run dev` and open **http://localhost:5173** in Chrome or Edge.
2. Click **Enable camera** and allow camera access. Nothing leaves your computer: no uploads, no
   server.
3. Sit about **an arm's length** from the camera, in good light, so **both hands fit in the
   picture** with some room around them.
4. The picture works like a **mirror**: raise your right hand and it shows on the right.
5. Pick an experience with the dock on the left, or press **1–7**.

**What's on screen**

- **Top bar:** the experience name, "Camera on", FPS, **Help**, **Debug** and **Settings** (⚙).
  Help and Settings don't open anything yet (Phase 12).
- **Dock (left):** the 7 experiences.
- **Tool panel (right):** the current experience's tools, and a **Gestures** list of its
  controls. Collapse it with the **›** button.
- **Status bar (bottom):** what the app sees each hand doing, e.g.
  `Right: pinch · Left: open · Two-hand ✓`, then what the experience is doing, e.g. "Building —
  release to finish". It also holds **Undo**, **Redo**, **Clear**, **Reset** and **Stop cam**.
- **Hand skeletons:** your right hand in turquoise, left in magenta, each with a side label and
  confidence %. A hand drawn faded means it was just lost; it's kept for 0.15 s in case it comes
  straight back.

**Your "main" hand is the right hand.** It builds and draws; the left hand does the helper
actions (depth dial, eraser fist). There's no left-handed setting yet (Phase 12).

**Only one person is tracked.** If someone walks behind you, the app keeps following your hands
(the closest, biggest pair).

---

## 2. The hand gestures

These are the building blocks every experience uses. Check the **status bar** to see what the app
thinks each hand is doing; that's the first thing to look at when something doesn't react.

| Gesture            | How to make it                                                      | Status bar shows |
| ------------------ | ------------------------------------------------------------------- | ---------------- |
| **Open hand**      | Fingers spread, relaxed                                             | `open`           |
| **Pinch**          | Thumb tip and index fingertip touching                              | `pinch`          |
| **Point**          | Index finger straight out, the other three fingers curled           | `point`          |
| **Fist**           | All four fingers curled into the palm (the thumb can stay out)      | `grab`           |
| **Two-hand ✓**     | Both hands pinching at the same time                                | `Two-hand ✓`     |
| **Thumb-pinky**    | Thumb tip touching the little-finger tip (used by Filter Lab later) | `thumb-pinky`    |
| (seen, no gesture) | Any other hand shape                                                | `hand`           |
| (just lost)        | The hand left the picture less than 0.15 s ago                      | `lost…`          |
| (not seen)         | No hand                                                             | `—`              |

Tips:

- Gestures need a brief moment (≈ 0.06 s) to register and ≈ 0.08 s to let go, so quick flickers
  don't trigger anything.
- Keep the hand side-on or palm-on to the camera; a hand seen edge-on is harder to read.
- A fist never counts as a pinch, so making a fist won't place blocks.

---

## 3. Keyboard shortcuts (all experiences)

| Key                        | Does                                                                           |
| -------------------------- | ------------------------------------------------------------------------------ |
| **1 – 7**                  | Switch experience (see the table at the top)                                   |
| **Ctrl+Z**                 | Undo (each experience has its own undo history)                                |
| **Ctrl+Shift+Z**           | Redo                                                                           |
| **C**                      | Clear the current experience (undoable; nothing in the Panel; Strings: settle) |
| **R**                      | Reset view / position of the current experience (Strings: settle the threads)  |
| **X**                      | Switch tool: Build ↔ Erase (Voxel) · Pen ↔ Eraser (Air Draw)                   |
| **Q / E**                  | Voxel Builder: depth layer − / +                                               |
| **L**                      | Voxel Builder: Depth Lock on / off                                             |
| **`** (backtick)           | Debug panel (left of the 1 key)                                                |
| **Esc**                    | Close panels and drop whatever a hand is holding                               |
| H, ← / →, [ / ], D, Delete | Reserved for later phases (Help, Filter Lab, 3D Object Lab)                    |

Switching experiences keeps what you made in each one, including its undo history. Anything a
hand is holding at that moment is let go first.

---

## 4. Voxel Builder (key 1)

Build block structures in the air. Every block snaps to a 3D grid.

### What you see

- A **faint grid**: the **active depth layer**, where new blocks go.
- A **ghost block** (see-through) at your right index fingertip: exactly where a block will go if
  you pinch now. In Erase mode it turns red over the block that would be removed.
- The structure sits at a gentle **3/4 angle** so you can see the tops and sides of blocks.

### Building

| Do this                                                                     | Result                                                                                                                |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Move your **right index finger**                                            | The ghost block follows it                                                                                            |
| **Pinch** and let go without moving                                         | Places **one** block, exactly where the ghost was                                                                     |
| **Pinch, hold, and move**                                                   | Draws a **line** of blocks with no gaps; let go to finish. The line stays on the plane it started on (good for walls) |
| Point at a **block's face** (the ghost appears on it) and **pinch**         | Adds a block **on that face**; works on all six sides                                                                 |
| **Pinch a block's face, hold still, then pull your hand toward the camera** | **Push / pull**: a ghost column grows out of the face; let go to place it (up to 16 blocks)                           |

Push / pull notes:

- On a face turned away from you, **push** away instead of pulling.
- How many blocks a given pull gives isn't tuned on real hands yet. Please say whether it feels
  too sensitive or too slow.
- A pinch either paints a line or pushes / pulls, whichever you do first.

**Which wins, the grid or a block?** Whichever is nearer to you along your finger's line. To build
onto a block behind the grid, move the layer back (see below).

### Depth: choosing the layer

New blocks go on the **active layer** (the faint grid). The tool panel shows it as
`−3 −2 −1 [0] +1 +2 +3`. **+** is toward the camera, **−** away. Layers run from −16 to +15.

| Do this                                      | Result                                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| **E** or the **+Z** button                   | One layer toward the camera                                                            |
| **Q** or the **−Z** button                   | One layer away                                                                         |
| **Left-hand pinch, hold, move it up / down** | Turns the layer like a dial: one layer per 6% of the picture height (a few cm); up = + |
| **L** or the **Depth Lock** button           | Depth Lock on / off (**on** by default)                                                |

- **Depth Lock on:** the layer only changes when you ask (keys, buttons, left-hand dial). Use
  this; it prevents accidental depth changes.
- **Depth Lock off (experimental):** moving your right hand closer to or further from the camera
  changes the layer. It's less precise.
- Building on a **block's face** doesn't need the layer; it's the easiest way to build in depth.

### Tools, colours and materials (tool panel)

| Tool                  | Pinch                         | Pinch + move                | Pinch a face + pull                        |
| --------------------- | ----------------------------- | --------------------------- | ------------------------------------------ |
| **Build** (default)   | Place a block                 | Line of blocks              | Column of blocks out of the face           |
| **Erase** (X toggles) | Remove the block you point at | Remove blocks along the way | Remove a column going into the structure   |
| **Paint**             | Recolour the block            | Recolour along the way      | Recolour a column going into the structure |

- **Colours:** 8 swatches (Turquoise is the default, then Magenta, Lime, Amber, Coral, Violet,
  Blue, White). New blocks and Paint use the selected one.
- **Materials:** **Solid**, **Glass** (see-through) and **Glow**.
- The panel shows how many blocks there are.

### Moving and turning the whole structure

**Move, resize and twist it with both hands (flat, in the screen's plane):**

1. **Pinch with both hands.** The status bar shows `Two-hand ✓` and "Moving the structure".
2. **Move both hands**: it follows. **Pull them apart**: bigger. **Push them together**: smaller.
   **Tilt the line between your hands** like a steering wheel: it twists.
3. **Let go of either pinch** to drop it. It stays where you left it.

- Each pinch stays glued to the spot it grabbed, and the structure doesn't jump when you grab.
- Size is limited to 0.3× – 3× of normal.
- If one hand leaves the picture mid-grab, the structure **holds still** ("Hand lost — the
  structure holds still until it is back") and carries on from there when the hand returns.
- Hands very close together (under ≈ 0.15 of the picture height apart) don't resize, and twisting
  fades out as they meet, so crossing your hands doesn't flip the structure.
- Started a single-hand pinch by mistake? If the second hand pinches within 0.15 s, the first
  hand's block is taken back (it was the start of the grab).

**Turn it in 3D with a fist (spin it round, tip it over):**

1. **Make a fist** with either hand and **hold it still for a moment** (≈ 0.15 s).
2. **Move the fist:**

| Move your fist                | The structure                         |
| ----------------------------- | ------------------------------------- |
| **Right / left**              | Spins so its front turns right / left |
| **Down**                      | Tips forward: you see its **top**     |
| **Up**                        | Tips back: you see its **bottom**     |
| **Back to where you started** | Returns to how it was                 |

3. **Open your hand** to stop. The status bar shows "Turning the structure" while it turns.

- It turns around the **middle of your blocks**, so the structure stays in place.
- Moving the fist across the **whole picture width** is about **one full turn**; about **half the
  picture height** is a quarter turn.
- The first small movement (3% of the picture height, ≈ 22 px) is ignored, and brief fists do
  nothing. This stops accidental turns. A relaxed hand that looks like a fist never stops your
  other hand from building.
- A hand that leaves the picture freezes the turn, the same as with two hands.

### Undo, clear and reset

- **Ctrl+Z / Undo:** each line, block, push / pull, erase, paint, two-hand move, fist turn and
  Reset is **one step**.
- **C / Clear:** removes every block (one undoable step).
- **R / Reset:** puts the structure back to its starting position, size and 3/4 angle. Undoable,
  so Ctrl+Z brings your view back.
- Pressing Undo in the middle of a line or grab finishes it first, then undoes it.

### Status messages

| Message                                                        | Meaning                              |
| -------------------------------------------------------------- | ------------------------------------ |
| Build — pinch to place, hold and move to paint · layer 0       | Ready; shows the active layer        |
| Building / Erasing / Painting — release to finish              | A pinch stroke is in progress        |
| Extruding N — push / pull, release to place                    | Push / pull: N blocks will be placed |
| Depth layer +2 — move your left hand up / down                 | The left-hand depth dial is active   |
| Moving the structure — let go of both pinches to drop it       | Two-hand grab                        |
| Turning the structure — move your fist; open your hand to stop | Fist turn                            |
| Hand lost — the structure holds still until it is back         | A hand left mid-grab                 |

---

## 5. Spatial Panel (key 2)

A picture floating in the air that you hold between your hands, like holding up a photo or a
tablet.

### What you see

- A picture in the middle, with **rounded corners** and a **glowing turquoise rim**.
- Two small **grab handles**, one on the middle of the left edge and one on the right edge:
  - **dim:** no hand near;
  - **brighter:** a hand is over that half of the panel (in reach);
  - **bright white:** both hands are holding it.

### Grabbing, moving, resizing and rotating

1. Put **both hands on the panel**: over the picture, or just outside its edge (≈ 60 px). The
   handles brighten and the status bar says "Both hands on the panel — pinch to grab it".
2. **Pinch with both hands.** The status bar says "Holding the panel".
3. While holding:
   - **move both hands**: it follows;
   - **pull them apart**: bigger; **push them together**: smaller;
   - **tilt the line between your hands** like a steering wheel: it rotates.
4. **Let go of either pinch** to drop it. It stays where you left it.

- Each pinch stays glued to the spot it grabbed, and the panel doesn't jump when you grab it.
- Size is limited to 0.3× – 3× of its normal size.
- A two-hand pinch **away from the panel** does nothing ("Pinch on the panel (or its glowing
  edges) to grab it").
- A **one-hand pinch** does nothing here; the panel always needs both hands.
- If one hand leaves the picture mid-grab, the panel **holds still** and carries on when the hand
  returns.
- Hands very close together don't resize, and rotating fades out as they meet, so crossing your
  hands doesn't flip it. This works the same as the Voxel Builder's two-hand grab.

### What it shows (tool panel)

| Button                                          | Shows                                                                                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Aurora** (default), **Sunset**, **Synthwave** | Bundled sample pictures                                                                                                |
| **Animated**                                    | A slowly flowing colour pattern                                                                                        |
| **Live camera**                                 | Your camera, live, mirrored like the main view (needs the camera on)                                                   |
| **Take a camera snapshot**                      | Freezes the current camera picture onto the panel; press **Take another snapshot** for a new one (needs the camera on) |
| **Open your own picture…**                      | Any picture file from your computer. It never leaves your computer. The button then shows its name                     |
| **Reset panel** (or **R**)                      | Back to the middle, normal size, straight                                                                              |

- The panel takes the **shape of what it shows**: wide pictures are wide, portrait pictures stand
  tall. The longer side stays the same size.
- **Live camera** and **Take a camera snapshot** are greyed out until the camera is on.
- Changing what it shows is **not** an undo step; moves and Reset are.

### Undo and reset

- **Ctrl+Z / Undo:** undoes a whole grab (move + resize + rotate) in one step.
- **R / Reset:** puts the panel back in the middle, normal size, straight. Undoable, so Ctrl+Z brings
  it back to where you had it.
- **C / Clear** does nothing in the Panel.
- Pressing Undo mid-grab finishes the grab first, then undoes it.

### Status messages

| Message                                                                | Meaning                                      |
| ---------------------------------------------------------------------- | -------------------------------------------- |
| Pinch the panel with both hands to grab it · R to reset                | Ready                                        |
| Both hands on the panel — pinch to grab it                             | Both hands are in reach                      |
| Holding the panel — move, spread or tilt your hands; let go to drop it | Held with both hands                         |
| Pinch on the panel (or its glowing edges) to grab it                   | Both hands pinched, but not on the panel     |
| Hand lost — the panel holds still until it is back                     | A hand left mid-grab                         |
| Start the camera first                                                 | A camera button was used with the camera off |

---

## 6. Air Draw (key 3)

Draw glowing lines in the air with your index fingertip.

### Drawing

| Do this                                                          | Result                            |
| ---------------------------------------------------------------- | --------------------------------- |
| **Point** with your right hand (index out, other fingers curled) | **Pen down**: the fingertip draws |
| Move the pointing finger                                         | Draws a smooth glowing line       |
| **Lower the finger** (curl it) or **open your hand**             | **Pen up**: the line is finished  |
| Point again                                                      | Starts a new line                 |

- Pinching does **not** draw; only pointing does.
- Holding still while pointing doesn't pile up points.
- A dot follows your fingertip, even when not drawing.
- While both hands pinch, nothing is drawn.

### Erasing

**With a left fist (quickest):**

1. **Make a fist with your left hand** and keep it closed. The status bar shows `Left: grab` and
   "Erasing — your right fingertip wipes lines away". A ring appears at your right fingertip.
2. **Move your right hand over lines.** Every line the fingertip touches disappears at once. The
   right hand doesn't need to point.
3. **Open the left hand** to stop. Everything erased during one fist is **one undo step**.
4. **To draw again, lower your right finger and point again.** Opening the fist with the finger
   already out never starts a stray line.

- The line under your fingertip at the moment you close the fist (usually the one you just drew)
  is **spared** until your fingertip moves off it. Come back over it to erase it.
- A fist that flickers out for up to 0.15 s still counts, so tracking blips don't split the erase.

**With the Eraser tool (no fist):**

1. Press **X** or click **Eraser** in the tool panel.
2. Before you point, the line under your fingertip is **highlighted red** (it's the one that will
   go). **Point** and move over lines to wipe them; lower the finger to stop (one undo step).
3. Press **X** again (or **Pen**) to go back to drawing.

### Pen options (tool panel)

- **Colours:** 8 neon colours (Cyan is the default, then Magenta, Lime, Yellow, Orange, Red, Violet,
  White).
- **Width:** **Thin**, **Medium** (default) and **Thick**.
- **Glow on / off:** the soft neon glow around lines.
- The panel shows how many lines there are.

### Undo, clear and resizing

- **Ctrl+Z:** undoes the last line or erase. **Ctrl+Shift+Z** redoes it.
- **C / Clear:** clears the drawing (undoable).
- Resizing the window keeps the lines glued to the same spots in the picture.

### Status messages

| Message                                                                      | Meaning               |
| ---------------------------------------------------------------------------- | --------------------- |
| Pen — point your right index finger to draw · left fist = eraser             | Ready                 |
| Drawing — lower your finger to lift the pen                                  | A line is being drawn |
| Erasing — your right fingertip wipes lines away; open your left hand to stop | Fist eraser           |
| Eraser — point at strokes to remove them (red = will go)                     | Eraser tool selected  |
| Both hands pinching — nothing is drawn                                       | Two-hand pinch        |

---

## 7. Hand Strings (key 4)

Glowing sparks on every joint of your hands, joined by stretchy threads that sag and wobble as you
move. There's nothing to grab: just move your hands and play.

### What you see

- A **glowing spark on all 21 joints** of each hand. Fingertips are a little bigger.
- **Threads** between the sparks. They **hang down slightly and wobble** like elastic strings when
  you move, then settle.
- **Colours slowly drift** through the rainbow. Your two hands have different colours, and each
  finger is slightly different.
- **Move faster = brighter and bigger** sparks and threads.
- **Fingertip trails**: short glowing streaks that fade behind your fingertips.
- The app's usual hand skeleton, pinch rings and cursor rings are **hidden** here, because the
  strings draw your hands instead.

### Threads (tool panel)

| Button            | Draws                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Skeleton**      | Threads along the bones of each hand                                                                                     |
| **Web** (default) | Skeleton + a ring through the five fingertips of each hand + each fingertip to **the same fingertip on your other hand** |
| **Full mesh**     | Web + every fingertip to every other fingertip, including **every left fingertip to every right fingertip**              |

- The threads across hands only appear while **both hands** are in view.
- Switching style lets the threads start fresh (hanging at rest).

### Fingertip trails (tool panel)

- **Off**, **Short** (default, ≈ 0.3 s) or **Long** (≈ 0.75 s).

### Settle, and hands leaving

- **Settle the threads** (button, **R** or **C**): every thread stops wobbling and hangs at rest,
  and the trails are cleared.
- A hand that **leaves the picture fades out** (≈ 0.15 s), taking its threads with it. When it comes
  back its threads start at rest; they never fling in from somewhere.
- There's nothing to undo here, so **Ctrl+Z does nothing**.

### Things to try

- Pull your hands apart quickly: the cross-hand threads stretch, bow and wobble back.
- Weave your fingers past each other in **Full mesh** (a "cat's cradle").
- Wave a hand fast with **Long** trails.

### Status messages

| Message                                                               | Meaning                      |
| --------------------------------------------------------------------- | ---------------------------- |
| Show your hands to the camera                                         | No hand in view              |
| Bring your other hand in to link fingertips across                    | One hand in view             |
| Strings link your fingertips across both hands — move, stretch, weave | Both hands, Web or Full mesh |
| Move your hands — threads stretch along your fingers                  | Both hands, Skeleton         |

---

## 8. Experiences still to come (placeholders for now)

Each unbuilt experience currently shows a **spinning shape**. Point at it (your cursor ring turns
white) and **pinch to grab and drag it**; let go to drop it. This checks the hand controls work
before the real experience arrives. Planned controls (subject to change; this file will be updated
when each is built):

- **5 · Filter Lab (Phase 10):** a "magic lens" strip that filters the camera behind it (thermal,
  sketch, glitch…). Grab it with a two-hand pinch; thumb-pinky tap with the right hand for the next
  filter, the left hand for the previous one; ← / → or [ / ] also switch filters.
- **6 · Portal (Phase 10):** open a window into another world with a two-hand pinch; move,
  stretch and rotate it.
- **7 · 3D Object Lab (Phase 11):** hold an open palm for a spawn menu (cube, sphere, cylinder,
  plane, torus), point + pinch to select, pinch + drag to move, two hands to rotate / scale,
  D to duplicate, Delete to delete.

---

## 9. Debug panel and recordings

Press **`** (backtick) or click **Debug**.

- **What it shows:** frames per second, hand-tracking speed, each hand's side, confidence and
  gestures, the cursor, and what each hand is holding.
- **Smoothing:** Off / Smooth / Smooth + predict (default). Compare how steady versus how laggy the
  hands feel.
- **● Record → ■ Stop & save:** records your hand movements (not video) and downloads a `.json`
  file. Send it over when something feels wrong, so it can be replayed and tuned on your real
  hands. Say what you were trying to do.
- **▶ Play fixture…:** plays a recording back in the app (**■ Stop playback** to end).
- **Leak check:** switches through all experiences 10 times and checks memory stays flat.

---

## 10. Troubleshooting

| Problem                                       | Try                                                                                                                         |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Nothing reacts                                | Look at the status bar: is the hand shown (`Right: …`)? If it says `—`, the hand isn't seen: more light, move back a little |
| A gesture isn't recognised                    | The status bar shows what it sees. Make the gesture more clearly (e.g. curl all four fingers for a fist)                    |
| Left and right are swapped                    | Keep your hands apart for a moment; it corrects itself. Report it with a recording if it persists                           |
| Blocks land away from where I aimed           | Watch the ghost block and pinch where it is; the block lands exactly there                                                  |
| The structure turned or moved by itself       | Ctrl+Z undoes it. Please record it (Debug → Record) so it can be fixed                                                      |
| Low FPS                                       | Close other heavy tabs; the laptop's graphics chip is shared with hand tracking                                             |
| The camera picture is black / "camera in use" | Close other apps using the camera, then click Start / Enable camera again                                                   |

---

## Changelog of controls

- **2026-09-27** — **Hand Strings built**: glowing joints, elastic threads (Skeleton / Web / Full
  mesh), fingertip trails (Off / Short / Long), faster = brighter, Settle (R / C).
- **2026-09-27** — **Spatial Panel built**: hold a picture with both hands (move, resize, rotate),
  glowing handles, sample pictures, animated pattern, live camera, camera snapshot, your own
  picture, Reset (undoable).
- **2026-09-27** — Voxel Builder: **fist + move turns the structure in 3D** (spin / tip). Two-hand
  grabs and **Reset view are now undoable**; a lost hand freezes a grab; hands crossing or nearly
  touching no longer flip or blow up the structure.
- **2026-09-26** — Air Draw: **left fist = eraser** while the right fingertip wipes; **point to
  draw** replaced pinch-to-draw.
- **2026-09-26** — Air Draw built (pen, colours, widths, glow, eraser tool, undo, clear).
- **2026-09-25** — Voxel Builder built (building, lines, face building, push / pull, depth layers,
  tools, colours, materials, two-hand move, reset).
