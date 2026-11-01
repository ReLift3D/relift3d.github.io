#!/usr/bin/env python3
"""Check original-media integrity and the website's generated asset contract.

Requires ffprobe, uses only the Python standard library, and writes nothing.
Checks hashes, encoded timing/resolution, MP4 faststart, poster dimensions,
lazy HTML sources, atlas crops/order, and dynamically selected viewer assets.
Browser playback, appearance, and performance still need separate testing.
Retained assets may live under tmp/unused; browser references may not.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import re
import struct
import subprocess
from fractions import Fraction
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
from media_paths import find_assets, resolve_asset


RETAINED_ONLY_GROUPS = {"crossing", "car-shadow", "more_kangaroo"}
MORE_RESULTS_ORDER = [
    "more_kangaroo_with_occlusion_short", "more_horsejump-high", "more_schoolgirls",
    "more_swing-tire", "more_motocross-bumps", "more_camel",
]
COMPARISON_ORDER = ["lady-running", "libby", "motorbike", "bmx-trees", "spin"]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            result.update(block)
    return result.hexdigest()


def metadata(path: Path) -> dict:
    completed = subprocess.run([
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
        "stream=width,height,avg_frame_rate,nb_frames,duration,codec_name,"
        "pix_fmt,sample_aspect_ratio", "-of", "json", str(path),
    ], capture_output=True, text=True, check=True)
    streams = json.loads(completed.stdout)["streams"]
    require(len(streams) == 1, f"Expected one video stream in {path}")
    return streams[0]


def faststart(path: Path) -> None:
    atoms = []
    size_on_disk = path.stat().st_size
    with path.open("rb") as stream:
        while stream.tell() < size_on_disk:
            start = stream.tell()
            header = stream.read(8)
            require(len(header) == 8, f"Truncated MP4 atom in {path}")
            size, atom = struct.unpack(">I4s", header)
            if size == 1:
                extended = stream.read(8)
                require(len(extended) == 8, f"Truncated extended atom in {path}")
                size = struct.unpack(">Q", extended)[0]
            elif size == 0:
                size = size_on_disk - start
            require(size >= stream.tell() - start and start + size <= size_on_disk,
                    f"Invalid MP4 atom size in {path}")
            atoms.append(atom)
            stream.seek(start + size)
    require(b"moov" in atoms and b"mdat" in atoms, f"Missing MP4 movie/media atom: {path}")
    require(atoms.index(b"moov") < atoms.index(b"mdat"), f"MP4 lacks faststart: {path}")


def validate_encoded(path: Path, encoded: dict, original: dict, width: int, height: int) -> None:
    require(path.is_file(), f"Missing encoded video: {path}")
    require(digest(path) == encoded["output_sha256"], f"Encoded video hash changed: {path}")
    actual = metadata(path)
    for key, expected in (("width", width), ("height", height),
                          ("codec_name", "h264"), ("pix_fmt", "yuv420p")):
        require(actual.get(key) == expected, f"{path.name}: unexpected {key}: {actual.get(key)}")
    require(Fraction(actual["avg_frame_rate"]) == Fraction(original["fps"]), f"FPS changed: {path}")
    require(int(actual["nb_frames"]) == original["frames"], f"Frame count changed: {path}")
    require(abs(float(actual["duration"]) - original["duration_s"]) <= 0.001,
            f"Duration changed: {path}")
    sar = actual.get("sample_aspect_ratio", "1:1")
    require(sar == original["sample_aspect_ratio"], f"Pixel aspect ratio changed: {path}")
    faststart(path)


class Page(HTMLParser):
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input",
            "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.groups = []
        self.videos = []
        self.references = set()

    def handle_starttag(self, tag: str, attributes: list[tuple[str, str | None]]) -> None:
        attrs = dict(attributes)
        group = next((item[2] for item in reversed(self.stack) if item[2]), None)
        if "data-composite-src" in attrs:
            group = {"attributes": attrs, "videos": []}
            self.groups.append(group)
        if tag == "video":
            require("autoplay" not in attrs and not attrs.get("src"), "Eager video source/autoplay in HTML")
            require(attrs.get("preload") == "none", "Static video must use preload=none")
            require(bool(attrs.get("data-src")), "Static video has no lazy fallback source")
            self.videos.append(attrs)
            if group:
                group["videos"].append(attrs)
        if tag == "source" and any(item[0] == "video" for item in self.stack):
            require(not attrs.get("src"), "Eager nested video source in HTML")
        if tag == "script":
            require("static/data/" not in (attrs.get("src") or ""), "3D scene loaded eagerly in HTML")
        for key in ("src", "data-src", "poster", "data-poster", "data-composite-src", "href"):
            if attrs.get(key):
                self.references.add(attrs[key])
        if tag not in self.VOID:
            self.stack.append((tag, attrs, group))

    def handle_endtag(self, tag: str) -> None:
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                break


def local_reference(repo: Path, reference: str) -> Path | None:
    url = urlsplit(reference)
    if url.scheme or url.netloc or not url.path:
        return None
    path = (repo / unquote(url.path).lstrip("/")).resolve()
    require(path.is_relative_to(repo), f"Asset reference leaves repository: {reference}")
    require(not path.is_relative_to(repo / "tmp"), f"Runtime reference points into local tmp: {reference}")
    require(path.is_file(), f"Missing local HTML asset: {reference}")
    return path


def check_page(repo: Path, manifest: dict) -> dict:
    page = Page()
    page.feed((repo / "index.html").read_text(encoding="utf-8"))
    require(len(page.videos) == 43, f"Expected 43 fallback/method/wipe videos, found {len(page.videos)}")
    require(len(page.groups) == 12, f"Expected 12 displayed atlas containers, found {len(page.groups)}")
    local = {path for reference in page.references if (path := local_reference(repo, reference))}
    by_source = {entry["src"]: (name, entry) for name, entry in manifest["groups"].items()}
    used_groups = set()
    more_results_order = []
    comparison_order = []
    for group in page.groups:
        attrs = group["attributes"]
        require(attrs["data-composite-src"] in by_source, "HTML references an unrecorded atlas")
        name, entry = by_source[attrs["data-composite-src"]]
        require(name not in used_groups, f"Duplicate atlas container: {name}")
        used_groups.add(name)
        if name.startswith("more_"):
            more_results_order.append(name)
        if len(entry["panels"]) == 5:
            comparison_order.append(name)
        require(attrs.get("data-sync", "teaser") == name, f"Group name mismatch: {name}")
        columns = int(attrs["data-atlas-columns"])
        width, height = int(attrs["data-panel-width"]), int(attrs["data-panel-height"])
        require(columns == entry["recipe"]["columns"], f"Atlas column mismatch: {name}")
        require(len(group["videos"]) == len(entry["panels"]), f"Panel count mismatch: {name}")
        require(width == max(panel["width"] for panel in entry["panels"]) and
                height == max(panel["height"] for panel in entry["panels"]),
                f"Atlas cell dimensions mismatch: {name}")
        require(entry["width"] == width * columns and
                entry["height"] == height * ((len(entry["panels"]) + columns - 1) // columns),
                f"Atlas total dimensions mismatch: {name}")
        for index, (video, panel) in enumerate(zip(group["videos"], entry["panels"])):
            require(video["data-src"] == panel["source"], f"Panel order/source mismatch: {name}, {index}")
            source = manifest["sources"][Path(panel["source"]).name]
            require(panel["width"] == source["width"] and panel["height"] == source["height"],
                    f"Panel does not preserve native dimensions: {name}, {index}")
            require(entry["recipe"]["sources"][Path(panel["source"]).name] == source["sha256"],
                    f"Atlas uses an outdated source: {name}, {index}")
            require(int(video["width"]) == panel["width"] and int(video["height"]) == panel["height"],
                    f"Fallback video aspect ratio mismatch: {name}")
            require(panel["x"] == (index % columns) * width and panel["y"] == (index // columns) * height,
                    f"HTML canvas crop does not match encoded panel: {name}, {index}")
            require(video.get("data-poster") == panel["poster"], f"Poster/source mismatch: {name}")
    require(RETAINED_ONLY_GROUPS <= set(manifest["groups"]), "Hidden atlases must remain in the manifest")
    require(used_groups == set(manifest["groups"]) - RETAINED_ONLY_GROUPS,
            f"HTML must display all atlas groups except {sorted(RETAINED_ONLY_GROUPS)}")
    require(more_results_order == MORE_RESULTS_ORDER,
            f"Expected More Results order {MORE_RESULTS_ORDER}, found {more_results_order}")
    require(comparison_order == COMPARISON_ORDER,
            f"Expected comparison order {COMPARISON_ORDER}, found {comparison_order}")

    viewer = (repo / "static/js/relift-viewer.js").read_text(encoding="utf-8")
    names_match = re.search(r"const\s+NAMES\s*=\s*(\[[^\]]*\])", viewer)
    compressed_match = re.search(r"const\s+COMPRESSED\s*=\s*new Set\((\[[^\]]*\])\)", viewer)
    require(bool(names_match and compressed_match), "Cannot inspect viewer asset selections")
    names = ast.literal_eval(names_match.group(1))
    compressed = set(ast.literal_eval(compressed_match.group(1)))
    require(len(names) == len(set(names)) == 9 and compressed <= set(names), "Invalid viewer scene selections")
    for name in names:
        filename = f"demo_{name}.mp4"
        video = (f"static/videos/optimized/individual/{filename}" if name in compressed
                 else f"static/videos/{filename}")
        for reference in (video, f"static/data/{name}.js", f"static/images/posters/demo_{name}.jpg"):
            local.add(local_reference(repo, reference))
        if name in compressed:
            require(manifest["individuals"][filename].get("src") == video,
                    f"Viewer references a rejected or unrecorded encode: {name}")
    for entry in manifest["individuals"].values():
        if entry.get("src"):
            require(repo / entry["src"] in local, f"Accepted sidecar is not referenced: {entry['src']}")
    return {"html_video_fallbacks": len(page.videos), "html_atlas_groups": len(page.groups),
            "more_results_order": more_results_order,
            "comparison_order": comparison_order,
            "local_asset_references": len(local), "viewer_scenes": len(names)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    repo = args.repo.resolve()
    manifest = json.loads((repo / "static/videos/optimized/manifest.json").read_text())
    originals = manifest["sources"]
    require(len(originals) == 64 and len(manifest["groups"]) == 15, "Incomplete media manifest")
    for filename, entry in originals.items():
        original = resolve_asset(repo, f"static/videos/{filename}")
        require(original.is_file() and digest(original) == entry["sha256"], f"Original media changed: {filename}")
    print("PASS: 64 original media hashes unchanged")

    for name, entry in manifest["groups"].items():
        panels = entry["panels"]
        source = originals[Path(panels[0]["source"]).name]
        validate_encoded(resolve_asset(repo, entry["src"]), entry, source, entry["width"], entry["height"])
        for panel in panels:
            require(panel["x"] + panel["width"] <= entry["width"] and
                    panel["y"] + panel["height"] <= entry["height"], f"Crop outside atlas: {name}")
    accepted = {filename: entry for filename, entry in manifest["individuals"].items() if entry.get("src")}
    require(len(accepted) == 6, f"Expected six reviewed sidecars, found {len(accepted)}")
    for filename, entry in accepted.items():
        source = originals[filename]
        require(entry["candidate_for_visual_review"], f"Rejected trial has a website src: {filename}")
        validate_encoded(resolve_asset(repo, entry["src"]), entry, source, source["width"], source["height"])
    generated = set(find_assets(repo, "static/videos/optimized", "*.mp4", recursive=True))
    expected = {entry["src"] for entry in list(manifest["groups"].values()) + list(accepted.values())}
    require(generated == expected, "Unexpected or missing generated website MP4s; rejected trials belong outside the repository")
    print("PASS: 15 atlases and 6 reviewed encodes preserve resolution, FPS, frames, duration, SAR and faststart")

    require(set(manifest["posters"]) == set(originals), "Poster set differs from original videos")
    for filename, entry in manifest["posters"].items():
        path = resolve_asset(repo, entry["src"])
        require(path.is_file() and path.stat().st_size == entry["bytes"], f"Missing or changed poster: {filename}")
        poster = metadata(path)
        source = originals[filename]
        expected_width = min(640, source["width"])
        expected_height = round(source["height"] * expected_width / source["width"])
        require(poster["codec_name"] == "mjpeg" and poster["width"] == expected_width and
                poster["height"] == expected_height, f"Poster dimensions/format mismatch: {filename}")
    print("PASS: all 64 posters exist with expected JPEG dimensions")
    page = check_page(repo, manifest)
    print("PASS: lazy HTML sources, atlas dimensions/order/crops, and local/viewer references")
    print(json.dumps({"originals": len(originals), "atlases": len(manifest["groups"]),
                      "reviewed_sidecars": len(accepted), "posters": len(manifest["posters"]), **page}, indent=2))


if __name__ == "__main__":
    main()
