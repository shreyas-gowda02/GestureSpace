# GestureSpace — how to use every feature

The user guide: every control of every experience, kept up to date whenever a feature is built or
changed. If the app and this file disagree, the file is out of date. Please say so.

_Last updated: 2026-09-28, Air Draw: keep the finger out 2 s before a line starts._

| Key | Experience          | Status                                                                  |
| --- | ------------------- | ----------------------------------------------------------------------- |
| 1   | Voxel Builder       | ✅ Ready (building, depth layers, move / resize / twist, 3D fist turn)  |
| 2   | Spatial Panel       | ✅ Ready (hold, move, resize, rotate; pictures, camera, your own)       |
| 3   | Air Draw            | ✅ Ready (point + wait 2 s to draw, fist eraser)                        |
| 4   | Hand Strings        | ✅ Ready (glowing joints, elastic threads, fingertip trails, 3 styles)  |
| 5   | Filter Lab          | ✅ Ready (a lens strip with 13 camera filters; live / frozen / picture) |
| 6   | Portal / Dimensions | ✅ Ready (a portal into 4 worlds; opens out of a glowing line)          |
| 7   | 3D Object Lab       | ✅ Ready (make shapes, move / turn / resize / spin, copy, group, undo)  |

---

## 1. Getting started

1. Run `npm run dev` and open **http://localhost:5173** in Chrome or Edge.
2. Click **Enable camera** and allow camera access. Nothing leaves your computer: no uploads, no
   server.
3. Sit about **an arm's length** from the camera, in good light, so **both hands fit in the
   picture** with some room around them.
4. The picture works like a **mirror**: raise your right hand and it shows on the right.
5. The first time, a short **walkthrough** starts: show your right hand, pinch, then pinch with
   both hands and pull them apart (see section 11). You can skip it.
6. Pick an experience with the dock on the left, or press **1–7**.

**What's on screen**

- **Top bar:** the experience name, "Camera on", FPS, **Help** (H), **Debug** and **Settings**
  (⚙) — see section 11.
- **Dock (left):** the 7 experiences.
- **Tool panel (right):** the current experience's tools, **Your work** (Save / Load / Export /
  Import, section 12) and a **Gestures** list of its controls. Collapse it with the **›** button.
- **Status bar (bottom):** what the app sees each hand doing, e.g.
  `Right: pinch · Left: open · Two-hand ✓`, then what the experience is doing, e.g. "Building —
  release to finish". It also holds **Undo**, **Redo**, **Clear**, **Reset** and **Stop cam**.
- **Hand skeletons:** your right hand in turquoise, left in magenta, each with a side label and
  confidence %. A hand drawn faded means it was just lost; it's kept for 0.15 s in case it comes
  straight back.

**Your "main" hand is the right hand** unless you choose Left in Settings. It builds, draws and
picks; the other hand does the helper actions (depth dial, eraser fist).

**Only one person is tracked.** If someone walks behind you, the app keeps following your hands
(the closest, biggest pair).

---

## 2. The hand gestures

These are the building blocks every experience uses. Check the **status bar** to see what the app
thinks each hand is doing; that's the first thing to look at when something doesn't react.

| Gesture            | How to make it                                                 | Status bar shows |
| ------------------ | -------------------------------------------------------------- | ---------------- |
| **Open hand**      | Fingers spread, relaxed                                        | `open`           |
| **Pinch**          | Thumb tip and index fingertip touching                         | `pinch`          |
| **Point**          | Index finger straight out, the other three fingers curled      | `point`          |
| **Fist**           | All four fingers curled into the palm (the thumb can stay out) | `grab`           |
| **Two-hand ✓**     | Both hands pinching at the same time                           | `Two-hand ✓`     |
| **Thumb-pinky**    | Thumb tip touching the little-finger tip (Filter Lab, Portal)  | `thumb-pinky`    |
| (seen, no gesture) | Any other hand shape                                           | `hand`           |
| (just lost)        | The hand left the picture less than 0.15 s ago                 | `lost…`          |
| (not seen)         | No hand                                                        | `—`              |

Tips:

- Gestures need a brief moment (≈ 0.06 s) to register and ≈ 0.08 s to let go, so quick flickers
  don't trigger anything.
- Keep the hand side-on or palm-on to the camera; a hand seen edge-on is harder to read.
- A fist never counts as a pinch, so making a fist won't place blocks.

---

## 3. Keyboard shortcuts (all experiences)

| Key                    | Does                                                                           |
| ---------------------- | ------------------------------------------------------------------------------ |
| **1 – 7**              | Switch experience (see the table at the top)                                   |
| **Ctrl+Z**             | Undo (each experience has its own undo history)                                |
| **Ctrl+Shift+Z**       | Redo                                                                           |
| **C**                  | Clear the current experience (undoable; nothing in the Panel; Strings: settle) |
| **R**                  | Reset view / position of the current experience (Strings: settle the threads)  |
| **X**                  | Switch tool: Build ↔ Erase (Voxel) · Pen ↔ Eraser (Air Draw)                   |
| **Q / E**              | Voxel Builder: depth layer − / + · 3D Object Lab: farther / nearer             |
| **L**                  | Voxel Builder: Depth Lock on / off                                             |
| **`** (backtick)       | Debug panel (left of the 1 key)                                                |
| **Esc**                | Close windows and drop whatever a hand is holding (3D Object Lab: deselect)    |
| **H** or **?**         | Help: this experience's gestures and every key                                 |
| **← / →** or **[ / ]** | Filter Lab: previous / next filter · Portal: previous / next world             |
| **D**                  | 3D Object Lab: copy the selection                                              |
| **Delete / Backspace** | 3D Object Lab: delete the selection                                            |
| **G**                  | 3D Object Lab: group the selection (or ungroup a group)                        |

Switching experiences keeps what you made in each one, including its undo history. Anything a
hand is holding at that moment is let go first.

While a window (Help, Settings, the walkthrough) is open, only **Esc**, **H / ?** and **`** work,
so a key pressed in a window can't change your work behind it. Your hands don't act on the scene
then either.

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

| Do this                                                          | Result                                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Point** with your right hand (index out, other fingers curled) | A **ring fills** round your fingertip. Nothing is drawn yet                           |
| **Keep the finger out for 2 seconds** (until the ring is full)   | **Pen down**: the line starts wherever your fingertip is now                          |
| Move the pointing finger                                         | Draws a smooth glowing line                                                           |
| **Lower the finger** (curl it) or **open your hand**             | **Pen up**: the line is finished                                                      |
| Point again                                                      | The ring fills again; after 2 s a new line starts. **Every line waits** the 2 seconds |

- **You can move while the ring fills**: point, move your fingertip to where the line should
  begin, and wait for the ring. The status bar counts down: "the line starts in 2 s … 1 s".
- Lowering the finger before the ring is full draws **nothing**, and the next point waits the full
  2 seconds again. So does opening Help or Settings, losing the hand, or pressing Ctrl+Z meanwhile.
- The erasers **don't wait**: the left fist and the Eraser tool work at once.
- Pinching does **not** draw; only pointing does.
- Holding still while pointing doesn't pile up points.
- A dot follows your fingertip, even when not drawing.
- While both hands pinch, nothing is drawn.

### Erasing

**With a left fist (quickest):**

1. **Make a fist with your left hand** and keep it closed. The status bar shows `Left: grab` and
   "Erasing — your right fingertip wipes lines away". A white circle (the eraser) appears at your
   right fingertip.
2. **Move your right hand over lines.** Every line the fingertip touches disappears at once. The
   right hand doesn't need to point.
3. **Open the left hand** to stop. Everything erased during one fist is **one undo step**.
4. **To draw again, lower your right finger and point again** (and wait for the ring). Opening
   the fist with the finger already out never starts a stray line.

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

| Message                                                                      | Meaning                       |
| ---------------------------------------------------------------------------- | ----------------------------- |
| Pen — point your right index finger for 2 s to draw · left fist = eraser     | Ready                         |
| Keep your finger out — the line starts in 2 s (… 1 s)                        | Pointing; the ring is filling |
| Drawing — lower your finger to lift the pen                                  | A line is being drawn         |
| Erasing — your right fingertip wipes lines away; open your left hand to stop | Fist eraser                   |
| Eraser — point at strokes to remove them (red = will go) · X for the pen     | Eraser tool selected          |
| Both hands pinching — nothing is drawn                                       | Two-hand pinch                |

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

## 8. Filter Lab (key 5)

A "magic lens": a glowing strip you hold between your hands. **Inside it you see the camera picture
that is behind it, filtered** (thermal, sketch, glitch…); outside it, the normal view. It lines up
with the picture behind it exactly, however you move, turn or stretch it.

### Holding the lens

1. Put **both hands on the strip** (or just outside its edge). The handles on its short sides
   brighten.
2. **Pinch with both hands** to grab it. Then:
   - **move both hands**: it follows;
   - **pull them apart**: it gets **wider** (only wider; its height stays the same, like a strip);
   - **tilt the line between your hands**: it turns.
3. **Let go** of either pinch to leave it there.

- Width is limited to 0.35× – 3.5× of normal.
- A one-hand pinch does nothing; a two-hand pinch away from the lens doesn't grab it.
- If one hand leaves the picture mid-grab, the lens holds still until it's back.
- **Ctrl+Z** undoes a whole grab. **R** (or **Reset lens**) puts it back in the middle (undoable).
  **C** does nothing here.

### Changing the filter

| Do this                                                                       | Result          |
| ----------------------------------------------------------------------------- | --------------- |
| **Right hand: thumb tip touches little-finger tip**                           | Next filter     |
| **Left hand: thumb tip touches little-finger tip**                            | Previous filter |
| **→** or **]** / **←** or **[**                                               | Next / previous |
| **Next →** / **← Previous** buttons, or click a filter name in the tool panel | Pick one        |

The filter's name pops up above the lens for about 1.5 s. A tap only counts once every 0.4 s, so
one tap never skips two filters.

The 13 filters, in order: **None** · **Thermal** (heat-camera colours) · **Sketch** (pencil lines on
paper) · **Pixelate** (big pixels that stay put as the lens moves) · **Glitch** (jumping bands,
colour fringes, scanlines) · **Red channel** · **Edge** (neon outlines on black) · **Blur** ·
**Cartoon** (flat colours + ink lines) · **Rainbow** (colours shifting across the lens and over
time) · **Invert** · **RGB split** (red and blue pulled apart) · **Pop art** (four bold colours).
It starts on **Thermal**.

### What the lens filters (tool panel)

| Button                       | The lens shows                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Live** (default)           | The live camera behind the lens                                                                       |
| **Frozen**                   | The camera picture frozen at the moment you press it (press again for a new one; needs the camera on) |
| **Picture**                  | A sample picture (Aurora), filling the strip                                                          |
| **Filter your own picture…** | Any picture file from your computer (it never leaves your computer)                                   |

- With **Live** or **Frozen**, what you see in the lens is exactly the camera picture that's behind
  it, so moving the lens is like sliding a magic glass over the world.
- **Settings → Quality: Low** (Phase 12) will use a lighter Blur.

### Status messages

| Message                                                            | Meaning                            |
| ------------------------------------------------------------------ | ---------------------------------- |
| Thermal lens — thumb touches pinky (or ← / →) to change the filter | Ready (shows the current filter)   |
| Both hands on the lens — pinch to grab it                          | Both hands in reach                |
| Thermal — move, turn, spread to widen; let go to drop it           | Held                               |
| Pinch on the lens (or its glowing edges) to grab it                | Both hands pinched, but not on it  |
| Hand lost — the lens holds still until it is back                  | A hand left mid-grab               |
| Start the camera first                                             | Frozen pressed with the camera off |

---

## 9. Portal / Dimensions (key 6)

An oval window into another world, with a rim of flowing violet energy.

### Opening it

- The portal **starts shut, as a glowing line** in the middle ("Shut — pinch both ends of the
  glowing line to open it").
- Put your hands at **both ends of the line** and **pinch with both hands**: the portal **opens
  out of the line** (≈ 0.7 s).
- **R** (or **Reset portal**) puts it back in the middle **and shuts it again**, so you can open it
  again.

### Holding it

Once open, it's held like the Spatial Panel: **pinch with both hands** on it (or its rim), then
move, spread (bigger / smaller, 0.35× – 3×) or tilt your hands (turn it); let go to leave it.
**Ctrl+Z** undoes a whole grab. A lost hand freezes it until it's back.

### Worlds

| World                | What you see                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Nebula** (default) | Swirling purple and turquoise clouds with twinkling stars                                                                               |
| **Other World**      | A 3D world of floating crystals, a planet and stars. **Move the portal and your view of it swings**, like looking through a real window |
| **Inverted Reality** | The camera behind the portal, inverted into purple / cyan, with ripples                                                                 |
| **Picture**          | The Synthwave sample picture                                                                                                            |

Switch with the tool panel buttons, **← / →** (or **[ / ]**), or a **thumb-to-little-finger tap**
(right hand = next, left hand = previous).

### Status messages

| Message                                                              | Meaning                         |
| -------------------------------------------------------------------- | ------------------------------- |
| Pinch both ends of the glowing line to open a portal                 | Shut                            |
| Both hands on the line — pinch to open the portal                    | Both hands in reach of the line |
| Opening… Nebula                                                      | Opening                         |
| Nebula — move, spread or tilt your hands; let go to leave it there   | Held                            |
| Nebula — ← / → or thumb touches pinky for another world · R shuts it | Open, not held                  |
| Pinch on the portal (or its rim) to grab it                          | Both hands pinched, not on it   |
| Hand lost — the portal holds still until it is back                  | A hand left mid-grab            |

---

## 10. 3D Object Lab (key 7)

Make 3D shapes and arrange them in the air: pick them up, move them nearer or farther, turn,
resize and spin them, copy, group and delete them.

### What you see

- Shapes floating in front of the camera: **cube, sphere, cylinder, plane** (a thin square card)
  and **donut**. Each is about 3 units across (≈ a sixth of the picture's height) and starts turned
  a little, so its 3D shape shows.
- Point at a shape: it **glows a little** and a **faint white box** frames it (your cursor ring
  also turns white).
- **Selected** shapes glow more and get an **amber box**.
- New shapes **pop in**.

### Making shapes

Two ways:

- **Tool panel → Add a shape:** Cube / Sphere / Cylinder / Plane / Donut. It appears in the middle
  (or steps aside if something's already there) and is selected.
- **The shape menu:** hold your **right hand open and still** (fingers spread) for **0.6 s**. A
  ring fills round your fingertip (it shows after 0.2 s), then a **ring of the five shapes** opens
  there, drawn in the current colour.
  - **Point at a shape** in the ring (it grows, with its name underneath) and **pinch**. The new
    shape appears **under your fingertip, already held**: move it where you want it and let go.
  - A pinch **anywhere else** (the ✕ in the middle, or away from the shapes) closes the menu and
    makes nothing.
  - Left alone, it closes after **5 s**.
  - Moving the open hand while the ring fills starts the wait again, so just passing an open hand
    through doesn't open it.
  - After the menu closes, close your hand (or lower it) before it can open again.

### Selecting

| Do this                                                        | What happens                                                                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Point at a shape and pinch**                                 | It becomes the selection (other shapes are deselected) and you hold it. Already selected? The whole selection comes along |
| **Pinch empty space and let go** without moving                | Nothing is selected any more                                                                                              |
| **Add to selection: on** (tool panel), then pinch              | Shapes are **added** to the selection instead of replacing it                                                             |
| …with it on, **tap** (pinch, let go, no move) a selected shape | That shape is dropped from the selection                                                                                  |
| **Esc**                                                        | Nothing selected (and the shape menu closes)                                                                              |

A "tap" is a pinch that moves less than about 14 px (2% of the screen's height).

A shape in a **group** can't be picked on its own: pointing at any of its shapes picks the whole
group (see Groups below).

### Moving: pinch and drag

- **Pinch a shape and move your hand:** the selection follows, the exact spot you pinched staying
  **under your fingertip**. With several shapes selected, they all move together.
- **Nearer / farther:** while holding, **pull your hand toward the camera** to bring it nearer,
  **push it away** to send it farther. It moves in steps of 2 units: about an 8% change in how big
  your hand looks per step, with a small dead zone so an unsteady hand doesn't drift. This isn't
  tuned on real hands yet; say if it feels too sensitive or too slow.
- **Q / E** do the same by key: one step farther / nearer, while holding or with shapes selected
  (they stay at the same spot on screen and just get smaller / bigger).
- Shapes stay between **6 and 60 units** from the camera. The camera sits 20 units in front of the
  middle.
- Let go to drop. **Ctrl+Z** undoes the whole move.

### Turning and resizing with two hands

- **Pinch with both hands** (anywhere, or on the shape): the selection is held between your hands.
  - **Spread / close** your hands to make it **bigger / smaller**.
  - **Tilt the line between your hands** to **turn** it.
  - **Move both hands** to move it.
- It works like the Voxel Builder's two-hand grab: no jump when you start, and each pinch stays on
  the same spot. So pinching **on or around** the shape works best; hands far to one side move it
  a lot as it grows.
- Nothing selected? Both pinches on a shape select it first.
- Size limits: one grab can make it up to 5× bigger or 5× smaller, and a shape never goes below
  **0.2×** or above **6×** the size it was made at.
- A hand lost mid-grab freezes it until the hand is back. **Ctrl+Z** undoes the whole grab.

### Spinning in 3D: fist + drag

With shapes selected, **make a fist and move it**:

- **Left / right** spins them round.
- **Up / down** tips them toward / away from you.

They spin about their own middle. It starts once the fist has been held **0.15 s** and moved a
little (about 22 px), so a relaxed hand doesn't spin anything. Open your hand to stop. One undo
step.

### Copy, delete, groups, reset

| Control                                         | Does                                                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **D** or **Copy**                               | Copies the selection, 1 unit right and down; the copies become the selection                          |
| **Delete** / **Backspace** or **Delete** button | Deletes the selection                                                                                 |
| **G** or **Group** (2+ selected)                | Joins them into one **group**: it moves, turns and spins as one                                       |
| **G** (one group selected) or **Ungroup**       | Splits the group back into its shapes, which stay exactly where they are                              |
| **R** or **Reset turn & size**                  | Turns the selection back upright and to its made size, **where it is**. Nothing selected: every shape |
| **C** or **Clear**                              | Removes every shape                                                                                   |

Everything here is **one undo step** (Ctrl+Z / Ctrl+Shift+Z).

### Colour and look (tool panel)

- **Colour:** 8 colours (the same as the Voxel Builder).
- **Look:** **Solid**, **Glow** (lit by its own colour) or **Glass** (see-through).
- These set the colour and look of **new shapes**. With shapes selected, they **also change the
  selection** (one undo step: "Recolour" / "Change look").
- The panel also shows how many objects there are and how many are selected. A group counts as
  one.

### Status messages

| Message                                                                                    | Meaning                      |
| ------------------------------------------------------------------------------------------ | ---------------------------- |
| Hold your hand open and still for the shape menu — or pick a shape in the tool panel       | No shapes yet                |
| Point at a shape and pinch to pick it up · hold your hand open for the shape menu          | Shapes, none selected        |
| 1 shape selected — pinch to move · both hands turn / resize · fist spins · D copy · Delete | Something is selected        |
| Keep your hand open and still — the shape menu is opening…                                 | The ring is filling          |
| Shape menu — point at a shape and pinch to make it (pinch anywhere else to close)          | The menu is open             |
| Moving — push / pull your hand (or Q / E) for nearer / farther; let go to drop             | Holding shapes with one hand |
| Let go to deselect                                                                         | Pinching empty space         |
| Turning / resizing — let go of both pinches to drop                                        | Holding with both hands      |
| Hand lost — the selection holds still until it is back                                     | A hand left mid-grab         |
| Spinning in 3D — move your fist; open your hand to stop                                    | Fist spin                    |

---

## 11. Help, Settings and the walkthrough

### Help (H, ?, or the Help button)

A window with the **gestures of the experience you're in**, the basic hand shapes, and **every
keyboard shortcut**. **Esc** or ✕ closes it. **Show the walkthrough again** starts the walkthrough.

### Settings (⚙)

Every change applies at once and is **remembered in this browser**.

| Setting                         | What it does                                                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Main hand** Right / Left      | The hand that builds, draws, picks and opens the Object Lab's shape menu; the other one helps (depth dial, eraser fist) |
| **Swap left / right**           | For cameras that already mirror their picture: your right hand then shows as "Left". Turn this on to fix it             |
| **Mirror view**                 | The picture works like a mirror (on) or like someone else looking at you (off)                                          |
| **Show the hand skeleton**      | The turquoise / magenta hand drawings                                                                                   |
| **Smoothing** Quick ↔ Steady    | Steadier hands lag a little more behind your real hand                                                                  |
| **Pinch sensitivity**           | Left: your fingers must really touch; right: a pinch registers earlier (about 30% further apart). Middle = as tuned     |
| **Turning** ×0.5 – ×2           | How far things turn for a given two-hand tilt or fist move (1 = they turn exactly with your hands)                      |
| **Resizing** ×0.5 – ×2          | How much things grow or shrink when you spread or close your hands                                                      |
| **Camera**                      | Which camera to use (names appear once camera access is allowed)                                                        |
| **Camera resolution**           | 640×480 / 1280×720 / 1920×1080. The camera restarts to switch                                                           |
| **Hand tracking** 15 / 30 / 60  | How often hands are looked for per second. Lower = lighter on a slow laptop, a little less smooth                       |
| **Quality** Low / Medium / High | How sharp the 3D is drawn (Low = 1, Medium = 1.5, High = 2 screen pixels per point) and blur / portal detail            |
| **Reduce motion**               | No pop-in or opening animations (starts on if your computer is set to reduce motion)                                    |
| **Depth Lock on at start**      | Voxel Builder: Depth Lock is on (or off) when the experience first opens                                                |

**Reset all settings** puts every setting back to how it started.

### The walkthrough

It opens by itself **the first time the camera starts**. **Esc** or **Skip the walkthrough** closes
it and it won't open by itself again (Help or Settings → **Show the walkthrough again**).

1. **Welcome** — what the camera is for (only when opened by hand).
2. **Show your right hand** inside the dashed frame. It turns solid green once found. If the app
   only sees a **left** hand for 1.5 s, it asks whether that's really your right hand: **It's my
   right hand — swap left / right** turns on the Swap setting for you.
3. **Pinch** — "✓ Pinch detected".
4. **Both hands** — pinch with both and pull them apart (to 1.4× as far) — "✓ Two-hand stretch
   detected".
5. **You're ready** — **Start the Voxel Builder** or **Explore all experiences**.

Each check must hold for 0.4 s, then the next step comes. **Skip this step** moves on without it.

---

## 12. Your work: saved automatically

Every experience **saves itself in this browser**, 1 second after each change (and when you
switch experience or leave the page). Close the tab, come back later: your voxels, drawings,
shapes, the panel's picture and place, the lens and portal, the string style — they're all there.

What is never kept: **camera pictures**. A live camera or camera snapshot on the Panel, a frozen
frame in the Filter Lab, and pictures you opened yourself are left out (the Panel goes back to its
sample picture, the lens to the live camera).

**Your work** in the tool panel:

| Button      | Does                                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------- |
| **Save**    | Keeps an extra copy of this experience's work in this browser (one copy per experience; Save again replaces it) |
| **Load**    | Brings that copy back. **Ctrl+Z** undoes it                                                                     |
| **Export…** | Downloads this experience's work as a file (`gesturespace-<experience>-<date>.json`)                            |
| **Import…** | Opens such a file: switches to its experience and loads it. **Ctrl+Z** undoes it                                |

Saved work lives in this browser only: a private window forgets it, and another browser or
computer won't see it — **Export** it to keep or share a copy.

---

## 13. Debug panel and recordings

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

## 14. Troubleshooting

| Problem                                       | Try                                                                                                                         |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Nothing reacts                                | Look at the status bar: is the hand shown (`Right: …`)? If it says `—`, the hand isn't seen: more light, move back a little |
| A gesture isn't recognised                    | The status bar shows what it sees. Make the gesture more clearly (e.g. curl all four fingers for a fist)                    |
| Left and right are swapped                    | Keep your hands apart for a moment; it corrects itself. Always wrong? Settings → **Swap left / right**                      |
| Blocks land away from where I aimed           | Watch the ghost block and pinch where it is; the block lands exactly there                                                  |
| The structure turned or moved by itself       | Ctrl+Z undoes it. Please record it (Debug → Record) so it can be fixed                                                      |
| Low FPS                                       | Close other heavy tabs; Settings → Quality **Low** or Hand tracking **15 / s**. The graphics chip is shared with tracking   |
| Air Draw doesn't start a line                 | Keep your index finger out until the ring round it is full (2 s); lower it and point again if the ring isn't filling        |
| Pinches don't register (or too easily)        | Settings → **Pinch sensitivity** (right = earlier, left = fingers must touch)                                               |
| My work is gone                               | It's kept per browser: a private window or another browser starts empty. Use **Export** to keep a copy                      |
| The camera picture is black / "camera in use" | Close other apps using the camera, then click Start / Enable camera again                                                   |

---

## Changelog of controls

- **2026-09-28** — Air Draw: **keep the pointing finger out 2 seconds before a line starts** (a
  ring fills round the fingertip and the status bar counts down); lowering it earlier draws
  nothing. Every line waits; the erasers don't.
- **2026-09-28** — **Help** (H / ?) shows each experience's gestures and every key. **Settings**
  work and are remembered: main hand Right / Left, swap left / right, mirror, skeleton, smoothing,
  pinch / turning / resizing sensitivity, camera + resolution, tracking rate, quality, reduce
  motion, Depth Lock at start, reset. A **first-run walkthrough** (show your right hand, pinch, two
  hands). **Your work is saved automatically** per experience, plus Save / Load / Export / Import.
  While a window is open, only Esc, H / ? and ` work.
- **2026-09-28** — **3D Object Lab built**: make shapes from the tool panel or an open-hand ring
  menu; point + pinch to select and move (push / pull or Q / E for depth); both hands turn /
  resize; fist + drag spins; Add to selection; D copy, Delete / Backspace delete, G group /
  ungroup, R reset turn & size, C clear; colour and look; all undoable. New keys: **D**,
  **Delete / Backspace**, **G**; Q / E and Esc do more. No experiences are placeholders any more.
- **2026-09-28** — **Filter Lab built** (a lens strip over the camera, 13 filters, thumb-pinky /
  arrow keys / buttons, live / frozen / picture / your own picture, width-only stretch) and
  **Portal built** (opens out of a glowing line; Nebula, Other World, Inverted Reality, Picture;
  R shuts it). ← / → and [ / ] now switch filters and worlds.
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
