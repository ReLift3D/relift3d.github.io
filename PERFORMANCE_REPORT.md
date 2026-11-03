# ReLift3D performance optimization

## 2026-11-03 remaining-video compression

The remaining 22 default playback videos were tested for approximately 10%
smaller files. **19 were adopted**, saving another **4,306,105 bytes (4.31 MB)**:
8.90% across all 22 tested files, or 13.26% across the 19 changed files.
Individual reductions range from 8.17% to 15.86%. These changes were prepared
and measured on `modest-media-optimization`, based on `4d56c1a`.

| Playback category | Files reduced | Additional bytes saved |
|---|---:|---:|
| Comparison and More Results synchronized videos | 8 | 2,863,261 |
| Interactive viewer input clips | 7 | 394,623 |
| Method animation | 1 | 855,557 |
| Correction wipe clips | 3 | 192,664 |

Kangaroo occlusion, Running and Hike remain unchanged. Kangaroo and Running
exceeded the chosen quality-loss limit before achieving useful savings; the
tested Hike encodes were larger. No original fallback sources, hidden archived
groups, posters or interactive 3D assets were changed.

Including the earlier three-video pass below, the **25 default playback MP4s
total 72,967,679 bytes**, down from the published 82,471,465 bytes: **9.50 MB
(11.52%) less**. This is a playback inventory, excluding fallback-only and
archived videos; it is not the total repository size or initial page transfer.

### Current validation and limits

All selected files were encoded from original sources with H.264, the slow
preset and faststart. Native dimensions, aspect ratios, frame rates, frame
counts, durations and packet presentation timestamps are preserved. The lowest
full-duration original-source SSIM among the 19 selections is **0.980103**.
Matched stills were reviewed, including thin trajectories and Method text;
compression remains lossy and this is not proof of pixel-identical quality.

Desktop Chrome played all eight changed synchronized groups with one decoder
per group and shared panel frame callbacks. The Method animation and all three
wipe clips played and sought successfully. The wipe's observed playing-clock
spread was 1.945 ms; a paused seek to 2.5 seconds aligned all three exactly.
All nine viewer scenes loaded and played; Drift Turn's last-frame seek and
resume passed. At 390×844, Tire Swing's More Results pair retained synchronized
playback and the viewer's Drift Turn clip played and sought correctly.

Fresh desktop initial-transfer samples at five and fifteen seconds both
measured **7,160,025 bytes**, one playing video, zero WebGL draws and no
application errors. This is effectively unchanged from the previous pass
(+50 bytes of viewer source-selection code). The new savings apply when
visitors browse lower sections. The 15-second sample recorded 20 dropped
teaser frames; the teaser is unchanged from the earlier pass, and these short,
variable samples do not establish improved frame rate. Slow-network buffering
described below remains. Phone-width checks use desktop Chrome, not a physical
phone; Safari, Firefox, CPU, battery and production CDN performance are untested.

The asset, media-loader and viewer-presentation validators passed. All 64
original source hashes are intact; the manifest validates 15 atlases and 11
selected individual encodes. HTML and viewer changes only select the new
individual files. The generator now preserves each output's recorded CRF when
`--crf` is omitted (verified by an unchanged manifest when rebuilding three
groups with different settings). New individual review candidates require at
least 8% savings and original-source SSIM of 0.98; visual review is still needed.

Compact results are in `remaining_media_optimization` in
[measurements.json](performance/measurements.json), with per-file recipes,
hashes and quality values in the [media manifest](static/videos/optimized/manifest.json).
Detailed trials, previous files and browser captures are kept only in ignored
`local-media-archive/modest-media/remaining/`; no new raw-log files were added
to `performance/`. The archive also contains the exact pre-optimization Git
versions of replaced files, earlier media revisions and retained original
sources. Five newly unused originals (Method, Drift Turn, Motocross and the
two wipe outputs) were moved into its `unused/` directory. Active playback
fallbacks remain in the website. Ignored symlinks at the previous `tmp/` paths
preserve offline tooling and historical evidence links. The archive's
`ARCHIVE_INDEX.json` records baseline and newly retired source checksums.

## 2026-11-03 earlier three-video compression stage

Three synchronized atlases were rebuilt from original source videos using
H.264 CRF 23 for teaser/Spin and CRF 24 for lady-running, retaining the slow
preset and faststart. The target was roughly 15% below the published sizes of
these three videos. This stage preceded the remaining-video pass above.
At this stage, other videos, fallback sources, posters, HTML/CSS, playback
code and interactive 3D assets were unchanged. These three selections remain
part of the current local candidate.

| Combined video | Published bytes | Candidate bytes | Reduction |
|---|---:|---:|---:|
| Teaser | 8,312,727 | 6,731,362 | 19.02% |
| lady-running comparison | 8,705,096 | 7,070,161 | 18.78% |
| Spin comparison | 17,085,860 | 15,104,479 | 11.60% |

Together these files save **5,197,681 bytes (5.20 MB), or 15.24%** of their
published total. This is an additional 3,005,999 bytes beyond the previous
local CRF 22 trial. The complete default-video inventory falls from 82.47 MB
to 77.27 MB; that is 6.30% of all default-video bytes, not a 15% reduction of the
whole site. Only the teaser contributes to the initial-load savings.

### Loading and playback

Fresh 1920×902 and 390×844 foreground Chrome captures measured completed
site transfer of **7,159,975 bytes** at both five and fifteen seconds after
DOMContentLoaded. Compared with the published configuration's 8,741,340 bytes
for the same local site resources, this saves **1,581,365 bytes (18.09%)**.
The previous CRF 22 candidate measured 7,928,505 bytes. These totals exclude
HTML and diagnostics. All current initial captures had one playing video,
zero WebGL draws and no application errors. Tests used no-store localhost;
these are not production CDN, CPU or battery benchmarks.

At fifteen seconds, the initial desktop run recorded 18 dropped frames and
the phone-width run recorded 5, versus 0 in the earlier published desktop
baseline. The first desktop capture overlapped encoding work; a repeat after
encoding finished recorded 7 dropped frames and the same 7,159,975-byte
transfer. These variable short captures do not establish improved playback
smoothness or isolate a compression-related regression.

All three changed groups played with a single decoder and shared frame
callbacks. Desktop paused seeks to 2.5 seconds retained zero panel timestamp
spread. Both comparisons played in the mobile three-plus-two layout, and
Spin's mobile seek passed. One tab open while the Spin atlas was replaced
used the existing original-video fallback; fresh-page and subsequent desktop
checks used the new composite successfully. That intermediate tab is excluded
from the final composite checks.

At the same 2,000 kbps local cap and 150 ms added latency, the stronger teaser
still buffered. Its media time was 3.33 seconds at fifteen seconds after
DOMContentLoaded, with 23 dropped frames recorded. Earlier single runs reached
2.85 seconds for the published teaser and 3.13 seconds for CRF 22; these uncontrolled
single-run observations do not establish a frame-rate improvement or regression.
The current teaser averages about 4.62 Mbps, still above the slow connection's
capacity. This change reduces transfer volume; it does not resolve slow-network
buffering or reduce decoded resolution/decoder count.

### Quality, integrity and reproduction

Native panel/atlas dimensions, pixel aspect ratios, frame counts, frame rates,
durations, packing and every presentation timestamp/packet duration match.
All 64 original source hashes remain unchanged. Full-duration per-panel SSIM
against original sources ranges from **0.983316 to 0.995790** for these twelve
panels. The group minima are 0.983316 (teaser), 0.984986 (lady-running) and
0.983863 (Spin). Spin CRF 24 was rejected: its input-panel SSIM fell to 0.978502,
below the preferred 0.98 threshold. The selected Spin CRF 23 clears that floor.

Compression remains lossy. Matched native stills and desktop/mobile-width
page review found no obvious trajectory loss at the inspected times and
sizes; these are not pixel-identical copies or exhaustive visual proof.
The asset validator passed integrity, timing, crops, faststart and references.
Safari, Firefox and physical phones remain untested.

Compact results for this stage are in `stronger_media_optimization` in
[measurements.json](performance/measurements.json); `modest_media_optimization`
retains the superseded CRF 22 trial. Current per-panel quality, hashes and
encoding recipes are in the [media manifest](static/videos/optimized/manifest.json).
Detailed exports, trial videos, comparison frames and previous atlases remain
only in ignored `tmp/modest-media/`; no new raw-log files were added to `performance/`.

Rebuild the selected groups from their original sources with explicit settings:

```sh
python3 tools/optimize_media.py --encode --groups teaser spin --crf 23 --skip-posters --skip-individuals
python3 tools/optimize_media.py --encode --groups lady-running --crf 24 --skip-posters --skip-individuals
```

Other groups retained CRF 21 at this stage; later selections are documented
above and in the manifest. The earlier CRF 22 trial saved 2.19 MB overall and
measured 7.93 MB initial transfer; it is superseded by this candidate.

## 2026-11-02 reevaluation

The current page at `8db57b3` retains the initial lazy-loading savings after
the content and layout changes. This reevaluation also found and fixed a
remaining source of unnecessary work: a visible, paused 3D viewer continued
redrawing. The updated viewer now renders paused scenes only when needed for
orbit movement, seeking, controls or resizing. No videos were re-encoded, and
media dimensions, frame timing, source selections and recorded quality values
are unchanged by this fix.

The published HTML and both media/viewer scripts were verified against the
local baseline before editing. This includes the November 2 deployment and
the wider comparison layout. The current median initial transfer remains
about **87.5% below the original 70.15 MB measurement**. The measurements below
were collected locally before publication of the viewer fix; they are not a
production CDN benchmark.

### Initial loading and measurement definitions

Chrome was tested in foreground tabs at 1920×902 and 390×844, using the local
byte-range server with `Cache-Control: no-store`. Samples were captured five
and fifteen seconds after DOMContentLoaded. The baseline contains five
desktop runs and one phone-width run, classified by their recorded viewport;
the post-fix checks contain one fresh run at each width. Phone-width testing
used desktop Chrome at DPR 1, not a physical phone.

| Initial check | Completed transfer | Completed resource requests | Playing videos | 3D WebGL draws / animation callbacks |
|---|---:|---:|---:|---:|
| Original page, legacy instrumentation | 70,153,691 bytes | 72 | 55 | 560 / 140 |
| Historical optimized page, legacy instrumentation | 8,736,921 bytes | 11 | 1 | 0 / 0 |
| Current pre-fix baseline, legacy instrumentation, median | 8,743,718 bytes | 13 | 1 | 0 / 0 |
| Post-fix desktop, canonical site totals | 8,754,395 bytes | 14 | 1 | 0 / 0 |
| Post-fix phone width, canonical site totals | 8,752,730 bytes | 13 | 1 | 0 / 0 |

These transfer totals exclude HTML and are not directly interchangeable.
Legacy `transferBytes` includes the injected measurement script; the enhanced
`siteTransferBytes` excludes diagnostic endpoints. The enhanced raw totals
are 8,770,337 and 8,768,672 bytes, including 15,942 bytes for that script.
Favicon requests also vary: the final desktop capture includes an ICO and two
SVG requests, while the phone-width capture includes an ICO and one SVG.
After excluding diagnostics and favicon requests consistently, the pre/post
production-resource difference is exactly **576 bytes**, the viewer code
change. Initial media transfer and lazy viewer initialization remain intact.
The completed totals above were unchanged at the fifteen-second samples.

Evidence: [baseline repeats](performance/current-initial-2026-11-02.json),
[final desktop](performance/final-desktop-2026-11-02.json), and
[final phone width](performance/final-mobile-2026-11-02.json).

### Paused viewer improvement and functional checks

Before the fix, a stationary paused viewer issued **6,240 WebGL draw calls and
1,560 animation-frame callbacks over 15,999.1 ms**. After settling with the fix,
it issued **zero additional draws or callbacks over 6,004.6 ms**, with the
displayed frame unchanged. Paused orbit interaction still rendered: it added
224 draw calls while moving and damping, then stopped again. Moving the viewer
offscreen produced zero additional draws or callbacks over 5,003.8 ms.
These are instrumented counters, not CPU, battery or GPU-time measurements.
See [before](performance/viewer-paused-before-2026-11-02.json),
[after](performance/viewer-paused-after-2026-11-02.json), and
[browser interactions](performance/viewer-browser-2026-11-02.json).

All nine scenes loaded in the browser. Selection actions took
295–482 ms locally; these include UI automation and are observed upper bounds
for those actions, not isolated decode/build benchmarks. Seeking to the last
and second frames, full trails, orbit and resume passed. Deterministic checks
also covered all nine scenes, exact trajectory buffers, DPR 1/2/3, paused
redraws, hidden/offscreen suspension, loading races and cached revisits.
Visited scene payloads remain cached in `window.SUPP`, and a pending scene
load can still finish decoding/building after the page is hidden, although it
does not start rendering. These existing behaviors were not changed.
[Viewer audit](performance/viewer-audit-2026-11-02.json).

All twelve synchronized groups advanced in desktop browser checks with one
decoder each and their source aspect ratios retained.
[Group checks](performance/groups-2026-11-02.json). Diagnostic seeks to 2.5 s
passed for revised kangaroo, Spin, Method and the correction wipe; atlas
panels shared a callback and had zero presentation-time spread. The wipe's
three independent videos had zero spread when paused at the requested time
and about 0.45 ms spread in the observed playing snapshot. The divider moved
between approximately 25% and 75%, and Method remained manually paused after
scrolling away and back. These are observed snapshots, not a guarantee of
zero drift across every browser or playback session.
[Seeking](performance/seeking-2026-11-02.json),
[wipe and Method](performance/wipe-method-2026-11-02.json).

At 390×844, Spin's lower two panels remained visible with their top at 8.97 px
while the hidden decoder's bottom was 200.22 px above the viewport. The group
advanced 25 shared-frame updates, and all five panels retained the same
callback/media timestamp with zero spread. This checks that playback follows
the visible group rather than the tiny decoder's position.
[Mobile lower-row check](performance/mobile-lower-row-2026-11-02.json).

An intentionally missing teaser composite restored both original videos,
removed the canvases and played both sources; their observed clock spread
was 0.24 ms. Simulating the absence of `requestVideoFrameCallback` also used
the two original videos, with 0.128 ms observed spread. The intentional 404
was the only reported error in the failure test; the unsupported-feature
simulation reported none. These are Chrome failure/feature simulations,
not Safari or Firefox tests. [Fallback checks](performance/fallback-2026-11-02.json).

### Slow local connection

The preview server was configured for a shared **2,000 kbps local response-body
cap** and **150 ms added latency before response headers**. Local files were
served uncompressed; external origins were unaffected. This is server-side
throttling, not OS/network emulation or CPU throttling.

| Snapshot after DOMContentLoaded | Completed site Resource Timing transfer | Desktop server body bytes written | Phone-width server body bytes written |
|---|---:|---:|---:|
| 5 seconds | 439,703 bytes | 1,259,699 bytes | 1,259,699 bytes |
| 15 seconds | 439,703 bytes | 3,344,563 bytes | 3,324,083 bytes |

The small completed-transfer total does **not** mean the page downloaded only
0.44 MB. The teaser request was still in flight in both snapshots, so its
partial response was absent from completed Resource Timing entries. The
server ledger includes in-flight and aborted body writes, excludes HTML,
headers and diagnostics, and can run ahead of browser receipt because of OS
buffering. Ledger captures followed the corresponding browser sample by
about 8–17 ms.

The 8.31 MB teaser retained synchronized canvases but repeatedly waited for
data; its media time reached only about 2.8 s at the fifteen-second snapshot.
The completed captures logged 32 desktop and 30 phone-width `waiting` events;
these event counts cover the recorded session, not a controlled stall-rate
benchmark. The offscreen 3D viewer still performed no draws or animation
callbacks. Slow-network playback remains a limitation despite correct
synchronization. [Desktop](performance/slow-desktop-2026-11-02.json),
[phone width](performance/slow-mobile-2026-11-02.json).

### Current content inventory and integrity

The page now contains **12 composite groups / 39 synchronized panels**, plus
one Method video and three wipe videos: **43 static video elements**, with
nine additional viewer thumbnail clips. Composite playback needs twelve
decoders for those thirty-nine panels. Crossing, car-shadow and the other
kangaroo group remain archived and undisplayed.

| Complete displayed-content inventory | Size |
|---|---:|
| Default MP4 selection, including all viewer clips | 82.47 MB in 25 files |
| Fallback MP4 selection | 83.68 MB in 52 files |
| Active posters, including Method | 4.33 MB |
| All nine scene-data files | 83.76 MB |

These are complete unique file sizes across all examples/scenes, **not initial
downloads**. Current default MP4 bytes are 1.05 MB below the historical
15-group optimized inventory because of curation, even though the revised
occlusion-kangaroo atlas alone adds 6.70 MB compared with its previous content.
Against the original-source MP4 selection, current default MP4
bytes are 2.75% smaller. Wider CSS rows do not change encoded bytes or crop
coordinates. They do increase destination canvas area: at maximum desktop
width, approximately 36% for landscape comparisons and 3.12× for Spin versus
the preceding layout. That is a geometric estimate, not a measured CPU cost.

The media validator passed 64 current-manifest source hashes, fifteen retained
atlases, six reviewed individual encodes, all 64 recorded posters, and runtime
references. Fresh FFprobe metadata and packet checks covered 85 videos;
presentation timestamps match for every source/atlas pair, the six encodes
and the correction wipe. No integrity, timing or aspect-ratio regression was
found. Active per-panel SSIM records range from **0.982214 to 0.998670**; the
lower bound belongs to the revised kangaroo result. **SSIM was not recomputed**:
the earlier full-duration records are tied to the source/output hashes checked
again now. JPEG validation checks sizes, dimensions and format, not pixel
identity. [Media evidence](performance/media-audit-2026-11-02.json).

### Reproduction and limits

Run an untouched initial-load capture in a foreground tab, at the intended
viewport before navigation, and read the JSON in `#__performance` after the
five- and fifteen-second samples:

```sh
python3 tools/preview.py --port 8766 --measure
# Open http://127.0.0.1:8766/?measure=1&run=desktop-initial-unique-label

python3 tools/preview.py --port 8767 --measure --latency-ms 150 --bandwidth-kbps 2000
# Open http://127.0.0.1:8767/?measure=1&run=slow-initial-unique-label

PYTHONDONTWRITEBYTECODE=1 python3 tools/validate_preview.py
PYTHONDONTWRITEBYTECODE=1 python3 tools/validate_assets.py
node tools/validate_media_loader.cjs
node tools/validate_viewer.cjs
node tools/validate_viewer_presentation.cjs
```

Use a distinct `run` label for each intentional capture; duplicate HTML
requests/reloads with the same label reuse its ledger. Use separate server
ports for simultaneously open test pages, or close the earlier page before
starting the next run. Diagnostic controls intentionally override media for
seek/play/pause inspection, so do not use them during initial-load captures.
The media audit requires the ignored archive, as explained below.

Only connected Chrome was exercised. Safari, Firefox and physical phones were
not tested, and a real hidden-tab transition was not observed; that lifecycle
passed deterministic tests. Local Analytics is intentionally disabled.
Production CDN compression, warm/cold production-cache behavior, real-device
CPU/thermal limits and process/GPU memory were not measured. Instrumentation,
automation and local no-store serving affect timings. No Lighthouse score or
end-to-end production speed claim is made from these captures.

The separate attempt to measure 3D scene loading on the slow connection could
not be completed because the browser automation connection repeatedly detached
from that test tab. No slow-network viewer time-to-ready is claimed. The
successful slow desktop/phone-width captures above concern initial media
loading; the successful nine-scene interaction checks used the unthrottled
local server. The detached browser tests are not evidence of an application
failure.

## Historical development record

The entries and original fifteen-group measurements below describe their
dated development states. Use the reevaluation above for current counts,
quality-record ranges, new measurements and remaining limits.

This report records website optimization and validation originally performed
on `website-performance-optimization`, starting from baseline
`db6ecdea393ae410e85bbb019fc3ab2247f14ffb`. Historical commit IDs in this report
are preserved in the full-history backup, outside the public release history.
Original videos and scene data remain intact in the development checkout,
including the local archive described below.
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

## Historical measured results (2026-10-30, fifteen groups)

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

## Historical implementation and incremental findings

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

## Historical quality, regressions and limits

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

## Historical validation and local preview

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
be recovered from baseline commit `db6ecdea393ae410e85bbb019fc3ab2247f14ffb`
in the full-history backup; that commit is not part of a fresh public clone.
The archived generated atlases and posters are only in the local archive.

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
