# Dark motion alignment — 2026-11-19

Scope: user requests all desktop animation behaviors of asklionel.tech, across Dark's existing functional pages. Preserve deployed contracts, wallet/financial workflows, Dark identity, truthful counts and official token notice. Local 5206 only. No mobile additions or diagonal arrows.

Reference evidence: workspace work/lionel-motion-20261118/reference, captured at 1440 × 1000. Public client assets inspected only to measure behavior; original site bundles, personal assets, awards and analytics are not redistributed.

Motion thesis: a tunnel of unordered particles resolves through three sources, a rotating core, and three destinations; its camera settles into the existing hero. Navigation carries the page as a real plane through depth. Secondary feedback uses the reference's masks, decode text, brackets, wipe, and moving packets.

Measured timing: loading minimum 1.2 s; handover 0.5 s after ready, fade 0.6 s. Film 6.6 s; gather 1.2–3.4 s; sources 1.6–2.4 s; core 2.8–3.6 s; destinations 4.6–5.4 s; labels 1.9–2.5 s then out 5.9–6.5 s; hero reveals at 6.0 s. Title masks 900 ms, stagger 130 ms; support 620 ms. Label decode 650 ms at 40 ms updates. Shared durations 160/360/620/900 ms, ease (.16,1,.3,1).

Navigation: ordinary links 880 ms, retreat 220 ms, departure 220 ms, arrival 200 ms, approach 240 ms. Chapter transitions map Work → Explore (floor fold 1.61 s), About → Launch (card flip 1.65 s), Notes → Handbook (8 strips 1.47 s), Contact → OTC (wire routing 1.75 s), Play → Rebalance (rotating tiles), Home → Home (frame tunnel 1.8 s). Source words and company/award claims are replaced by Dark product content.

Global: four cursor corners (10 px, 6 px outside hovered target); progress ticks follow headings; theme wipe 900 ms; next-page packet 2.8 s / hover 1.1 s; link underline 360 ms; peer wordmarks dim to .25 at 620 ms; selected rows left-to-right wipe 360 ms; preview in 360 ms; image scan; SVG path drawing and routed packets; read-state indicator. Existing More menu uses the source menu reveal grammar at desktop size, not its mobile layout. The rotating awards mechanic becomes a Dark replay control without award claims.

Runtime budget: one bounded WebGL particle scene, 9000 source points with short trails, DPR capped at 2; CSS3D navigation exists only while moving. Preserve phase across wallet/config/theme/language updates. Pause/reduced motion, offscreen/hidden-tab suspension, deterministic cleanup, Escape/click skip and repeatable replay. All content remains available when animation or WebGL fails. No motion may submit or repeat a financial action.

Verification: compare same viewport and elapsed film checkpoints, actual hover/scroll/navigation, repeat/back/cancel, reduced motion, route form persistence, zero broadcasts. Document exact remaining differences instead of claiming an invented fidelity percentage.

## Implementation map

| Reference behavior | Dark implementation | Entry |
| --- | --- | --- |
| Fullscreen particle tunnel / readiness HUD | BootTunnel + film-scene GPU particles | Fresh document load |
| Four cinematic shots / 6.6 s camera spline | SignalCanvas + film-scene | First home visit, Replay |
| 3D projected node labels | film-scene projection + film-labels | During the film |
| Ordinary retreat / departure / arrival / approach | depth-scene slide | Header, internal text links, back/forward |
| Floor fold with six rails | depth-scene floor | Home → Explore |
| Scanned card flip | depth-scene flip | Explore → Launch |
| Eight staggered strips | depth-scene strips | Launch → Handbook |
| Camera routing between framed pages | depth-scene wire | Handbook → OTC |
| Rotating pipeline tiles | depth-scene tiles | OTC → Rebalance |
| Five depth frames | depth-scene tunnel | Rebalance → Home |
| Masks, decode, reveal, scroll rail, cursor corners | MotionReveals, ScrollRail, CursorBrackets | Across public routes |
| Theme wipe and menu reveal / exit | Frame + motion.css | Header |
| Row fill, artwork scan, preview entry | motion.css + Explore/Launch | Real token directory / uploaded image |
| Drawn paths, moving packets and core rotation | FlowDiagram | OTC, Agent OTC, Rebalance, Handbook |
| Read indicator | Learn + motion.css | Mark as read |
| Wordmark and next-heading fills / traveling packet | Home, NextChapter + motion.css | Homepage protocols / chapter endings |
| Rotating circular badge | ReplaySeal | Dark opening replay; no award claim |

## Comparison boundaries

The film clock starts at loading handover, not at the initial HTTP request. Fonts, module compilation and GPU warm-up can shift the recorded wall-time checkpoints. `film-timeline.json` in local review evidence reports both actual wall time and the scene clock; desktop-width captures use separate names from millisecond captures.

Dark content, deployed-chain disclosures, uploaded art and existing form semantics replace the portfolio's personal content. The official token notice adds its own document height. The award asset becomes a Dark replay control; the reference's mobile menu grammar is used only by the existing desktop More menu; game pipe motion becomes a chapter transition and explanatory process graphics. The portfolio game itself, personal photos, award identities, analytics and mobile layout are not shipped. NE diagonal arrow decorations are omitted under the user's explicit preference.

`#fff` is intentional solely for the difference-blended cursor brackets, whose displayed color depends on the surface under them. It is not a new page-surface palette. All diagrams are geometric process illustrations and are labelled as not live activity. Real addresses, prices, transaction amounts, signatures and input values are never scrambled.

## Lifecycle and snapshot contracts

Route cancellation owns the entire interval from readiness through lazy module loading and active motion. Escape, Pause, reduced-motion changes, resize and user skip restore the live page, inertness, focus and scroll. A canceled generation cannot restart when its old import resolves. Pending and active phases each have a bounded failsafe.

Outgoing snapshots freeze their current rendered animation state. Incoming snapshots use the final state of finite entrances so a destination thumbnail already contains its heading, copy and actions. Ambient animation retains its captured frame. Canvas pixels, inputs, selected values and checked states are preserved; every snapshot is inert.

Initialization failure or WebGL context loss explicitly removes film availability. Both Replay entries remain harmless and the settled page stays accessible. Theme, pause and replay events cannot restart a disposed renderer. In normal operation, menus and the replay seal sit above the settled hero; the opening hero uses elevated layering only during its film phase.

Pipe tiles use varied straight, elbow and T pieces with visible quarter-turns and inverse theme colors. Wire overview reveals its destination from 0.35 s. Flip, wire and tunnel portals have corner accents; tunnel portals carry real Dark chapter labels and show the incoming homepage throughout flight.
