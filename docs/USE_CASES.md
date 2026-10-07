# GestureSpace — real-world use cases

_Written 2026-10-08, after Phase 12 (all seven experiences built, Help / Settings / autosave done)._

This document answers one question: **what can this project, or the ideas inside it, be used for in
the real world?** Some use cases need little more than what exists today. Others reuse only the
underlying concepts with a different product on top. Each one says plainly what would have to
change, how hard that is, and what could go wrong.

---

## Contents

1. [The short answer](#1-the-short-answer)
2. [What GestureSpace really is: the building blocks](#2-what-gesturespace-really-is-the-building-blocks)
3. [What the technology can and cannot do today](#3-what-the-technology-can-and-cannot-do-today)
4. [Use cases, area by area](#4-use-cases-area-by-area)
   - A. Health and care
   - B. Accessibility and inclusion
   - C. Education
   - D. Presenting, streaming and creating
   - E. Public spaces, retail and culture
   - F. Hands-busy work
   - G. Design and 3D
   - H. Home, play and fitness
   - I. Collaboration and robotics
   - J. Developer products
5. [Ideas that travel beyond hand tracking](#5-ideas-that-travel-beyond-hand-tracking)
6. [All use cases side by side](#6-all-use-cases-side-by-side)
7. [Capabilities worth adding (they unlock many use cases at once)](#7-capabilities-worth-adding)
8. [Risks and responsibilities](#8-risks-and-responsibilities)
9. [How to choose and test one](#9-how-to-choose-and-test-one)
10. [Glossary](#10-glossary)

---

## 1. The short answer

GestureSpace turns an ordinary webcam into a **hand controller**, inside a web page, with nothing
installed and nothing uploaded. Around that it has a set of hard-won pieces: steady tracking, a
reliable "which hand is which", gestures that don't fire by accident, two-hand grab / turn / resize,
undo, autosave, and a way to test all of it against real recorded hand movement.

That combination is useful wherever people **can't, shouldn't or don't want to touch** a screen,
keyboard or mouse, or where moving things **with your hands is clearer or more fun** than clicking.

**The five strongest directions** (reasons in section 6):

| #   | Use case                                                                    | Why it fits                                                                                                           |
| --- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | **Touchless kiosks and screens** (museums, shops, hospitals, receptions)    | Hygiene, wow factor; the main-user lock already ignores people behind the user; runs offline in a browser             |
| 2   | **Gesture presenter for video calls, teaching and streaming**               | Air Draw + Spatial Panel + Object Lab are already 70% of it; needs a virtual-camera / OBS output                      |
| 3   | **Home hand-exercise companion** (rehab, arthritis, older adults)           | Hand landmarks give finger angles; pinch / fist / spread are exactly the exercises; browser = no install for patients |
| 4   | **A web "gesture SDK" for other developers**                                | The perception pipeline is the hardest, most reusable part, and it is already tested on real recordings               |
| 5   | **Creator effects** (short videos, live streams, music / visual performers) | Hand Strings, Filter Lab and Portal are "reel-style" effects already; needs recording and a 9:16 layout               |

---

## 2. What GestureSpace really is: the building blocks

Think of the project as a kitchen, not a dish. The seven experiences are dishes, while the
building blocks below are the stove, knives and recipes that any new dish can use.

| Building block                           | What it does, in plain words                                                                                                                                                 | Where it lives                                     | Proof it works                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Local hand tracking in the browser**   | Finds 21 points on each hand from the webcam, on the user's own computer, in a background thread so the screen stays smooth                                                  | `vision/HandTracker.ts`, `workers/visionWorker.ts` | 60 FPS screen while tracking; ~13 hand updates/s with two hands on an Intel laptop GPU   |
| **Steadying + prediction**               | Removes shake from the points without making them lag, and guesses where the hand is between camera frames                                                                   | `vision/smoothing.ts`                              | Shake 1.41 → 0.70 px; lag 5.6 ms (it was ~27 ms before the fix)                          |
| **Main-user lock**                       | Picks one person's pair of hands and ignores bystanders                                                                                                                      | `vision/handPipeline.ts`                           | Synthetic crowd test: 4 hands seen, the right person's 2 used                            |
| **Which hand is which, by evidence**     | Decides left vs right from two "votes" (the tracker's label and a 3D thumb check), drops phantom duplicate hands, fixes mistakes mid-gesture without dropping what is held   | `vision/handPipeline.ts`                           | On the owner's real recordings: wrong-hand time 3.0 s / 5.8 s → 0, phantom time ~2 s → 0 |
| **Gesture vocabulary**                   | Pinch, fist, point, open palm, thumb-to-pinky, two-hand pinch; each with "start" and "end" thresholds and short timers so they don't flicker                                 | `gestures/`                                        | Unit tests on synthetic and real hand data                                               |
| **Hold-to-confirm (dwell)**              | An action only happens after a pose is held (0.6 s for the shape menu, 2 s before Air Draw starts a line), with a filling ring as feedback                                   | `SpawnMenu.ts`, `DrawMode.ts`                      | Stops accidental triggers (the "everything I look at gets clicked" problem)              |
| **Ownership of gestures ("capture")**    | Once a hand grabs something, that thing owns the hand until it is let go, the hand is lost, or a window opens                                                                | `spatial/CaptureManager.ts`                        | Mode switches, lost hands and Help windows never leave objects stuck                     |
| **Screen ↔ camera ↔ 3D mapping**         | Lines up the mirrored, cropped camera picture with drawings, 3D objects and lens effects at any window size                                                                  | `spatial/ViewportMapper.ts`, `CoordinateMapper.ts` | Filter lens matches the background within 0–1 / 255 brightness                           |
| **Steady aim**                           | Closing a pinch slides the fingertip; the cursor ignores that slide so things land where the preview showed                                                                  | `CoordinateMapper.ts` (`HandAim`)                  | On 104 real pinches: slide 1.5 → 0.4 blocks (median)                                     |
| **Two-hand grab with safety rails**      | Move / turn / resize something held between two hands; no jump at the start; freezes if a hand vanishes; speed limits block glitches; crossing hands don't flip it           | `modes/shared/TwoHandTransform.ts`                 | Owner's crossing recording: a 161° accidental flip → 1°                                  |
| **Fist-drag turn in 3D**                 | A fist moved sideways or up/down spins and tips an object; brief or accidental fists do nothing                                                                              | `TwoHandTransform.ts` (`FistOrbit`)                | Accidental fists in real recordings: 7–9° of turn → 0°                                   |
| **Relative depth**                       | Estimates "hand moved closer / further" from hand size, in steps                                                                                                             | `spatial/DepthEstimator.ts`                        | Works for push / pull; not a distance in centimetres                                     |
| **Undo / redo, autosave, files**         | Every edit is one undo step; work saves itself in the browser; scenes export / import as files                                                                               | `modes/shared/history.ts`, `state/persistence.ts`  | Round-trip tests for all seven experiences                                               |
| **Camera-aligned shaders**               | Effects that read the live camera behind an object: 13 filters, an "other world" window                                                                                      | `modes/filter/`, `modes/portal/`                   | ≤ 1.9 ms per frame on an integrated GPU                                                  |
| **Testing on recorded real hands**       | Record a person's hand movement once, replay it through the whole pipeline in tests forever; plus a synthetic hand generator and checks that fail if a fix is removed        | `tests/fixtures/`, `realHands.test.ts`             | 316 unit / integration tests + 16 browser tests                                          |
| **Lean, allocation-free real-time loop** | No throwaway memory in the per-frame code of the experiences, so no garbage-collection stutter; drawing capped at 60 fps so the tracker keeps its share of the graphics chip | `core/renderLoop.ts`, heap-sampling tests          | Hand Strings: 2–9 bytes / frame of garbage                                               |
| **Privacy by design**                    | Camera only after a click, a visible "Camera on", nothing recorded or uploaded, no analytics, strict content security policy                                                 | `core/camera.ts`, `vercel.json`                    | No backend exists at all                                                                 |

The seven experiences show those blocks in seven different shapes:

| Experience    | The pattern it demonstrates                                        |
| ------------- | ------------------------------------------------------------------ |
| Voxel Builder | Precise placement on a grid, layers, push / pull depth             |
| Spatial Panel | Holding a flat object (picture, document, video) between two hands |
| Air Draw      | Freehand drawing and annotation over the camera                    |
| Hand Strings  | Hands as a visual instrument (particles, springs, trails)          |
| Filter Lab    | A "magic lens": an effect shown only inside an area you hold       |
| Portal        | A window into another scene that follows your hands                |
| 3D Object Lab | Picking, moving, turning, resizing, grouping real 3D objects       |

---

## 3. What the technology can and cannot do today

Being honest here saves months later. A webcam is a cheap, flat, 2D sensor. These limits decide
which use cases are realistic.

**It does well:**

- Seeing **two hands** at arm's length, with clear gestures (pinch, fist, point, open hand).
- Being **steady**: a still hand barely moves on screen (well under 1 px of shake after smoothing).
- **Big, clear actions**: grab and move, turn, resize, draw, choose from a ring menu, switch with a
  thumb tap.
- Running on a **normal laptop** with an integrated graphics chip, in Chrome or Edge, with no install.
- Staying **private**: everything happens on the device.

**It does not do (yet), or does poorly:**

| Limit                                              | What it means in practice                                                                                                                                       | What would fix it                                                                     |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Depth is relative**                              | It knows "closer than a moment ago", not "37 cm away". Fine for push / pull; not for measuring real distance                                                    | A depth camera, or calibration with a known object                                    |
| **About 13–19 hand updates per second** on an iGPU | Fast flicks are smoothed and predicted; very fast motion (a punch, a quick swipe) can be missed                                                                 | A stronger GPU, one hand only, lower camera resolution                                |
| **Precision is a few pixels, not sub-millimetre**  | Great for buttons and objects sized like a coin on screen or bigger; poor for fine CAD work                                                                     | Snapping, zoom, "precision mode" that slows the cursor                                |
| **Light matters**                                  | Backlight (a bright window behind the user) and dim rooms reduce tracking                                                                                       | Setup guidance, exposure tips, the walkthrough checking light                         |
| **Distance matters**                               | Small, far hands (2–3 m away, large screens) are found less reliably                                                                                            | Higher resolution cameras, crop-and-zoom on the person, a wide-angle lens             |
| **Gloves are untested**                            | Surgical / work gloves may track worse, especially white or very dark gloves                                                                                    | Test with real gloves; possibly a custom-trained model                                |
| **Arm fatigue ("gorilla arm")**                    | Holding arms up is tiring after a few minutes                                                                                                                   | Short sessions, resting poses, gestures near the body, hybrid with mouse / voice      |
| **Accidental triggers ("Midas touch")**            | Every hand movement could be a command                                                                                                                          | Already addressed with dwell timers and two-step gestures; must be tuned per use case |
| **Bystanders can slip in**                         | The tracker looks for 2 hands. While one of the user's hands is out of view, someone else's hand can take the free place (an accepted trade-off for speed, D41) | Switch to 4 hands only when needed; the main-user lock then filters them              |
| **One user at a time**                             | Two people can't each control their own things yet                                                                                                              | The multi-user design parked in CLAUDE.md §7b                                         |
| **Browsers**                                       | Chrome / Edge are the main targets; Firefox / Safari are secondary and less tested                                                                              | Phase 13's browser matrix                                                             |
| **Not certified for anything safety-critical**     | Never the only control for a car, a machine or a medical device                                                                                                 | Different hardware, certification, a physical stop button                             |

---

## 4. Use cases, area by area

Each use case uses the same layout:

- **Who:** the people it serves.
- **Problem:** what goes wrong for them today.
- **How it would work:** what the person does, step by step.
- **What we reuse:** the GestureSpace pieces.
- **What has to change:** new work.
- **Size:** **S** = mostly configuration of what exists · **M** = a new experience or module ·
  **L** = new hardware, a backend, certification or a research project.
- **Risks and limits.**

---

### A. Health and care

#### A1. Home hand-exercise companion (rehab, arthritis, after surgery, older adults)

- **Who:** people recovering from a stroke, hand or wrist surgery, or living with arthritis; their
  physiotherapists / occupational therapists; older adults keeping their hands nimble.
- **Problem:** hand exercises are repetitive and boring, people stop doing them at home, and the
  therapist can't see whether they did them or how well.
- **How it would work:**
  1. The patient opens a link the therapist sent. No install, no account if the clinic prefers.
  2. A short warm-up checks light and shows "show your hand".
  3. Exercises become small games: pinch to pick up blocks (Voxel Builder), open and close the fist
     to blow glowing threads apart (Hand Strings), touch the thumb to each fingertip in turn,
     spread the hands to stretch a picture (Spatial Panel).
  4. The app counts repetitions and measures **range of motion**: how far each finger bends, how wide
     the hand opens, how long a pinch is held, how steady the hand is.
  5. At the end it shows progress over the weeks ("your index finger bends 12° further than on
     day 1"). The patient can choose to send a summary to the therapist.
- **What we reuse:** the 21 hand points and the 3D "world" points (finger angles come from them),
  the gesture detectors (`gestures/detectors.ts`), the steadiness measurement (the same jitter
  numbers used to tune smoothing), dwell timers, the walkthrough, the settings (left hand as main
  hand, sensitivity), autosave, the visual experiences as rewards.
- **What has to change:**
  - An "exercise" layer: a routine, counts, timers, rests, encouraging feedback.
  - A **measurement mode** that reports angles with honest error bars; checked against a
    goniometer (the therapist's angle ruler) on real patients.
  - Bigger, slower targets, and no time pressure for weak or shaky hands.
  - Optional sharing with the clinic: needs consent, a small backend, and health-data rules
    (GDPR in the EU, HIPAA in the US).
- **Size:** **M** for an exercise app that only counts and encourages · **L** if it claims to
  measure or treat (see risks).
- **Risks and limits:** in many countries an app that **diagnoses or treats** is a medical device
  and needs approval. "An exercise companion that counts your repetitions" usually is not, but get
  advice before making medical claims. Webcam angles have error, so trends over weeks matter more
  than single numbers. Patients with severe tremor or very low mobility need extra-forgiving
  settings.

#### A2. Touchless image viewing in sterile or clean spaces

- **Who:** surgeons and interventional radiologists in the operating room; dentists; lab staff
  wearing gloves; anyone who must not touch a keyboard.
- **Problem:** to look at a scan mid-procedure, the surgeon must step away, re-scrub, or ask an
  assistant to click for them ("no, the one before, zoom in, more…"). This has been studied for
  years with depth cameras; a webcam-and-browser version is far cheaper to try.
- **How it would work:** the scan appears as a **Spatial Panel**. Two hands pinch to zoom and pan;
  a thumb-to-pinky tap steps to the next image (the Filter Lab's switching gesture); a fist-drag
  turns a 3D reconstruction (the Object Lab's fist spin). A deliberate "wake" pose held for 2 s
  turns gesture control on, so normal hand movement during surgery does nothing.
- **What we reuse:** Spatial Panel, two-hand transform with its safety rails, thumb-pinky
  switching, fist orbit, dwell to arm, main-user lock (only the surgeon in front, not the team
  behind), offline running (hospital networks are locked down; this needs no internet at all).
- **What has to change:** a medical image viewer (DICOM format), contrast / brightness gestures,
  testing with surgical gloves, a mount and camera position that works over the table, voice as a
  backup, IT approval.
- **Size:** **L**.
- **Risks and limits:** viewing only, never controlling equipment. Gloves and harsh theatre
  lighting must be tested first. Medical-device rules may apply even to viewers in some settings.

#### A3. Measuring hand steadiness and movement for research

- **Who:** researchers studying tremor, motor learning, fatigue, or ergonomics.
- **Problem:** lab motion-capture systems are expensive and fixed in one room.
- **How it would work:** participants do tasks in front of a webcam at home; the app records the
  hand points (the existing recorder already saves them as files) and computes speed, smoothness
  and tremor frequency.
- **What we reuse:** the fixture recorder and replay tools, the jitter / lag analysis methods used
  to tune smoothing, the real-recording test harness.
- **What has to change:** consent forms, study protocols, raw (unsmoothed) data export, validation
  against a lab system.
- **Size:** **M** for a research tool · **L** for anything clinical.
- **Risks and limits:** webcam frame rate (13–30 per second) is too slow for fast tremor
  frequencies; it suits slow movement and posture better.

---

### B. Accessibility and inclusion

#### B1. Hands-free computer control with dwell clicking

- **Who:** people who can move their hands and arms but can't grip a mouse (arthritis, injuries,
  some neuromuscular conditions), and people in situations where a mouse isn't practical.
- **Problem:** a mouse and keyboard need fine grip and pressing.
- **How it would work:** the index fingertip moves a pointer; holding still for a moment (dwell)
  clicks, with the same filling ring Air Draw uses; a pinch drags; a fist scrolls. Sensitivity,
  hold times and the main hand are all settings.
- **What we reuse:** steady aim, smoothing with prediction, dwell + ring, settings panel,
  left-handed mode.
- **What has to change:** it must control the **whole computer**, not just one web page, which
  means a desktop app (for example Electron or a native helper) that moves the real system pointer.
  Strong presets for low-strength and tremor users.
- **Size:** **M** (desktop wrapper) · **S** if it only controls web apps built for it.
- **Risks and limits:** arm fatigue is real; for people with very limited arm movement, head or
  eye tracking is usually better. Must be co-designed with disabled users, not for them.

#### B2. Fingerspelling and handshape practice

- **Who:** people learning a sign language (for example the ASL or BSL alphabets), and teachers.
- **Problem:** learners can't tell whether their handshape is right without a teacher watching.
- **How it would work:** the app shows a letter; the learner makes the handshape; a classifier
  compares the 21 points with examples and says "close — curl your ring finger more", with a
  picture of the difference.
- **What we reuse:** landmarks, detectors' finger-curl measures, handedness logic (signs differ by
  hand), the recording tools to collect examples, the walkthrough flow.
- **What has to change:** a handshape classifier (even a simple "nearest example" one works for
  static letters), a dataset recorded with fluent signers, letters that move (some letters are
  movements, not shapes).
- **Size:** **M**.
- **Risks and limits:** full **sign language translation** is much harder: it needs the face, body,
  motion and grammar, and should not be promised. Involve Deaf signers and teachers from the start.

---

### C. Education

#### C1. 3D models you can hold in the classroom or an online class

- **Who:** teachers (science, geography, maths, anatomy), tutors, online course creators.
- **Problem:** explaining 3D things (molecules, the solar system, a heart, geometric solids) with a
  flat slide is hard; 3D software is fiddly to drive while talking.
- **How it would work:** the teacher appears on camera with a 3D model floating between their
  hands. Two hands turn and resize it; a fist spins it; pinching a part highlights and names it.
  The output goes into Zoom / Teams / Meet as a camera.
- **What we reuse:** 3D Object Lab (selection, turn / resize, fist spin, groups), Spatial Panel for
  diagrams, Air Draw for annotations, the cover-crop mapping so everything stays aligned on video.
- **What has to change:** importing real models (glTF files), part labels, a **virtual camera**
  output (or an OBS "browser source"), lesson presets.
- **Size:** **M**.
- **Risks and limits:** keep models light so the laptop doesn't stutter while also running the video
  call.

#### C2. Spatial maths and building with blocks

- **Who:** primary and middle-school pupils, maths teachers.
- **Problem:** volume, symmetry, nets of solids and "how many cubes" are hard to imagine on paper.
- **How it would work:** the Voxel Builder with lesson challenges: "build a 3 × 3 × 3 cube and
  count the hidden cubes", "make this shape symmetric", "build what you see from the front, side
  and top". The app checks the answer.
- **What we reuse:** Voxel Builder (grid, layers, Clear, undo, colours), autosave, export.
- **What has to change:** a challenge / checking layer, teacher-made tasks, a classroom mode with
  no settings to fiddle with, bigger blocks for small hands.
- **Size:** **S–M**.
- **Risks and limits:** classroom lighting and shared laptops vary; children under 13 need extra
  privacy care (this design already uploads nothing, which helps).

#### C3. Teaching how computer vision works

- **Who:** secondary-school and university computing teachers, coding clubs.
- **Problem:** computer vision and AI feel like magic; students rarely see what happens inside.
- **How it would work:** the Debug panel becomes a lesson: see the 21 points, the confidence
  score, the smoothing on / off switch, the left / right votes, gestures turning on and off. The
  Filter Lab shows edge detection, blur and pixelation live, inside a lens the student holds.
- **What we reuse:** Debug panel, smoothing switch, Filter Lab shaders, recorder, synthetic hands.
- **What has to change:** guided worksheets, an "explain" overlay, a mode that lets students change
  thresholds and see the effect.
- **Size:** **S**.
- **Risks and limits:** few; good first public project because it needs no claims.

---

### D. Presenting, streaming and creating

#### D1. The gesture presenter (slides, air annotations, live demos)

- **Who:** speakers in webinars and video calls, sales demos, YouTube explainers, teachers,
  weather-style presenters.
- **Problem:** presenting on camera means looking away to click, and pointing at a slide the
  audience sees from a different angle.
- **How it would work:** the presenter's camera picture with the slide floating beside them as a
  **Spatial Panel**. Thumb-to-pinky goes to the next slide; pointing draws a glowing circle around
  a number (Air Draw, with the 2 s hold so it never scribbles by accident); a fist wipes the
  drawing; two hands pull a chart bigger.
- **What we reuse:** Spatial Panel, Air Draw (including the fist eraser and the wait before
  drawing), thumb-pinky switching, Help overlay, settings.
- **What has to change:** loading PDF / slide images, a virtual camera or OBS output, a
  "presenter view" with notes only the speaker sees, a clicker fallback.
- **Size:** **M**.
- **Risks and limits:** it must never fail live; a keyboard fallback is essential. Arm fatigue over
  a 45-minute talk, so gestures should be occasional, not constant.

#### D2. Effects for short videos and live streams

- **Who:** creators on short-video platforms and streamers.
- **Problem:** hand-driven visual effects usually need a specific phone app or paid software.
- **How it would work:** pick an effect (glowing strings between fingers, a thermal lens strip, a
  portal opening between your hands), record a 15–60 s clip, download it.
- **What we reuse:** Hand Strings, Filter Lab, Portal, camera-aligned shaders, all at 60 FPS on a
  laptop.
- **What has to change:** recording to a video file (the browser can record a canvas), a vertical
  9:16 layout, more effect presets, a watermark option, performance tuning for phones.
- **Size:** **M**.
- **Risks and limits:** crowded market; the differentiator would be "free, in the browser,
  nothing uploaded".

#### D3. Live music and visuals (a webcam theremin / VJ tool)

- **Who:** musicians, DJs, VJs (visual performers), music teachers, installation artists.
- **Problem:** expressive controllers are expensive; a laptop camera is already on stage.
- **How it would work:** hand height sets pitch, hand spread sets volume or a filter, a pinch
  triggers a note or a sample, the other hand's fist holds a chord. Visuals (Hand Strings) react to
  the same movements. Notes go out to music software over MIDI.
- **What we reuse:** continuous hand measures (height, spread, depth, pinch value), gesture
  start / end events, Hand Strings, the low-lag smoothing + prediction.
- **What has to change:** sound (Web Audio) and MIDI output (Web MIDI), mapping presets, a
  "latency first" smoothing preset.
- **Size:** **M**.
- **Risks and limits:** 13–30 hand updates per second plus smoothing is fine for sweeping sounds,
  pads and visuals, but too slow for tight drum timing.

---

### E. Public spaces, retail and culture

#### E1. Touchless kiosks and digital signage

- **Who:** shops, malls, airports, hotel lobbies, hospital receptions, banks, real-estate offices.
- **Problem:** touchscreens get dirty and spread germs; many people dislike touching them;
  passers-by ignore static screens.
- **How it would work:** an **attract loop** shows Hand Strings reacting to anyone who raises a
  hand ("wave to start"). Then large tiles you point at and pinch to open; two hands to zoom a map
  or a floor plan; a fist-drag to spin a product.
- **What we reuse:** main-user lock (the person closest to the screen controls it, not the queue
  behind them), dwell + rings, two-hand transform, Help, Reduce motion, offline running.
- **What has to change:** a **kiosk mode** (full screen, auto-restart, idle reset after a minute,
  no settings), a content manager for the operator, large-screen layouts, testing at 1.5–2.5 m,
  privacy signage ("camera used for hand control only, nothing recorded"), optional anonymous
  counts (how many people interacted), never faces.
- **Size:** **M**.
- **Risks and limits:** distance and lighting in public spaces; vandal-proof camera mounting; clear
  instructions because no one reads them. Cameras in public raise privacy questions even when
  nothing is stored, so the sign and the design must make that obvious.

#### E2. Museums, galleries and exhibitions

- **Who:** museums, science centres, heritage sites, trade fairs.
- **Problem:** precious objects can't be handled; screens with menus feel dull.
- **How it would work:** turn a scanned artefact in your hands (Object Lab); hold a "lens" over a
  painting to see its X-ray or infrared layer (Filter Lab, with a fixed image instead of the
  camera); open a **Portal** into the place the object came from, 2,000 years ago.
- **What we reuse:** Filter Lab's lens over an image source (already supports pictures), Portal's
  render-target "other world", Object Lab, the attract-loop idea from E1.
- **What has to change:** content (3D scans, image layers, scenes), glTF import, kiosk mode,
  multilingual Help.
- **Size:** **M** per exhibit once kiosk mode exists.
- **Risks and limits:** content production costs more than the software; plan it with curators.

#### E3. Virtual try-on for rings, watches, bracelets and nail colours

- **Who:** jewellery and watch shops, nail-polish brands, online stores.
- **Problem:** customers can't try on jewellery online; returns are expensive.
- **How it would work:** the customer holds up a hand; a ring sits on the chosen finger, sized
  from the hand points, and turns with the finger; the colour or model switches with a thumb tap.
- **What we reuse:** the 3D hand points, handedness (rings on the right or left hand), the
  camera-aligned rendering that already keeps 3D objects glued to the video, smoothing.
- **What has to change:** finger-surface fitting and **occlusion** (the finger must hide the back
  of the ring), realistic metal / gem materials, ring-size estimation (needs calibration, for
  example a coin or card held in view), product catalogue connection.
- **Size:** **L** for convincing quality.
- **Risks and limits:** looking real is the whole product; a floating ring looks cheap. Size
  estimates from a webcam are approximate.

#### E4. Event and brand activations

- **Who:** event agencies, brands at festivals, product launches, trade-show booths.
- **Problem:** booths need something people want to try and share.
- **How it would work:** "open a portal into our world", "stretch the logo with your hands", a
  photo or 10-second clip at the end with the brand frame, sent to the visitor's phone by QR code.
- **What we reuse:** Portal, Hand Strings, Spatial Panel, Filter Lab.
- **What has to change:** branding templates, recording, kiosk mode, a QR hand-off (needs a small
  backend or local network), consent for any photo.
- **Size:** **S–M** per event once recording + kiosk mode exist.
- **Risks and limits:** photos of visitors are personal data; ask first and delete quickly.

---

### F. Hands-busy work

#### F1. Recipes, manuals and checklists you can flip with messy hands

- **Who:** home cooks and professional kitchens, car mechanics, bike workshops, lab technicians,
  craftspeople, cleanroom staff.
- **Problem:** hands are covered in flour, oil or chemicals, or are gloved; touching the screen
  dirties it or breaks hygiene rules.
- **How it would work:** a tablet or laptop shows the step; thumb-to-pinky moves to the next step,
  an open hand held still shows the step list, a pinch zooms a diagram, a timer starts with a
  thumb-up (a new gesture).
- **What we reuse:** thumb-pinky switching with its cooldown, open-palm hold with the ring, Spatial
  Panel for diagrams, main-user lock.
- **What has to change:** a step / checklist viewer, a few new gestures (thumb-up), a mode tuned for
  a camera placed low or to the side, testing with gloves and steam.
- **Size:** **S–M**.
- **Risks and limits:** kitchens are bright and steamy; workshop gloves may track worse; keep a
  voice or foot-pedal fallback in mind.

#### F2. Work instructions and assembly training

- **Who:** factories, repair centres, training departments.
- **Problem:** new workers need guidance at the workstation; paper instructions get dirty and
  outdated.
- **How it would work:** step-by-step 3D instructions that the worker turns with a fist-drag to see
  from any angle, and advances by gesture; optionally the camera checks that a hand reached the
  right bin before the next step.
- **What we reuse:** Object Lab (3D parts, groups, turning), Spatial Panel, gestures, undo.
- **What has to change:** an instruction authoring tool, CAD export to glTF, workstation camera
  placement, possibly "hand in zone" checks.
- **Size:** **M–L**.
- **Risks and limits:** never use it to judge or monitor workers' performance without clear
  agreements; for ergonomics research it needs consent and works only on slow, posture-level
  information.

---

### G. Design and 3D

#### G1. Quick 3D sketching and block-outs

- **Who:** hobby game designers, level designers making rough layouts, Minecraft-style builders,
  kids, makers planning a 3D print, architects sketching massing.
- **Problem:** professional 3D tools take weeks to learn; ideas are lost before they're modelled.
- **How it would work:** build a rough shape with blocks (Voxel Builder) or primitives (Object
  Lab) in a few minutes, then export it to the real tool (MagicaVoxel, Blender, a game engine, a
  slicer for 3D printing) for the precise work.
- **What we reuse:** Voxel Builder, Object Lab, undo, autosave, export.
- **What has to change:** export formats (`.vox`, `.obj`, `.glb`, `.stl`), snapping and symmetry
  tools, a "precision mode" that slows the cursor for small moves, bigger grids.
- **Size:** **M**.
- **Risks and limits:** a mouse is more precise; the honest pitch is "faster to start, fun, good
  for ideas", not "replaces CAD".

#### G2. Model reviews with clients

- **Who:** architects, product designers, interior designers, furniture makers.
- **Problem:** in a client call, turning a 3D model with a mouse while talking is clumsy, and
  screen-sharing a CAD program confuses clients.
- **How it would work:** the designer holds the model in front of the camera, turns it, opens a
  "portal" into a room view, draws a circle on the part being discussed.
- **What we reuse:** Object Lab, Portal (other world rendering), Air Draw, virtual camera (to add).
- **What has to change:** glTF import of big models, good lighting / materials, virtual camera.
- **Size:** **M**.
- **Risks and limits:** big architectural models may be too heavy for a laptop GPU alongside a
  video call; simplify them first.

---

### H. Home, play and fitness

#### H1. Couch control for media and smart TVs

- **Who:** anyone watching on a laptop or TV with a camera; cooks with a recipe video running.
- **Problem:** the remote is lost, or your hands are busy or dirty.
- **How it would work:** open palm held 1 s pauses; thumb-pinky skips; hand up / down changes
  volume while a fist holds; everything ignored unless the hand is raised deliberately.
- **What we reuse:** gestures, dwell, main-user lock (only the person in front controls), the
  lessons on accidental triggers.
- **What has to change:** connecting to the media player or the TV (a browser extension, or a TV
  app), sofa distance (2–3 m), dim-room tracking.
- **Size:** **M**.
- **Risks and limits:** dim living rooms and long distances are the hardest conditions for a
  webcam; accidental pauses annoy people quickly.

#### H2. Browser games and party games

- **Who:** casual players, families, schools, people without game controllers.
- **Problem:** many games need a controller; motion games often need special hardware.
- **How it would work:** short games played with hands: catch falling stars (pinch), build the
  tallest tower before time runs out (voxels), "Simon says" with gestures, a two-player version
  once multi-user exists.
- **What we reuse:** the whole input stack, particles and visuals, the renderer.
- **What has to change:** game design and scoring, sound, shorter rounds (fatigue), multi-user for
  party play.
- **Size:** **M** per game.
- **Risks and limits:** fast reaction games feel laggy at 13–19 updates per second; design slower,
  sweeping games.

#### H3. Movement and coordination exercises for older adults

- **Who:** older adults, care homes, day centres.
- **Problem:** keeping hands and minds active needs encouragement and variety.
- **How it would work:** seated, gentle games: touch the floating bubbles, copy a hand pose, draw a
  shape in the air, with big visuals and calm sounds; a carer sees who joined in.
- **What we reuse:** everything from A1 and H2, Reduce motion, large fonts.
- **What has to change:** very simple start (one button), seated camera framing, tremor-tolerant
  settings, no timing pressure.
- **Size:** **M**.
- **Risks and limits:** same as A1: don't promise medical benefits without evidence.

---

### I. Collaboration and robotics

#### I1. A shared spatial whiteboard for remote teams

- **Who:** remote teams, teachers and students, design reviews.
- **Problem:** online whiteboards are mouse-driven; it's hard to "show with your hands" over a
  call.
- **How it would work:** two people in different places see the same 3D scene or drawing; each one
  moves things with their own hands; the other sees it live.
- **What we reuse:** every edit is already a **command** (the undo system), which is the natural
  thing to send over the network; scene save / load already turns a scene into data.
- **What has to change:** real-time sync between browsers (WebRTC or a small server), conflict
  rules ("first to grab owns it", like the capture system), the multi-user design from CLAUDE.md
  §7b for two people at one camera.
- **Size:** **L**.
- **Risks and limits:** networking adds lag and complexity; start with "one presents, others watch".

#### I2. Gesture control for educational robots and drones

- **Who:** robotics clubs, STEM classrooms, hobbyists, researchers.
- **Problem:** joysticks and code are a barrier for beginners; "move it with your hand" is
  intuitive.
- **How it would work:** the two-hand grab moves a virtual target; a small robot arm or a rover
  follows it; a fist means "stop". The robot receives commands over USB (Web Serial) or Wi-Fi.
- **What we reuse:** the two-hand transform's **safety rails** are exactly what robot control
  needs: no jump when control starts, **freeze when a hand is lost**, speed limits that block a
  glitch from becoming a sudden movement.
- **What has to change:** a robot connection (Web Serial / WebSocket), mapping to robot limits, a
  physical emergency stop.
- **Size:** **M** for a classroom kit · **L** for anything bigger.
- **Risks and limits:** only for small, safe, educational robots. Never for heavy machinery or
  anything that can hurt someone; a webcam gesture is not a certified safety control.

---

### J. Developer products

#### J1. A web "gesture SDK" (a library other developers install)

- **Who:** web developers, agencies, startups, researchers building their own hand-controlled
  apps.
- **Problem:** getting raw hand points is easy (MediaPipe is free), but turning them into
  **reliable** interaction is weeks of hard work: shake, lag, left / right confusion, phantom
  hands, bystanders, accidental triggers, a hand vanishing mid-grab, two-hand flips. GestureSpace
  has already solved each of those and measured the fixes on real recordings.
- **How it would work:** `npm install gesturespace-core`; a few lines give a developer a stream of
  clean events: `pinchStart`, `pinchMove`, `grabEnd`, `twoHand { scale, rotation }`, a 3D
  cursor, and a "capture" system so their objects own gestures properly. Optional React hooks.
- **What we reuse:** `vision/`, `gestures/`, `spatial/`, `workers/`, `core/input.ts`, the test
  fixtures and synthetic hand generator (developers can test without a camera too).
- **What has to change:** a clean public API and docs, splitting the app from the engine (the
  architecture already separates them: experiences never touch the tracker), versioning, examples,
  a licence decision, possibly a "record your own gesture" feature.
- **Size:** **M**.
- **Risks and limits:** support burden; MediaPipe updates can change behaviour, so the real-data
  regression tests are part of the product.

#### J2. A privacy-first, on-device computer-vision template

- **Who:** teams building camera features for schools, hospitals, children's apps, or anyone who
  can't send video to a server.
- **Problem:** most camera AI sends video to the cloud, which raises privacy, cost and law
  problems.
- **How it would work:** the GestureSpace architecture as a starting template: the camera
  permission flow, the worker-based model runner, the "no per-frame garbage" render loop, the
  strict content security policy, self-hosted models, offline use. Swap the hand model for another
  on-device model (face, pose, objects).
- **What we reuse:** `core/camera.ts`, `workers/visionWorker.ts`, `vision/workerTracker.ts`,
  `core/renderLoop.ts`, `vercel.json`, the test approach.
- **What has to change:** generalise the worker protocol for other models; template docs.
- **Size:** **S–M**.
- **Risks and limits:** on-device models are smaller and less accurate than cloud ones; choose
  tasks that fit.

---

## 5. Ideas that travel beyond hand tracking

Some of the most valuable things in this project are not about hands at all. They are engineering
ideas that solve problems in any real-time or sensor-based product.

| Idea in GestureSpace                                                                               | Plain explanation                                                                                                                            | Where else it applies                                                                                              |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **One Euro smoothing + prediction** (`vision/smoothing.ts`)                                        | Smooth hard when the signal is still, lightly when it moves fast, then guess slightly ahead to hide the delay                                | Mouse / pen input, VR controllers, eye tracking, drone telemetry, wearable sensors, stock tickers on a dashboard   |
| **Evidence voting** (left / right decided by two weighted, fading votes)                           | Don't trust one noisy answer; add up evidence over time and only change your mind with a clear margin                                        | Any label that flickers: speaker identification, activity recognition, spam scores, sensor fault detection         |
| **Hysteresis + debounce + dwell** (gesture state machines)                                         | Different thresholds to start and to stop, a short wait before believing a change, a hold to confirm                                         | Thermostats, IoT buttons, voice "wake word" handling, alarms that shouldn't chatter, game input                    |
| **Capture / ownership of input** (`CaptureManager`)                                                | Whoever grabbed it keeps it until it is released; a window opening or a lost signal releases it cleanly                                      | Drag-and-drop UIs, multi-touch apps, multiplayer object locking, robot teleoperation                               |
| **Safety rails for continuous control** (rate limits, freeze on loss, re-anchor, no jump at start) | Limit how fast things can change, stop when the signal disappears, never jump when control begins                                            | Robotics, drones, camera gimbals, audio mixing faders, any remote control                                          |
| **Command-based undo + autosave + validated files**                                                | Every change is a reversible "command"; saving and loading are just more commands; files from outside are checked                            | Any editor, configuration tools, collaborative apps (commands are what you send over the network)                  |
| **Testing with recorded real-world data**                                                          | Record real sensor sessions once, replay them through the full system in every test run                                                      | Self-driving and robotics logs, IoT, finance back-testing, voice apps (recorded audio), any ML-in-the-loop product |
| **Sabotage checks** (break the fix on purpose; the test must fail)                                 | Proves a test really protects what it claims to protect                                                                                      | Any test suite (the formal name is mutation testing)                                                               |
| **Budgeting a shared GPU / CPU** (60 fps draw cap so the tracker keeps its share; worker threads)  | Two jobs on one chip compete; capping drawing at 60 fps took hand updates from 6 to 10 per second (looking for 2 hands, not 4, then gave 13) | Video calls with effects, games with physics, any app doing AI and graphics on a laptop                            |
| **Allocation-free hot loops + heap-sampling tests**                                                | Don't create throwaway memory 60 times a second; measure it automatically                                                                    | Games, audio apps, trading UIs, animation-heavy websites                                                           |
| **Cover-crop + mirror mapping** (`ViewportMapper`)                                                 | One source of truth for how the camera picture maps to the screen, used by every overlay and shader                                          | Video-call effects, AR try-on, document scanners, any overlay on live video                                        |
| **Main-user lock**                                                                                 | Decide who the "operator" is and keep following them; ignore everyone else                                                                   | Kiosks, smart TVs, fitness mirrors, any camera product in a shared space                                           |

---

## 6. All use cases side by side

**Fit today** = how much of the needed work already exists (★★★ = most of it). **Size** as defined
in section 4. **Who pays** = who would plausibly fund or buy it.

| Use case                             | Fit today | Size | Biggest risk                        | Who pays                                  |
| ------------------------------------ | --------- | ---- | ----------------------------------- | ----------------------------------------- |
| A1 Hand-exercise companion           | ★★☆       | M–L  | Medical claims / regulation         | Clinics, insurers, care providers         |
| A2 Touchless image viewing (sterile) | ★★☆       | L    | Gloves, approval, reliability       | Hospitals, imaging vendors                |
| A3 Movement research tool            | ★★☆       | M    | Frame rate, validation              | Universities, research grants             |
| B1 Hands-free computer control       | ★★☆       | M    | Fatigue; needs desktop control      | Users, accessibility programmes           |
| B2 Fingerspelling tutor              | ★★☆       | M    | Dataset quality, community trust    | Schools, learners, education grants       |
| C1 3D models for teaching            | ★★★       | M    | Laptop load during calls            | Teachers, course platforms, schools       |
| C2 Spatial maths with blocks         | ★★★       | S–M  | Classroom conditions                | Schools, edtech companies                 |
| C3 Teaching computer vision          | ★★★       | S    | Low                                 | Schools, coding clubs                     |
| D1 Gesture presenter                 | ★★★       | M    | Must never fail live                | Professionals, webinar platforms          |
| D2 Creator effects                   | ★★★       | M    | Crowded market                      | Creators (freemium)                       |
| D3 Music / visual performance        | ★★☆       | M    | Timing latency                      | Musicians, artists, venues                |
| E1 Touchless kiosks / signage        | ★★★       | M    | Distance, lighting, public privacy  | Retail, venues, signage companies         |
| E2 Museums and exhibitions           | ★★★       | M    | Content cost                        | Museums, exhibition designers             |
| E3 Jewellery / nail try-on           | ★☆☆       | L    | Realism, sizing                     | Jewellery and beauty brands               |
| E4 Event activations                 | ★★★       | S–M  | Visitor photo consent               | Brands, event agencies                    |
| F1 Messy-hands manuals / recipes     | ★★☆       | S–M  | Gloves, steam, lighting             | Kitchens, workshops, labs                 |
| F2 Work instructions / training      | ★★☆       | M–L  | Authoring effort, worker trust      | Manufacturers, training departments       |
| G1 Quick 3D sketching + export       | ★★★       | M    | Precision vs mouse                  | Hobbyists, education, maker spaces        |
| G2 Client model reviews              | ★★☆       | M    | Heavy models                        | Architecture / design studios             |
| H1 Couch media control               | ★★☆       | M    | Distance, dim rooms, false triggers | Users, TV / app makers                    |
| H2 Browser and party games           | ★★☆       | M    | Lag for fast games                  | Players (ads / freemium), schools         |
| H3 Older-adult activity games        | ★★☆       | M    | Health claims, usability            | Care homes, councils, families            |
| I1 Shared spatial whiteboard         | ★☆☆       | L    | Networking complexity               | Teams, education platforms                |
| I2 Robot / drone teaching            | ★★☆       | M–L  | Physical safety                     | Schools, robotics kit makers              |
| J1 Gesture SDK                       | ★★★       | M    | Support, API stability              | Developers, agencies (open source + paid) |
| J2 On-device vision template         | ★★★       | S–M  | Model accuracy limits               | Teams with privacy needs                  |

**Why the top five in section 1 were chosen:** they score high on "fit today", need no
certification to start, can be tested with real users within weeks, and each one reuses a
different strength (kiosk = robustness in public; presenter = the experiences; exercise = hand
measurement; SDK = the perception pipeline; creator effects = the visuals and shaders).

---

## 7. Capabilities worth adding

These additions unlock several use cases at once, so they are worth more than any single feature.

| Capability                                       | What it is                                                                                       | Unlocks                       | Size |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------- | ---- |
| **Virtual camera / OBS output**                  | Show the composed picture as a camera in Zoom / Meet / Teams, or as an OBS browser source        | C1, D1, G2, E4                | S–M  |
| **Recording and export of clips**                | Record the canvas to a video file, with sound if wanted                                          | D2, E4, A3, C1                | S    |
| **Kiosk mode**                                   | Full screen, idle reset, auto-restart, locked settings, attract loop, operator content updates   | E1, E2, E4, F1                | M    |
| **Model import (glTF) and export (vox/obj/glb)** | Bring real 3D content in; take creations out to other tools                                      | C1, E2, F2, G1, G2            | M    |
| **Custom gesture recorder**                      | Show a new pose a few times; the app learns it (a "nearest example" classifier on the 21 points) | B2, F1, H1, J1, A1            | M    |
| **Measurement mode**                             | Finger angles, hand opening, steadiness, repetition counts, with honest error ranges             | A1, A3, H3                    | M    |
| **Multi-user**                                   | Two or more people each with their own hands (design in CLAUDE.md §7b)                           | H2, I1, E1 (families), C1     | L    |
| **Desktop wrapper**                              | Control the whole computer, not just a web page                                                  | B1, H1                        | M    |
| **Output to devices (MIDI, Web Serial)**         | Send gestures to music software and small robots                                                 | D3, I2                        | S–M  |
| **Voice + gesture (the optional AI layer)**      | "Make a red sphere" by voice, then place it with your hand (Phase 14, only if asked)             | C1, G1, F1, B1                | M–L  |
| **Phone and tablet support**                     | Lighter models and layouts for mobile browsers                                                   | D2, F1, H2                    | M    |
| **Distance + lighting helpers**                  | The walkthrough checks light and distance and says "move closer" / "light behind you"            | Every public or home use case | S    |

---

## 8. Risks and responsibilities

**Privacy.** The current design is a strong foundation: camera only after a click, a visible
"Camera on", nothing stored or uploaded. Keep it that way by default. If any product needs to
store or send data (therapist summaries, kiosk counts, visitor photos):

- Ask clearly and specifically; let people say no and still use it.
- Store the least possible (hand-point summaries, not video).
- Delete it on a schedule.
- Check local law: GDPR in the EU and UK, HIPAA for US health data, and rules for children's data.
  In some places, body measurements used to identify people count as biometric data; hand
  control does not identify anyone, so keep it that way and never add face recognition quietly.

**Health and safety claims.** Anything that diagnoses, measures for treatment or treats a
condition may be a regulated medical device. Start with "exercise companion" or "research tool"
language and get regulatory advice before saying more. Never use webcam gestures as the only
control of machines, vehicles or medical equipment.

**Fairness.** Hand-tracking models can work differently across skin tones, hand sizes, ages,
jewellery, tattoos, missing fingers and lighting. Before any public launch, test with a varied
group of people and publish what was found. The real-recording test harness makes this
measurable: record diverse volunteers (with consent) and add their files to the regression tests.

**Comfort.** Arms get tired. Design for short interactions, resting poses, gestures near the body,
and always a non-gesture fallback (keyboard, touch, voice).

**Accessibility.** Gesture control helps some disabled people and excludes others. Always keep
other ways to do the same thing, and design with disabled users.

**Public spaces.** People may not want to be "seen" by a camera even if nothing is recorded. Use
clear signs, point cameras only where the user stands, and don't run them when no one is using the
screen.

---

## 9. How to choose and test one

A practical way to go from this list to a real product, with little wasted effort:

1. **Pick one use case and one kind of person.** For example "kiosk in a small museum", "a
   physiotherapist's patients with arthritis", or "teachers who teach online".
2. **Write the one-sentence promise.** "Visitors can turn a 3D artefact with their hands, no
   touching" — if the sentence needs "and" three times, it's too big.
3. **Build the smallest version on top of what exists.** Most use cases in sections 4C, 4D and 4E
   need only one or two capabilities from section 7.
4. **Watch five real people use it.** Don't explain; note where they hesitate, what they try
   first, when their arms tire, and what triggers by accident.
5. **Record their hand data** (with consent, Debug → Record) and add it to the regression tests,
   exactly like the owner's left / right recordings fixed handedness. This is the project's
   superpower: every real problem becomes a permanent test.
6. **Measure:** time to first success, accidental triggers per minute, completion rate, and "would
   you use it again?". Decide with those numbers.

**Suggested first three experiments** (each fits in a few weeks of work):

| Experiment                      | Build                                                                        | Success looks like                                                              |
| ------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Gesture presenter** (D1)      | Slides on the Spatial Panel, thumb-pinky next / previous, Air Draw, OBS out  | 5 presenters run a 10-minute talk; no accidental slide changes; they'd reuse it |
| **Touchless exhibit** (E1 / E2) | Kiosk mode + attract loop + one 3D object + one Filter Lab lens on a picture | 70% of passers-by who raise a hand manage to turn the object without help       |
| **Hand-exercise pilot** (A1)    | Three exercise games + repetition counts + weekly progress, no data upload   | Patients do the routine on most days for two weeks; therapist finds it useful   |

---

## 10. Glossary

| Term                     | Meaning                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| **Landmarks**            | The 21 points the tracker finds on each hand (wrist, knuckles, finger joints, fingertips)              |
| **MediaPipe**            | Google's free on-device machine-learning toolkit; GestureSpace uses its hand landmarker                |
| **iGPU**                 | The graphics chip built into a laptop's processor, shared between drawing and hand tracking            |
| **Inference**            | One run of the hand-finding model on one camera frame                                                  |
| **Smoothing / One Euro** | A method that steadies a shaky signal more when it is slow and less when it is fast                    |
| **Prediction**           | Guessing where the hand will be a few milliseconds ahead, so the screen doesn't trail behind the hand  |
| **Dwell**                | Holding still for a moment to confirm an action instead of clicking                                    |
| **Hysteresis**           | Using a different threshold to start and to stop something, so it doesn't flicker at the edge          |
| **Capture**              | When an object "owns" a hand's gesture until it is released                                            |
| **Main-user lock**       | Following one person's hands and ignoring people behind them                                           |
| **Shader**               | A small program that runs on the graphics chip for every pixel (used for filters and the portal)       |
| **glTF / OBJ / VOX**     | Common 3D file formats for exchanging models with other software                                       |
| **Virtual camera**       | Software that makes an app's picture appear as a webcam in video-call programs                         |
| **SDK**                  | A software development kit: a library and documentation other developers build on                      |
| **Medical device rules** | Laws (for example FDA rules in the US, MDR in the EU) for software that diagnoses or treats conditions |
