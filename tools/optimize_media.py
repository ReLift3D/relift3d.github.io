#!/usr/bin/env python3
"""Build reversible media sidecars for the ReLift3D website.

Requires ffmpeg and ffprobe. Originals are read, never overwritten or deleted.
The default prints a plan; --encode writes native-resolution synchronized
atlases, first-frame posters, individual compression trials, and a manifest.
Existing outputs are reused only when their recorded source hashes and build
settings match. --force rebuilds generated sidecars, never source files.
Assets moved to tmp/unused remain available and are rebuilt in that location.
The manifest continues to record their original static/... paths.

Usage: python3 tools/optimize_media.py --encode
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
from fractions import Fraction
from pathlib import Path
from media_paths import find_assets, logical_relative, resolve_asset


PAIR_NAMES = (
    "kangaroo_with_occlusion_short", "kangaroo", "horsejump-high",
    "swing-tire", "camel", "schoolgirls", "motocross-bumps",
)
COMPARISON_NAMES = (
    "lady-running", "libby", "car-shadow", "bmx-trees", "crossing",
    "motorbike", "spin",
)
METHODS = ("input", "tc3r_vggto", "vdpm", "4rc", "ours_cowtracker_vggto")
GROUPS = {
    "teaser": ["teaser_input.mp4", "teaser_tracks.mp4"],
    **{f"more_{name}": [f"more_{name}_input.mp4", f"more_{name}_ours.mp4"]
       for name in PAIR_NAMES},
    **{name: [f"cmp_{name}_{method}.mp4" for method in METHODS]
       for name in COMPARISON_NAMES},
}


def run(command: list[str]) -> str:
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f"Command failed: {command!r}\n{result.stderr}")
    return result.stdout + result.stderr


def probe(path: Path) -> dict:
    metadata = json.loads(run([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,avg_frame_rate,nb_frames,"
        "pix_fmt,codec_name,sample_aspect_ratio,duration:format=duration",
        "-of", "json", str(path),
    ]))
    stream = metadata["streams"][0]
    fps = Fraction(stream["avg_frame_rate"])
    if fps <= 0 or stream.get("nb_frames", "N/A") == "N/A":
        raise ValueError(f"Constant-rate frame metadata required: {path}")
    sample_aspect_ratio = stream.get("sample_aspect_ratio", "1:1")
    if sample_aspect_ratio == "N/A":
        sample_aspect_ratio = "1:1"
    return {
        "width": int(stream["width"]), "height": int(stream["height"]),
        "fps": str(fps), "frames": int(stream["nb_frames"]),
        "duration_s": float(stream.get("duration", metadata["format"]["duration"])),
        "codec": stream["codec_name"], "pixel_format": stream["pix_fmt"],
        "sample_aspect_ratio": sample_aspect_ratio,
        "bytes": path.stat().st_size,
    }


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def relative(path: Path, repo: Path) -> str:
    return logical_relative(path, repo)


def ffmpeg_inputs(paths: list[Path]) -> list[str]:
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
    for path in paths:
        command.extend(["-threads", "2", "-i", str(path)])
    return command


def encoder_options(crf: int) -> list[str]:
    return ["-an", "-c:v", "libx264", "-threads", "4", "-preset", "slow",
            "-crf", str(crf), "-pix_fmt", "yuv420p", "-movflags", "+faststart"]


def atomic_encode(command: list[str], destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.stem + ".partial" + destination.suffix)
    try:
        run(command + [str(temporary)])
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def validate_video(path: Path, source: dict, width: int, height: int) -> dict:
    actual = probe(path)
    for key, expected in (("width", width), ("height", height),
                          ("fps", source["fps"]), ("frames", source["frames"]),
                          ("sample_aspect_ratio", source["sample_aspect_ratio"]),
                          ("codec", "h264"), ("pixel_format", "yuv420p")):
        if actual[key] != expected:
            raise ValueError(f"{path}: {key}={actual[key]!r}, expected {expected!r}")
    if abs(actual["duration_s"] - source["duration_s"]) > 0.001:
        raise ValueError(f"{path}: duration changed")
    return actual


def measure_ssim(source: Path, output: Path, panel: dict | None = None) -> dict:
    # Full-frame, full-duration comparisons. No rescaling or frame subsampling.
    crop = (f"crop={panel['width']}:{panel['height']}:{panel['x']}:{panel['y']},"
            if panel else "")
    filters = (f"[0:v]setpts=PTS-STARTPTS[original];"
               f"[1:v]{crop}setpts=PTS-STARTPTS[encoded];"
               "[original][encoded]ssim")
    command = ffmpeg_inputs([source, output])
    command[command.index("error")] = "info"
    log = run(command + ["-filter_complex_threads", "2", "-filter_complex", filters,
                         "-an", "-f", "null", "-"])
    matches = re.findall(r"SSIM Y:([\d.]+).*?All:([\d.]+)", log)
    if len(matches) != 1:
        raise RuntimeError(f"SSIM measurement missing for {source}: {log[-2000:]}")
    return {"luma": float(matches[0][0]), "all": float(matches[0][1]),
            "scope": "all frames at native resolution"}


def make_group(repo: Path, name: str, names: list[str], sources: dict,
               crf: int, encode: bool, force: bool, previous: dict) -> dict:
    metadata = [sources[filename] for filename in names]
    first = metadata[0]
    for item in metadata:
        if item["sample_aspect_ratio"] != "1:1":
            raise ValueError(f"{name}: non-square pixels require an explicit atlas layout")
        for key in ("fps", "frames"):
            if item[key] != first[key]:
                raise ValueError(f"{name}: mismatched {key}; review synchronization before merging")
        if abs(item["duration_s"] - first["duration_s"]) > 0.001:
            raise ValueError(f"{name}: mismatched durations")
    columns = 2 if len(names) == 2 else 3
    rows = (len(names) + columns - 1) // columns
    # Use fixed cells for atlas offsets, but keep each source at its native size.
    # The browser crops away unused cell space and preserves each panel's ratio.
    panel_width = max(item["width"] for item in metadata)
    panel_height = max(item["height"] for item in metadata)
    width, height = panel_width * columns, panel_height * rows
    if width > 4096 or height > 4096:
        raise ValueError(f"{name}: atlas exceeds 4096 pixels; choose a different packing")
    panels = [{"source": f"static/videos/{filename}",
               "x": (index % columns) * panel_width,
               "y": (index // columns) * panel_height,
               "width": sources[filename]["width"], "height": sources[filename]["height"],
               "poster": f"static/images/posters/{Path(filename).stem}.jpg"}
              for index, filename in enumerate(names)]
    destination = resolve_asset(repo, f"static/videos/optimized/{name}.mp4")
    recipe = {"crf": crf, "preset": "slow", "columns": columns, "frame_timing": "source-cfr",
              "sources": {filename: sources[filename]["sha256"] for filename in names}}
    info = {"src": relative(destination, repo), "width": width, "height": height,
            "fps": first["fps"], "frames": first["frames"],
            "duration_s": first["duration_s"], "source_bytes": sum(m["bytes"] for m in metadata),
            "panels": panels, "recipe": recipe}
    if not encode:
        print(f"{name}: {len(names)} panels → {width}×{height}, {first['frames']} frames")
        return info
    if not force and previous.get("recipe") == recipe and destination.is_file():
        validate_video(destination, first, width, height)
        if previous.get("output_sha256") == sha256(destination):
            print(f"Reuse verified atlas: {name}", flush=True)
            return previous
    filters = [f"[{index}:v]setpts=PTS-STARTPTS,setsar=1[p{index}]"
               for index in range(len(names))]
    layout = "|".join(f"{panel['x']}_{panel['y']}" for panel in panels)
    filters.append("".join(f"[p{index}]" for index in range(len(names))) +
                   f"xstack=inputs={len(names)}:layout={layout}:fill=white:shortest=1[stacked]")
    filters.append(f"[stacked]pad={width}:{height}:0:0:color=white[out]")
    command = ffmpeg_inputs([resolve_asset(repo, f"static/videos/{filename}") for filename in names])
    command += ["-filter_complex_threads", "2", "-filter_complex", ";".join(filters),
                "-map", "[out]", "-r", first["fps"], "-fps_mode", "cfr"] + encoder_options(crf)
    print(f"Encode {name}: {width}×{height}, CRF {crf}", flush=True)
    atomic_encode(command, destination)
    actual = validate_video(destination, first, width, height)
    info["output_bytes"] = actual["bytes"]
    info["output_sha256"] = sha256(destination)
    for panel in panels:
        panel["ssim"] = measure_ssim(resolve_asset(repo, panel["source"]), destination, panel)
    info["minimum_panel_ssim"] = min(panel["ssim"]["all"] for panel in panels)
    print(f"  {info['source_bytes']/1e6:.3f} → {info['output_bytes']/1e6:.3f} MB; "
          f"minimum panel SSIM {info['minimum_panel_ssim']:.6f}", flush=True)
    return info


def store_individual(repo: Path, filename: str, trial_dir: Path,
                     generated: Path, info: dict, *, replace_existing: bool = False) -> dict:
    """Keep rejected encodes outside the website while retaining their metrics."""
    destination = (resolve_asset(repo, f"static/videos/optimized/individual/{filename}")
                   if info["candidate_for_visual_review"] else trial_dir / filename)
    if generated.resolve() != destination.resolve():
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists() and not replace_existing:
            if sha256(destination) != info["output_sha256"]:
                raise ValueError(f"Refusing to overwrite a different generated trial: {destination}")
            generated.unlink()
        else:
            shutil.move(str(generated), str(destination))
    info.pop("src", None)
    info.pop("trial_path", None)
    if info["candidate_for_visual_review"]:
        info["src"] = relative(destination, repo)
    else:
        info["trial_path"] = str(destination.resolve())
    return info


def make_individual(repo: Path, filename: str, source: dict, crf: int,
                    encode: bool, force: bool, previous: dict, trial_dir: Path) -> dict:
    original = resolve_asset(repo, f"static/videos/{filename}")
    destination = trial_dir / filename
    recipe = {"crf": crf, "preset": "slow", "source_sha256": source["sha256"]}
    info = {"source": relative(original, repo),
            "source_bytes": source["bytes"], "width": source["width"],
            "height": source["height"], "fps": source["fps"], "frames": source["frames"],
            "duration_s": source["duration_s"], "recipe": recipe}
    if not encode:
        print(f"Compression trial: {filename}, {source['width']}×{source['height']}, CRF {crf}")
        return info
    previous_path = (resolve_asset(repo, previous["src"]) if previous.get("src") else
                     Path(previous["trial_path"]) if previous.get("trial_path") else None)
    if not force and previous.get("recipe") == recipe and previous_path and previous_path.is_file():
        validate_video(previous_path, source, source["width"], source["height"])
        if previous.get("output_sha256") == sha256(previous_path):
            print(f"Reuse verified trial: {filename}", flush=True)
            return store_individual(repo, filename, trial_dir, previous_path, dict(previous))
    print(f"Compression trial: {filename}", flush=True)
    command = ffmpeg_inputs([original]) + ["-map", "0:v:0"] + encoder_options(crf)
    atomic_encode(command, destination)
    actual = validate_video(destination, source, source["width"], source["height"])
    info["output_bytes"] = actual["bytes"]
    info["output_sha256"] = sha256(destination)
    info["saving_fraction"] = 1 - actual["bytes"] / source["bytes"]
    info["ssim"] = measure_ssim(original, destination)
    # This is only a review candidate, not automatic adoption or a visual guarantee.
    info["candidate_for_visual_review"] = info["saving_fraction"] >= 0.1 and info["ssim"]["all"] >= 0.98
    print(f"  {source['bytes']/1e6:.3f} → {actual['bytes']/1e6:.3f} MB; "
          f"SSIM {info['ssim']['all']:.6f}; candidate={info['candidate_for_visual_review']}", flush=True)
    # The caller can review suitable sidecars before changing website references.
    return store_individual(repo, filename, trial_dir, destination, info, replace_existing=True)


def write_manifest(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".partial.json")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--encode", action="store_true")
    parser.add_argument("--force", action="store_true", help="Rebuild generated sidecars")
    parser.add_argument("--crf", type=int, default=21)
    parser.add_argument("--groups", nargs="*", help="Limit atlas builds to these named groups")
    parser.add_argument("--skip-posters", action="store_true")
    parser.add_argument("--skip-individuals", action="store_true")
    parser.add_argument("--trial-dir", type=Path,
                        help="External directory for rejected trials (default: ../relift3d-compression-trials)")
    args = parser.parse_args()
    if not 0 <= args.crf <= 51:
        parser.error("CRF must be between 0 and 51")
    selected = list(GROUPS) if args.groups is None else args.groups
    if any(name not in GROUPS for name in selected):
        parser.error("Unknown group name")
    repo = args.repo.resolve()
    trial_dir = (args.trial_dir or repo.parent / "relift3d-compression-trials").resolve()
    if trial_dir.is_relative_to(repo):
        parser.error("--trial-dir must be outside the website repository")
    media = repo / "static/videos"
    manifest_path = media / "optimized/manifest.json"
    previous = json.loads(manifest_path.read_text()) if manifest_path.is_file() else {}
    discovered = find_assets(repo, "static/videos", "*.mp4")
    names = sorted(set(previous.get("sources", {})) | {Path(name).name for name in discovered})
    originals = [resolve_asset(repo, f"static/videos/{name}") for name in names]
    sources = {path.name: {**probe(path), "sha256": sha256(path)} for path in originals}
    for filename, original in previous.get("sources", {}).items():
        if sources[filename]["sha256"] != original["sha256"]:
            raise ValueError(f"Original media differs from the recorded integrity hash: {filename}")
    manifest = {"version": 1, "quality_note": "SSIM is measured on all frames; visual review remains required.",
                "sources": sources, "groups": dict(previous.get("groups", {})),
                "individuals": dict(previous.get("individuals", {})),
                "posters": dict(previous.get("posters", {}))}

    def save_progress() -> None:
        if args.encode:
            write_manifest(manifest_path, manifest)

    if not args.skip_posters:
        for original in originals:
            destination = resolve_asset(repo, f"static/images/posters/{original.stem}.jpg")
            old = previous.get("posters", {}).get(original.name, {})
            recipe = {"source_sha256": sources[original.name]["sha256"], "max_width": 640, "jpeg_quality": 2}
            entry = {"src": relative(destination, repo), "recipe": recipe}
            if args.encode:
                if args.force or old.get("recipe") != recipe or not destination.is_file():
                    command = ffmpeg_inputs([original]) + ["-frames:v", "1", "-vf",
                        "scale=w='min(640,iw)':h=-1:flags=lanczos", "-q:v", "2", "-update", "1"]
                    atomic_encode(command, destination)
                entry["bytes"] = destination.stat().st_size
            manifest["posters"][original.name] = entry
        print(f"{'Built' if args.encode else 'Plan'} {len(originals)} first-frame posters", flush=True)
        save_progress()

    for name in selected:
        manifest["groups"][name] = make_group(repo, name, GROUPS[name], sources, args.crf,
                                             args.encode, args.force, previous.get("groups", {}).get(name, {}))
        save_progress()
    if not args.skip_individuals:
        grouped = {filename for names in GROUPS.values() for filename in names}
        for filename in sorted(sources.keys() - grouped):
            manifest["individuals"][filename] = make_individual(
                repo, filename, sources[filename], args.crf, args.encode, args.force,
                previous.get("individuals", {}).get(filename, {}), trial_dir)
            save_progress()
    manifest["totals"] = {
        "original_video_bytes": sum(item["bytes"] for item in sources.values()),
        "group_source_bytes": sum(group["source_bytes"] for group in manifest["groups"].values()),
        "atlas_bytes": sum(group.get("output_bytes", 0) for group in manifest["groups"].values()),
        "individual_trial_bytes": sum(item.get("output_bytes", 0) for item in manifest["individuals"].values()),
        "individual_website_bytes": sum(item.get("output_bytes", 0) for item in manifest["individuals"].values() if item.get("src")),
        "rejected_trial_bytes": sum(item.get("output_bytes", 0) for item in manifest["individuals"].values() if item.get("trial_path")),
        "poster_bytes": sum(item.get("bytes", 0) for item in manifest["posters"].values()),
    }
    save_progress()
    print(json.dumps(manifest["totals"], indent=2), flush=True)
    print(f"{'Wrote ' + str(manifest_path) if args.encode else 'Plan only; no files written.'}")


if __name__ == "__main__":
    main()
