/**
 * The manifest icon the plugin manager renders beside this plugin.
 *
 * The manager draws a manifest icon through an `<img>` (PackageArtwork in
 * dsh-client-ui-plugin-manager), which is an isolated document: `currentColor`
 * inside an SVG resolves to black, not to the surrounding UI colour. The icon's
 * first version was an SVG drawn entirely in `currentColor`, so on the dark
 * theme it painted black on a near-black surface and read as an empty tile.
 *
 * The icon is now a raster PNG generated with `image_generate` (gpt-image-2) and
 * post-processed: the generated white page background removed, the mark trimmed
 * and re-squared, then downscaled. `currentColor` cannot come back, and the
 * pixel checks below cover the two ways that post-processing went wrong while
 * looking correct at a glance:
 *
 *  - keying out "everything white" also deleted the white bars, leaving holes
 *    that showed the surface behind them, so the bars turned dark on dark;
 *  - committing the generator's raw output instead of the processed file ships
 *    an icon well over the manifest's size cap.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { inflateSync } from 'node:zlib'

/** The manifest admits at most 256 KiB per icon (package-meta.ts MAX_ICON_BYTES). */
const MAX_ICON_BYTES = 256 * 1024

const path = resolve('icon.png')
const bytes = readFileSync(path)

interface Rgba {
  width: number
  height: number
  /** Row-major RGBA pixels, four bytes each. */
  pixels: Buffer
}

/** The IHDR fields this spec reasons about. */
interface Ihdr {
  width: number
  height: number
  bitDepth: number
  colorType: number
  interlace: number
}

/** First chunk after the 8-byte signature must be IHDR: length, "IHDR", 13-byte payload. */
function readIhdr(png: Buffer): Ihdr {
  const length = png.readUInt32BE(8)
  const type = png.subarray(12, 16).toString('ascii')
  if (type !== 'IHDR') throw new Error(`first PNG chunk is ${type}, expected IHDR`)
  if (length !== 13) throw new Error(`IHDR length is ${length}, expected 13`)
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    bitDepth: png[24]!,
    colorType: png[25]!,
    interlace: png[28]!,
  }
}

/** PNG colour types 4 (grey+alpha) and 6 (RGBA) carry an alpha channel. */
const ALPHA_COLOR_TYPES = [4, 6]

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** The Paeth predictor from the PNG spec (filter type 4). */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/**
 * Decode an 8-bit RGBA PNG into raw pixels.
 *
 * Deliberately minimal and strict: it accepts exactly the format this icon
 * ships (8-bit, colour type 6, no interlace) and throws on anything else, so a
 * re-export through a different pipeline fails loudly instead of being skipped.
 * @param png - the whole PNG file.
 * @returns the decoded image.
 */
function decodeRgba(png: Buffer): Rgba {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG')
  const { width, height, bitDepth, colorType, interlace } = readIhdr(png)
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(`unsupported PNG: depth=${bitDepth} colorType=${colorType} interlace=${interlace}`)
  }
  let offset = 8
  const idat: Buffer[] = []
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.subarray(offset + 4, offset + 8).toString('ascii')
    const data = png.subarray(offset + 8, offset + 8 + length)
    if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * 4
  const pixels = Buffer.alloc(height * stride)
  let pos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]!
    const row = raw.subarray(pos, pos + stride)
    pos += stride
    const out = pixels.subarray(y * stride, (y + 1) * stride)
    const prior = y === 0 ? undefined : pixels.subarray((y - 1) * stride, y * stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? out[i - 4]! : 0
      const b = prior === undefined ? 0 : prior[i]!
      const c = i >= 4 && prior !== undefined ? prior[i - 4]! : 0
      const x = row[i]!
      out[i] = (x + (filter === 0 ? 0
        : filter === 1 ? a
          : filter === 2 ? b
            : filter === 3 ? Math.floor((a + b) / 2)
              : filter === 4 ? paeth(a, b, c)
                : (() => { throw new Error(`unknown PNG filter ${filter}`) })())) & 0xff
    }
  }
  return { width, height, pixels }
}

const header = readIhdr(bytes)

/**
 * The decoded image, or undefined when the file is not the 8-bit RGBA PNG this
 * spec can read. Resolved lazily so a wrong-format export fails the format
 * assertion with its own message instead of aborting the whole file at import.
 */
const decoded: Rgba | undefined = ALPHA_COLOR_TYPES.includes(header.colorType) && header.bitDepth === 8
  ? decodeRgba(bytes)
  : undefined

/** The decoded image, asserting the format the pixel specs require. */
function image(): Rgba {
  if (decoded === undefined) {
    throw new Error(`expected an 8-bit alpha PNG, got depth=${header.bitDepth} colorType=${header.colorType}`)
  }
  return decoded
}

/** One pixel as [r, g, b, a]. */
function at(img: Rgba, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4
  return [img.pixels[i]!, img.pixels[i + 1]!, img.pixels[i + 2]!, img.pixels[i + 3]!]
}

/** Count pixels matching a predicate. */
function count(img: Rgba, predicate: (r: number, g: number, b: number, a: number) => boolean): number {
  let total = 0
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const [r, g, b, a] = at(img, x, y)
      if (predicate(r, g, b, a)) total++
    }
  }
  return total
}

const isOpaqueWhite = (r: number, g: number, b: number, a: number): boolean =>
  a === 255 && r >= 245 && g >= 245 && b >= 245
const isOpaqueBlue = (r: number, g: number, b: number, a: number): boolean =>
  a === 255 && b > 180 && b > r + 40 && b > g + 20

describe('plugin icon', () => {
  it('is a PNG within the manifest size cap', () => {
    expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
    expect(bytes.length).toBeLessThanOrEqual(MAX_ICON_BYTES)
    expect(statSync(path).size).toBe(bytes.length)
  })

  it('is an 8-bit PNG with an alpha channel', () => {
    // Committing the generator's raw output fails here: gpt-image-2 returns
    // 8-bit RGB (colour type 2), with no alpha for the transparent background.
    expect(ALPHA_COLOR_TYPES).toContain(header.colorType)
    expect(header.bitDepth).toBe(8)
    expect(header.interlace).toBe(0)
  })

  it('is square and large enough to stay crisp in a 36px card', () => {
    expect(header.width).toBe(header.height)
    // 2x the largest surface (the 72px detail tile) plus headroom.
    expect(header.width).toBeGreaterThanOrEqual(144)
  })

  it('leaves the corners transparent, so the mark drops onto either theme', () => {
    const img = image()
    const corners = [
      at(img, 0, 0), at(img, img.width - 1, 0),
      at(img, 0, img.height - 1), at(img, img.width - 1, img.height - 1),
    ]
    for (const [, , , a] of corners) expect(a).toBe(0)
  })

  it('keeps the bars opaque white ink rather than holes punched through it', () => {
    // The failure this pins: keying out everything white also removed the white
    // bars, so transparency showed where the mark should be, and the bars went
    // dark on the dark theme. Bars must be opaque, not merely white-ish.
    const img = image()
    const white = count(img, (r, g, b) => isOpaqueWhite(r, g, b, 255))
    expect(white).toBeGreaterThan(img.width * img.height * 0.02)

    // And the tile behind them must survive too, or the mark is only outline.
    const blue = count(img, (r, g, b) => isOpaqueBlue(r, g, b, 255))
    expect(blue).toBeGreaterThan(img.width * img.height * 0.2)
  })

  it('has no transparent pixels inside the tile, where the mark lives', () => {
    // Sample the middle band, which the tile covers end to end. Any alpha 0
    // there is a hole in the mark.
    const img = image()
    const y = Math.floor(img.height / 2)
    let holes = 0
    for (let x = Math.floor(img.width * 0.2); x < Math.floor(img.width * 0.8); x++) {
      if (at(img, x, y)[3] === 0) holes++
    }
    expect(holes).toBe(0)
  })

  it('ships no SVG beside it, whose currentColor an <img> cannot resolve', () => {
    // The previous icon was icon.svg painted in currentColor; an isolated image
    // document resolves that to black on every theme. Keeping the SVG around
    // invites a manifest pointing back at it.
    expect(() => readFileSync(resolve('icon.svg'))).toThrow()
  })
})
