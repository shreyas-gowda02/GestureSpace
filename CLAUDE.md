# CLAUDE.md

See [AGENTS.md](AGENTS.md) for architecture, folder map and data contracts. The full spec is
[GestureSpace_Build_Prompt.md](GestureSpace_Build_Prompt.md).

Non-negotiable rules (condensed):

- Modes consume `InteractionFrame` only — never MediaPipe, the camera, or the render loop.
- One camera stream, one `HandLandmarker`, one render loop, one `WebGLRenderer` — created via
  `src/app/bootstrap.ts`, StrictMode-safe, fully disposable.
- No high-frequency data in React/zustand state; status text ≤10 Hz.
- TS strict, no `any`; named landmark constants; all tunables in `src/config/tuning.ts`.
- No per-frame allocation in hot paths; dispose all Three.js resources.
- No new deps without justification; verify library APIs against installed types.
- Unit tests for pure logic in the same change.
- Lean files: no placeholders; group small cohesive modules (see AGENTS.md folder map).
- Phase gate: `npm run lint && npm run typecheck && npm run test && npm run build` green →
  commit `phase-N: <summary>` → stop and report in the §3 format.
