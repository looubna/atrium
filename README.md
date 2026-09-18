# Atrium — AI coaching in a 3D city

An interactive 3D city where each place is a situation you can practise in. The first
live module is **interview preparation**: the app researches your company and role to
predict your likely interview journey, a live voice interviewer runs each round, and you
get timestamped feedback, competency progress and targeted retries.

**Start here:** [ARCHITECTURE.md](ARCHITECTURE.md) · [local development](docs/setup.md) ·
[cloud setup](docs/cloud.md) · [data](docs/data.md) · [API](docs/api.md) ·
[agents & pipeline](docs/agents-and-pipeline.md) · [operations](docs/operations.md) ·
[security & privacy](docs/security-privacy.md)

The sections below describe the 3D experience and front-end decisions.

```bash
npm install
npm run dev             # http://localhost:5173
npm run dev:mobile      # same, but reachable from your phone on the LAN
npm run build
npm run preview:mobile  # production build + service worker, on the LAN
npm run typecheck
```

Requires Node 20+. A `.nvmrc` pins 22 for convenience; the toolchain is pinned
to Vite 6 so it also runs on Node 20.11.

---

## Running it on a phone

`npm run dev:mobile` prints a `Network:` URL (e.g. `http://192.168.0.101:5173`).
Open that on a phone on the same Wi-Fi.

It is a real installable web app: manifest, maskable icons, standalone display,
and a service worker that makes it work with no connection at all.

- **iOS** — Share → *Add to Home Screen*. It launches with no browser chrome.
- **Android** — Chrome offers *Install app*.

One caveat worth knowing: **service workers require a secure context.** Over a
plain `http://` LAN address the worker will not register, so you get the
standalone app but no offline. To exercise the full PWA on a device, either
port-forward `localhost` over USB (`chrome://inspect` on Android makes it a
secure origin), or serve the build over HTTPS via a tunnel. On desktop,
`npm run preview:mobile` then `http://localhost:4173` is already a secure
context and behaves exactly as a phone would.

Because the page runs edge-to-edge (`viewport-fit=cover`) the HUD pads itself
with `env(safe-area-inset-*)`, so nothing hides under a notch or a home
indicator; pull-to-refresh and double-tap zoom are disabled, which otherwise
fire constantly while orbiting.

---

## The experience

```
city overview  →  hover a place  →  select it  →  Enter  →  interior  →  zones
     ↑                                  │                       │
     └──────────── "City" / Esc ────────┴─── "Leave" / Esc ─────┘
```

- **City** — elevated overview of the whole district. Orbit, pan, zoom.
- **Hover** — the building lifts, an accent ring lights up on the pavement, its
  label brightens, and a compact card names it.
- **Select** — the camera arcs to a framed view of the building and a panel
  gives its identity, purpose and the practice areas it will host.
- **Enter** — the camera walks to the door, the screen dims, and the city is
  replaced by the interior. Only Meridian & Co. has one so far.
- **Interior** — four camera stations. Click a room or use the bottom bar.

Keyboard: `Esc` steps back out, `Enter` goes in.

---

## Information architecture

The city surfaces **places**, never skills. The four categories from the product
IA — Career, Academic, Social & Personal, General Practice — are colour only at
this level. Skills (Presentation, Negotiation, Thesis Defence, Think on Your
Feet …) are listed inside a location's panel as `practiceAreas`, which is where
the future skill picker will live.

Eleven locations, zoned deliberately: retail north, business centre, academic
west, practice east, leisure and residential south.

---

## Architecture

```
src/
  data/          locations.ts — the single source of truth for the city
  state/         useAppStore.ts — view machine + transition choreography
  lib/           cameraPose.ts — all camera pose maths; utils
  three/
    Experience   Canvas, scene routing (city XOR interior)
    camera/      CameraRig — owns the camera in both regimes
    city/        TalkVilleModel (the Blender-built city GLB); older procedural
                 fabric (grid, roads, block pads, street props) kept but unused
    buildings/   InteractiveLocation + LocationMarker; procedural exteriors unused
    interiors/   code-split interiors, camera stations, furniture kit
    environment/ sky shader, lighting, island ground
  components/
    ui/          Button, Icon
    navigation/  TopBar, ContextPanel, InteriorHud, Veil, Grade, Boot
```

### Decisions worth knowing

**The city is a Blender model.** Everything static — ground, bay, bridge,
roads, park, buildings, trees, cars — is `public/models/talkville.glb`, exported
from Blender with Draco compression (~1 MB). The Draco decoder is served from
`public/draco/` so the installed app still boots offline. Blender's procedural
window grids cannot travel in glTF, so `TalkVilleModel` rebuilds them in a small
shader patch keyed by material name (`TV_W_*`). Blender (x, y, z) arrives as
(x, z, -y).

**Data-driven locations.** A place is a row in `data/locations.ts`. The city
renders one `<InteractiveLocation>` per row, which supplies hover, selection,
label, ring and camera framing on top of the model. Adding a place is one step:
add the row with the position and footprint of a building in the model
(category, `practiceAreas`, `focus.offset`, `door`).

**Camera framing is derived, not authored.** `focus.offset` is only a
*direction*; the distance comes from the building's footprint and height. One
authored offset cannot serve both a bus shelter and a 52-unit tower — the value
that frames the cafe puts the camera inside the tower. Same for the entrance
pose, which is derived from `door`.

**One camera, two regimes.** `CameraRig` hands control between OrbitControls
(at rest) and a scripted arc (in transition) through a single `anim` ref, so the
two never fight — the usual failure when mixing orbit controls with
programmatic moves. Long moves arc upward; short ones stay flat. Crossing the
exterior/interior boundary is always a hard cut, hidden behind the veil.

**Interiors are separate scenes.** Only the city *or* one interior is mounted,
never both. Interiors are `React.lazy` chunks, preloaded the moment a location
is selected — so the overview stays cheap however detailed interiors become. An
interior declares its own lighting, its own outside view and its camera
stations in `interiors/poses.ts`. That is the whole contract.

**The island is deliberate.** A flat infinite ground puts the horizon at the
camera's eye level, which from an elevated overview is off the top of the
screen — the sky never appears and the world reads as a fogged slab. A bounded
plinth keeps the sky in frame and reads as a designed model of a district.

**Framing is solved, not authored.** No pose is a hard-coded vector. The city
shot, the per-building shot and the door approach are all solved against the
live viewport each time it changes, so rotating a phone re-frames instead of
cropping. Two things fall out of that: on a narrow screen the camera tilts
further overhead, because a flat disc viewed obliquely projects to a wide,
shallow ellipse that wastes a portrait frame; and a building's distance is
governed by its height on a wide screen and by its width on a narrow one.

**Responsive.** Verified on phone portrait (393x660 and 320x568), phone
landscape (734x343), tablet portrait, and live rotation between them — no page
overflow, no clipped controls, 60 fps throughout. The HUD sheds weight by BOTH
axes: a `short:` height variant exists alongside Tailwind's width breakpoints,
because a landscape phone is wide enough to pass `sm:` while being far too
short to carry the same chrome. Locations carry a `shortName` for cramped
viewports, the copy switches between click and tap wording from
`(pointer: coarse)`, and interiors may declare `posesNarrow` camera stations —
indoors a narrow lens sees almost nothing and there is no room to step back, so
the eye rises above the furniture and tilts down to reveal the plan.

**Performance.** Every repeated object — trees, lamps, benches, bins, cars,
window panes, spandrel bands, background massing — is one `Instances` group and
therefore one draw call. Pointer hits go through a single invisible proxy box
per location rather than the building's own geometry, which keeps hover stable
and raycasting to eleven targets. Near/far planes are retuned per context.
Measured 60 fps in the city and in the interior.

**No postprocessing library.** ACES tonemapping, soft shadows and a CSS
vignette/grain give the cinematic grade at no GPU cost. No shadcn CLI or Radix
either — the UI needs four primitives, written in the same idiom.

---

## Beyond the interview module

Other practice areas (sales, leadership, meetings, …) still use the prototype screens;
they plug into the same platform when built. Places without an interior show
*"Interior coming soon"* rather than a half-built room.
