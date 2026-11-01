#!/usr/bin/env node
/* Verify the optimized trajectory buffers against the original segment-list
 * representation, using all checked-in scenes and explicit missing-track cases.
 * Run from any directory: node /path/to/repo/tools/validate_viewer.cjs
 * Uses only Node built-ins; it does not load a browser or require Git history.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {buildTrajectoryBuffers} = require('../static/js/relift-viewer.js');

// The previous viewer appended complete segments to ordinary arrays, then
// converted them to float32. Keep that simple representation as the reference.
function reference(tracks, colors, frames, points) {
  const pos = [], col = [], at = [], starts = [0];
  for (let frame = 1; frame < frames; frame++) {
    for (let point = 0; point < points; point++) {
      const previous = ((frame - 1) * points + point) * 3;
      const current = (frame * points + point) * 3;
      if (!Number.isFinite(tracks[previous]) || !Number.isFinite(tracks[current])) continue;
      pos.push(...tracks.subarray(previous, previous + 3), ...tracks.subarray(current, current + 3));
      col.push(...colors[point], ...colors[point]);
      at.push(frame, frame);
    }
    starts.push(pos.length / 3);
  }
  return {pos: Float32Array.from(pos), col: Float32Array.from(col), at: Float32Array.from(at), segStart: Uint32Array.from(starts)};
}

function compare(name, tracks, colors, frames, points) {
  const expected = reference(tracks, colors, frames, points);
  const actual = buildTrajectoryBuffers(tracks, colors, frames, points);
  for (const key of Object.keys(expected)) {
    assert.equal(actual[key].constructor, expected[key].constructor, `${name}: ${key} type`);
    const bytes = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    assert.deepEqual(bytes(actual[key]), bytes(expected[key]), `${name}: ${key} bytes`);
  }
  return actual.at.length / 2;
}

function decodeHalfTracks(encoded) {
  const bytes = Buffer.from(encoded, 'base64');
  const values = new Float32Array(bytes.length / 2);
  for (let i = 0; i < values.length; i++) {
    const half = bytes.readUInt16LE(i * 2);
    const sign = half & 0x8000 ? -1 : 1, exponent = (half >>> 10) & 31, fraction = half & 1023;
    values[i] = exponent === 31 ? (fraction ? NaN : sign * Infinity)
      : sign * (exponent === 0 ? 2 ** -24 * fraction : 2 ** (exponent - 15) * (1 + fraction / 1024));
  }
  return values;
}

function colorsFor(points) {
  const clamp = value => Math.max(0, Math.min(1, value));
  return Array.from({length: points}, (_, index) => {
    const x = points > 1 ? index / (points - 1) : 0;
    return [3, 2, 1].map(offset => clamp(1.5 - Math.abs(4 * x - offset)));
  });
}

// Missing observations must break trails, including gaps at the first or last
// frame; a single observation has no line segment. Signed zero is preserved.
const missing = Float32Array.from([
  -0, 1, 2, NaN, NaN, NaN,
  3, 4, 5, 6, 7, 8,
  NaN, NaN, NaN, 9, 10, 11,
  12, 13, 14, Infinity, Infinity, Infinity,
]);
assert.equal(compare('missing observations', missing, colorsFor(2), 4, 2), 2);
assert.equal(compare('single frame', Float32Array.of(0, 1, 2), colorsFor(1), 1, 1), 0);

const directory = path.resolve(__dirname, '../static/data');
const files = fs.readdirSync(directory).filter(file => file.endsWith('.js')).sort();
assert.ok(files.length > 0, 'No scene data found');
let segments = 0;
for (const file of files) {
  const context = {window: {}};
  vm.runInNewContext(fs.readFileSync(path.join(directory, file), 'utf8'), context, {filename: file});
  const scenes = Object.values(context.window.SUPP || {});
  assert.equal(scenes.length, 1, `${file}: expected one scene`);
  const data = scenes[0], {T: frames, Q: points} = data.meta;
  const tracks = decodeHalfTracks(data.tracks);
  assert.equal(tracks.length, frames * points * 3, `${file}: track shape`);
  const count = compare(file, tracks, colorsFor(points), frames, points);
  segments += count;
  console.log(`${file}: ${count} segments, exact buffer match`);
}
console.log(`PASS: ${files.length} scenes, ${segments} segments, plus missing-track and single-frame cases.`);
