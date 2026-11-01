# ReLift3D local performance optimization

All work is local on `website-performance-optimization`, based on `main` at
`db6ecdea393ae410e85bbb019fc3ab2247f14ffb`. No pushes, merges, deployment,
or hosting changes were made. Original videos and scene data remain intact
in this checkout, including the local archive described below.
The supplied handoff was extracted outside the repository; its ZIP is now
archived in the Git-ignored `tmp/unused/` directory.

**2026-10-31 curation update:** The current page displays 13 synchronized groups
and 45 fallback/method/wipe video elements. Comparison rows now appear in this
order: lady-running, libby, motorbike, bmx-trees, spin. Crossing and car-shadow
were removed from the main page; their source videos, posters, and atlas files
remain intact. All 15 generated atlases and 64 original videos are still validated.
The performance measurements and browser coverage below describe the earlier
15-group version and have not been remeasured for this curation change.

**2026-11-01 cleanup:** 35 unused files (17.09 MB) were moved to
`tmp/unused/`, preserving their relative paths and contents. These include
crossing/car-shadow assets, six superseded video originals, two unused images,
the handoff ZIP and system/cache files. Active fallback clips and all nine
3D scenes remain in place. `tmp/unused/MOVED_FILES.json` records paths and
checksums; validation and media generation also resolve archived assets.
No media was deleted or re-encoded during this cleanup.

**2026-11-01 revised examples:** User-supplied `kangaroo_relift_tracks.mp4`
replaces the occlusion kangaroo result, and `swing-tire_relift_tracks.mp4`
replaces the tire-swing result. The other kangaroo example is unchanged.
The supplied files are retained byte-for-byte as the corresponding
`static/videos/more_*_ours.mp4` fallback sources. Their 1000×562 resolution
and aspect ratio are preserved; the paired inputs remain 960×540. Atlas cells
fit the larger panel, and the player crops each panel at its native dimensions.
Both revised clips retain the inputs' exact frame timestamps (100 and 84 frames
at 12 fps). Only these two atlases and their result posters were regenerated.
Their combined atlas size changes from 4.55 MB to 16.99 MB; full-duration SSIM
against the revised result sources is 0.982214 and 0.982804 at CRF 21.
Previous assets, the prior manifest, uploaded files and a checksum inventory
are preserved in `tmp/media-revisions/2026-11-01/`. The historical measurements
below predate this refresh and the later page layout edits.

**2026-11-01 example selection update:** More Results now shows six examples:
occlusion kangaroo, horsejump, schoolgirls, tire swing, motocross and camel.
The non-occlusion kangaroo's five assets are preserved in `tmp/unused/` and
recorded in its inventory. The older tire-swing source, synchronized pair and
poster were restored byte-for-byte from the backup; its revised versions remain
in `tmp/media-revisions/2026-11-01/swing-tire-revised-not-selected/`.
The revised occlusion kangaroo remains active at its native 1000×562 resolution.
The page now contains 12 active synchronized groups and 43 fallback/method/wipe
videos. This selection reduces the combined displayed More Results atlas size
from 26.58 MB to 19.24 MB; initial-load performance has not been remeasured.

**2026-11-01 viewer presentation:** The preceding website state was committed
locally as `ede9c96` before this adjustment. Cloud points now use CSS-pixel
sizes independent of renderer pixel density: background/default moving points
are 2.4 px, the larger moving-point presets are 4 px, and Spin uses 2.7/4.5 px.
These are 20% reductions (10% for Spin) against the observed DPR-1 preview.
Removing the previous extra DPR multiplier means a larger reduction compared
with the old DPR-2 appearance: 60%, or 55% for Spin. This calibration favors
consistent cloud-dot sizes across displays rather than preserving the former
high-density enlargement. Track-head sizes and trail styling remain unchanged.

Forest (the hiking scene) and Motocross now have 90% of their previous projected
scene scale, using a wider field of view while retaining camera positions:
39.559° → 43.561° and 12.786° → 14.193°, respectively. Other framing presets,
Running's follow camera, zoom-disabled controls, geometry and timing are retained.
Renderer density updates on display-density changes and resize, without resetting
the user's orbit. Rendering still stops while the viewer is offscreen or hidden.

Validation includes all nine scenes' exact trajectory buffers, a runtime harness
covering DPR 1/2/3 and desktop/phone stage sizes, and local Chrome before/after
visual comparisons. Phone widths and DPR 2 are simulated in the browser; physical
phones and Safari/Firefox have not been tested. Local comparison pages and
reference settings are in the Git-ignored `tmp/viewer-review/` directory.

**2026-11-01 point-size refinement:** After checkpoint `5d9341c`, static cloud
points are 2.7 CSS px in every scene. Dynamic points are 3.2 px for Swing,
Tire Swing and Motocross, 4.5 px for Spin, and 2.4 px elsewhere. Track-head
diameters are reduced 20% in every scene, retaining their prior density scaling:
2.4 CSS px at DPR 1 and 4.8 CSS px at DPR 2 or higher. Trail styling, camera
framing and disabled zoom are unchanged.

**2026-11-01 Running track heads:** After checkpoint `d7d0672`, Running's
track-head diameter is reduced a further 40% from the preceding setting:
1.44 CSS px at DPR 1 and 2.88 CSS px at DPR 2 or higher. Other scenes, cloud
points and trails retain their previous settings.

## Measured results

Chrome, 1920×902 viewport, fresh foreground tabs, local HTTP byte-range server,
local responses marked `Cache-Control: no-store`. These are approximately
five-second snapshots after DOMContentLoaded, without network throttling.
Transfer totals are completed Resource Timing entries, excluding the HTML
response; they are not total storage or a production Lighthouse score.

| Measurement | Original | Optimized |
|---|---:|---:|
| Initial resource transfer | 70.15 MB | 8.74 MB (**87.5% less**) |
| Completed resource requests | 72 | 11 (**84.7% fewer**) |
| Videos observed playing initially | 55 | 1 |
| Initial 3D WebGL draw calls | 560 | 0 |
| Initial animation-frame callbacks | 140 | 0 |
| Video decoders for the 15 synchronized groups | 51 | 15 |
| MP4 bytes for merged groups | 61.74 MB | 65.34 MB |
| Default referenced MP4 bytes, including viewer clips | 81.05 MB | 83.52 MB |

After loading a scene and moving the entire stage offscreen, **zero additional
WebGL draws or animation-frame callbacks** occurred over 27 seconds. All nine
thumbnail videos were paused and the displayed frame stayed unchanged.

The recorded five-second long-task totals were 931 ms before and 528 ms after.
Treat those as indicative only: browser automation and diagnostic collection
add work, earlier runs varied, and this is not a controlled CPU/GPU benchmark.
No reliable process-memory or physical-mobile energy measurement was made.

Raw measurements and check results: [performance/measurements.json](performance/measurements.json).
Per-file hashes, metadata, sizes and full-duration SSIM:
[media manifest](static/videos/optimized/manifest.json).

## Implementation and incremental findings

1. **Lazy loading and playback.** Static videos use deferred sources and
   `preload="none"`; nearby groups preload, and only visible groups play.
   Hidden tabs pause playback. Initial posters are loaded only as needed.
   The page-wide click handler that restarted offscreen videos was removed.
   Explicit dimensions and full-width grid cells reserve the original layout
   before media loads. The Method video's native controls retain a manual pause
   across scrolling and tab visibility changes.

2. **Synchronized groups.** Each teaser/result/comparison group now has one
   H.264 video containing its panels at their original resolution. A shared
   video-frame callback copies the panels into canvases in the existing cells.
   Labels, margins, gutters and the mobile three-plus-two grid remain intact.
   Five-panel files use a three-by-two arrangement; no input image is cropped
   or resized. Canvas/decoder creation is also deferred until needed. Missing
   or unsupported composite playback restores the original individual videos.
   The interactive three-video correction wipe stays separate.

3. **Compression.** Encodes use CRF 21, H.264/yuv420p, original dimensions,
   original frame counts/timing, and MP4 faststart. Six reviewed individual
   sidecars save **1.12 MB**: cartwheel, spin, swing-tire, swing, tennis and the
   basketball input video. Seven ineffective/larger trials remain outside the
   repository. Method and both trajectory-wipe videos retain their originals.

4. **3D viewer.** Three.js, controls, renderer creation and initial scene data
   wait until the viewer approaches the viewport. Scene-selection tokens avoid
   stale loading callbacks; controls tolerate unloaded data. Rendering stops
   completely offscreen or in hidden tabs. Trajectory buffers are allocated
   directly, with byte-identical positions, colors, timestamps and draw ranges
   for all nine scenes. Camera behavior, DPR, point sizes and timing are retained.
   The existing scene data format and cache remain unchanged.

The supplied patches were useful starting points but could not be applied
unchanged: merging downscaled panels and changed mobile layout; lazy media
shifted layout; and the proposed viewer patch retained eager initialization,
continuous animation scheduling and loading races. Those issues were addressed
in the implementation above.

## Quality, regressions and limits

- All 15 groups have compatible source timing. FFprobe verifies exact frame
  counts, durations, frame rates, native dimensions and pixel aspect ratios for
  all generated videos. An initial encoder timing issue was caught and fixed
  before integration; no frames are dropped or added.
- Full-duration per-panel SSIM against the original decoded videos ranges from
  **0.984504 to 0.998705**. Native-resolution spot checks of thin trajectories and
  representative compressed clips showed no obvious degradation. This is lossy
  encoding, not a claim of pixel-identical video quality.
- **Storage/transfer tradeoff:** grouped MP4s grow by **3.60 MB (5.82%)**.
  After individual compression savings, default referenced video bytes grow
  **2.48 MB (3.05%)**. Poster files add another **5.02 MB** over a complete visit,
  though they load lazily. Synchronization and initial-load savings come mainly
  from fewer simultaneous downloads and decoders, not smaller merged files.
- Originals remain as fallbacks and reversible source assets. Generated MP4s
  plus posters add **73.20 MB** to the checkout. Rejected trial files are outside
  the checkout and are not website dependencies.
- Canvas copies add rendering work while groups are visible. Only visible
  groups render, and backing sizes are capped at native resolution and DPR 2.
  Chrome was tested; Safari, Firefox, physical phones, slow-network behavior
  and production caching still need a deployment review. Unsupported
  video-frame-callback browsers retain the original multi-video approach.
  Browser automation kept test documents visible when switching tabs; the
  hidden-tab code path passed deterministic lifecycle tests, but a real hidden
  visibility transition was not verified in that browser session.
- No visible layout regression was found in tested desktop and 390×844 mobile
  views. Desktop section positions matched; mobile landscape and portrait cells
  matched the original dimensions. One extension messaging error occurred
  during browser tooling; final instrumented application runs reported no errors.

## Validation and local preview

Browser checks covered all 15 groups, all nine scenes, seek/pause/resume,
full trails, reset, the mobile lower comparison row with its decoder above the
viewport, the correction wipe, Method pause persistence, and BibTeX copy.
A deliberately missing teaser composite successfully restored both original
videos and played them. Original videos pass all 64 recorded SHA-256 checks.
The viewer test checks 157,525 segments plus missing-track and single-frame cases.

The website and JavaScript tests work from a fresh checkout. The full
`validate_assets.py` audit and `optimize_media.py` regeneration also inspect
unused historical media and require this checkout's `tmp/unused/` archive.
That archive is intentionally excluded from Git; copy it separately when
reproducing the complete audit elsewhere. Archived original videos can also
be recovered from baseline commit `db6ecdea393ae410e85bbb019fc3ab2247f14ffb`;
the archived generated atlases and posters are only in the local archive.

```sh
python3 tools/preview.py --port 8766
# Open http://127.0.0.1:8766/
python3 tools/validate_assets.py
node tools/validate_viewer.cjs
node tools/validate_viewer_presentation.cjs
node tools/validate_media_loader.cjs
node --check static/js/relift-media-loader.js
node --check static/js/relift-viewer.js
```

`tools/preview.py` supports MP4 byte-range seeking and binds only to localhost.
For diagnostic snapshots, add `--measure` and open `/?measure=1`; the JSON is in
`#__performance`. Instrumentation is never included by the normal website.

`python3 tools/optimize_media.py` prints a plan without writing. Add `--encode`
to rebuild verified sidecars; original media is never overwritten. Rejected
trials go outside the repository (`--trial-dir` can choose the location).
Review new encoding quality before using changed settings.
