ReLift project page (local copy)

Serve the repository with Python 3.10+:
    python3 tools/preview.py --port 8766
and open http://127.0.0.1:8766/

The preview server supports MP4 byte ranges for playback and seeking.
No internet access is needed except for Google Fonts. A normal static web
server also works; direct file:// browsing can restrict dynamic assets.

See PERFORMANCE_REPORT.md for local optimization results, validation commands,
tradeoffs and reproducible media generation. All original media is retained.

Older videos, compression trials and unused originals are preserved in
local-media-archive/ (ignored by Git). ARCHIVE_INDEX.json records baseline and
newly retired source checksums; unused/MOVED_FILES.json covers earlier moves.
The existing tmp/unused path is a local symlink to local-media-archive/unused,
so media tools can still validate and regenerate from archived originals.
The complete media audit and regeneration require this archive; copy it
separately and recreate the tmp/unused symlink in another checkout. The website
itself and the JavaScript tests do not depend on the archive.

Browser tab icon
---------------
favicon.svg and favicon.ico are the supplied ReLift icons. The SVG is preferred
by modern browsers; the ICO contains 16, 32, 48 and 64 pixel fallback images.

Google Analytics (GA4)
----------------------
ReLift's measurement ID is G-E75FPMH63D, configured in the data-measurement-id
attribute on the relift-analytics.js script in index.html. To disable tracking,
leave that attribute empty.

The Google tag loads asynchronously only on https://relift3d.github.io.
Local and other preview hosts do not load Google Analytics or send events.
If the public domain changes, update the hostname in static/js/relift-analytics.js.
After deployment, verify a visit in Google Analytics Realtime or Tag Assistant.
