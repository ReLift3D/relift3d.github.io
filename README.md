# ReLift: Dense 3D Tracking as Lifted Trajectory Repair

The project website for ReLift, including video results and interactive 3D
tracking demos.

**Paper authors:** Assaf Singer, Maroun Khriesh, Noam Rotstein, Yoni Kasten,
and Or Litany. Assaf and Maroun contributed equally.

[Project website](https://relift3d.github.io/) ·
[Paper (PDF)](https://arxiv.org/pdf/2610.42136) ·
[arXiv](https://arxiv.org/abs/2610.42136) ·
[Research code](https://github.com/ReLift3D/ReLift)

## Local preview

Requires Python 3.10 or later:

```sh
python3 tools/preview.py --port 8766
```

Open <http://127.0.0.1:8766/>. The preview server supports MP4 byte ranges for
video playback and seeking. Analytics is disabled for local previews.

The site is static HTML, CSS, and JavaScript; no build step is required.

## Validation

Run the JavaScript checks with Node.js:

```sh
node tools/validate_media_loader.cjs
node tools/validate_viewer.cjs
node tools/validate_viewer_presentation.cjs
```

The complete media audit additionally requires `ffprobe` and the separately
preserved `local-media-archive/unused/` sources, accessible through the local
`tmp/unused/` compatibility symlink:

```sh
python3 tools/validate_assets.py
```

Previous video versions, trial encodes and retired originals are kept in
`local-media-archive/`, explicitly excluded by `.gitignore`. The website and
JavaScript checks work without it. When transferring the archive to another
checkout, also recreate `tmp/unused` pointing to `../local-media-archive/unused`.
See [PERFORMANCE_REPORT.md](PERFORMANCE_REPORT.md) for
measurements and media regeneration details, and [README.txt](README.txt) for
favicon and analytics maintenance notes.

## Website contributors

[Assaf Singer](https://github.com/AssafSinger94) and
[Maroun Khriesh](https://github.com/MarounKhriesh).
