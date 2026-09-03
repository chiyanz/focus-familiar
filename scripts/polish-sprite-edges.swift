#!/usr/bin/env swift

import AppKit
import Foundation
import ImageIO
import UniformTypeIdentifiers

private let alphaOpaqueThreshold: UInt8 = 240
private let searchRadius = 3
private let outlineRadius = 4
private let outlineColor: (red: UInt8, green: UInt8, blue: UInt8) = (106, 53, 25)

struct ProcessedSprite {
  let data: Data
  let width: Int
  let height: Int
  let partialAlphaPixels: Int
  let recoloredPixels: Int
  let transparentPixels: Int
  let clearedTransparentPixels: Int
  let addedOutlinePixels: Int
  let recoloredCanvasEdgePixels: Int
}

enum SpriteError: LocalizedError {
  case invalidArguments
  case unreadableImage(String)
  case contextCreationFailed(String)
  case encodingFailed(String)
  case validationFailed(String, String)

  var errorDescription: String? {
    switch self {
    case .invalidArguments:
      return "Usage: swift scripts/polish-sprite-edges.swift [--in-place | --check] PNG [PNG ...]"
    case let .unreadableImage(path):
      return "Could not decode PNG: \(path)"
    case let .contextCreationFailed(path):
      return "Could not create an RGBA bitmap for: \(path)"
    case let .encodingFailed(path):
      return "Could not encode polished PNG: \(path)"
    case let .validationFailed(path, reason):
      return "Sprite edge validation failed for \(path): \(reason)"
    }
  }
}

let arguments = Array(CommandLine.arguments.dropFirst())
let inPlace = arguments.contains("--in-place")
let checkOnly = arguments.contains("--check")
let inputPaths = arguments.filter { $0 != "--in-place" && $0 != "--check" }

guard !inputPaths.isEmpty, !(inPlace && checkOnly) else {
  fputs("\(SpriteError.invalidArguments.localizedDescription)\n", stderr)
  exit(2)
}

do {
  for inputPath in inputPaths {
    let inputURL = URL(fileURLWithPath: inputPath)
    let outputURL = inPlace ? inputURL : previewURL(for: inputURL)
    let processed = try polishSprite(at: inputURL)

    if checkOnly {
      guard processed.transparentPixels > 0 else {
        throw SpriteError.validationFailed(inputPath, "the background is not transparent")
      }
      guard processed.clearedTransparentPixels == 0 else {
        throw SpriteError.validationFailed(
          inputPath,
          "\(processed.clearedTransparentPixels) fully transparent pixels contain non-zero RGB data"
        )
      }
      guard processed.addedOutlinePixels == 0 else {
        throw SpriteError.validationFailed(
          inputPath,
          "\(processed.addedOutlinePixels) silhouette pixels still need the \(outlineRadius)-pixel polished outline"
        )
      }
      guard processed.recoloredPixels == 0 else {
        throw SpriteError.validationFailed(
          inputPath,
          "\(processed.recoloredPixels) translucent edge pixels still need color cleanup"
        )
      }
      guard processed.recoloredCanvasEdgePixels == 0 else {
        throw SpriteError.validationFailed(
          inputPath,
          "\(processed.recoloredCanvasEdgePixels) cropped canvas-edge pixels still need the polished outline"
        )
      }
      print(
        "Verified \(inputURL.lastPathComponent): "
          + "\(processed.width)x\(processed.height), transparent background, polished outline"
      )
      continue
    }

    try processed.data.write(to: outputURL, options: .atomic)
    print(
      "Polished \(inputURL.lastPathComponent): "
        + "\(processed.width)x\(processed.height), "
        + "\(processed.recoloredPixels)/\(processed.partialAlphaPixels) edge pixels recolored, "
        + "\(processed.addedOutlinePixels) outline pixels added, "
        + "\(processed.recoloredCanvasEdgePixels) canvas-edge pixels recolored, "
        + "\(processed.transparentPixels) transparent pixels retained -> "
        + outputURL.path
    )
  }
} catch {
  fputs("\(error.localizedDescription)\n", stderr)
  exit(1)
}

func polishSprite(at url: URL) throws -> ProcessedSprite {
  guard
    let source = CGImageSourceCreateWithURL(url as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
  else {
    throw SpriteError.unreadableImage(url.path)
  }

  let width = image.width
  let height = image.height
  let bytesPerRow = width * 4
  var pixels = [UInt8](repeating: 0, count: bytesPerRow * height)
  let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)
    ?? CGColorSpaceCreateDeviceRGB()
  let bitmapInfo = CGBitmapInfo.byteOrder32Big.rawValue
    | CGImageAlphaInfo.premultipliedLast.rawValue

  guard
    let context = CGContext(
      data: &pixels,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: bytesPerRow,
      space: colorSpace,
      bitmapInfo: bitmapInfo
    )
  else {
    throw SpriteError.contextCreationFailed(url.path)
  }

  context.interpolationQuality = .none
  context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
  let original = pixels
  var partialAlphaPixels = 0
  var recoloredPixels = 0
  var transparentPixels = 0
  let sourceTransparentRGBPixels = countRawTransparentRGBPixels(in: image)
  var convertedTransparentRGBPixels = 0
  var addedOutlinePixels = 0
  var recoloredCanvasEdgePixels = 0

  for y in 0 ..< height {
    for x in 0 ..< width {
      let offset = pixelOffset(x: x, y: y, width: width)
      let alpha = original[offset + 3]

      if alpha == 0 {
        transparentPixels += 1
        if pixels[offset] != 0 || pixels[offset + 1] != 0 || pixels[offset + 2] != 0 {
          convertedTransparentRGBPixels += 1
        }
        pixels[offset] = 0
        pixels[offset + 1] = 0
        pixels[offset + 2] = 0
        continue
      }

      guard alpha < 255 else { continue }
      partialAlphaPixels += 1

      guard
        let replacement = nearestInteriorColor(
          x: x,
          y: y,
          pixels: original,
          width: width,
          height: height
        )
      else { continue }

      let red = premultiply(replacement.red, by: alpha)
      let green = premultiply(replacement.green, by: alpha)
      let blue = premultiply(replacement.blue, by: alpha)

      if red != pixels[offset] || green != pixels[offset + 1] || blue != pixels[offset + 2] {
        recoloredPixels += 1
      }
      pixels[offset] = red
      pixels[offset + 1] = green
      pixels[offset + 2] = blue
    }
  }
  let exteriorTransparency = exteriorTransparentMask(
    pixels: original,
    width: width,
    height: height
  )

  // Cropped reaction art can touch a canvas boundary, where there is no room
  // to add an exterior pixel. Color only those outermost opaque pixels with
  // the same contour color so a pale vertical or horizontal seam cannot leak
  // against a dark background.
  for y in 0 ..< height {
    recoloredCanvasEdgePixels += polishCanvasEdgePixel(
      x: 0,
      y: y,
      pixels: &pixels,
      width: width
    )
    if width > 1 {
      recoloredCanvasEdgePixels += polishCanvasEdgePixel(
        x: width - 1,
        y: y,
        pixels: &pixels,
        width: width
      )
    }
  }
  if height > 1 {
    for x in 1 ..< max(1, width - 1) {
      recoloredCanvasEdgePixels += polishCanvasEdgePixel(
        x: x,
        y: 0,
        pixels: &pixels,
        width: width
      )
      recoloredCanvasEdgePixels += polishCanvasEdgePixel(
        x: x,
        y: height - 1,
        pixels: &pixels,
        width: width
      )
    }
  }

  // Build the contour from non-contour artwork, rather than from the current
  // alpha mask. That makes this pass idempotent: the cocoa pixels it adds are
  // excluded from the next run, so the border cannot grow on repeated runs.
  var coreArtwork = [Bool](repeating: false, count: width * height)
  for y in 0 ..< height {
    for x in 0 ..< width {
      coreArtwork[y * width + x] = isCoreArtworkPixel(
        x: x,
        y: y,
        pixels: original,
        width: width
      )
    }
  }

  var requiredOutline = [Bool](repeating: false, count: width * height)
  for y in 0 ..< height {
    for x in 0 ..< width {
      guard coreArtwork[y * width + x] else { continue }
      for sampleY in max(0, y - outlineRadius) ... min(height - 1, y + outlineRadius) {
        for sampleX in max(0, x - outlineRadius) ... min(width - 1, x + outlineRadius) {
          requiredOutline[sampleY * width + sampleX] = true
        }
      }
    }
  }

  // Downscaling can skip a one-pixel contour. Add a deterministic four
  // source-pixel cocoa contour around the non-outline silhouette. The
  // Chebyshev radius matches the existing 8-neighbour pixel-art edge rule,
  // including diagonals at rounded corners.
  for y in 0 ..< height {
    for x in 0 ..< width {
      let offset = pixelOffset(x: x, y: y, width: width)
      guard original[offset + 3] == 0 else { continue }
      guard exteriorTransparency[y * width + x] else { continue }
      guard requiredOutline[y * width + x] else { continue }

      pixels[offset] = outlineColor.red
      pixels[offset + 1] = outlineColor.green
      pixels[offset + 2] = outlineColor.blue
      pixels[offset + 3] = 255
      addedOutlinePixels += 1
    }
  }

  guard let outputContext = CGContext(
    data: &pixels,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: bytesPerRow,
    space: colorSpace,
    bitmapInfo: bitmapInfo
  ), let polishedImage = outputContext.makeImage()
  else {
    throw SpriteError.contextCreationFailed(url.path)
  }

  let outputData = NSMutableData()
  guard
    let destination = CGImageDestinationCreateWithData(
      outputData,
      UTType.png.identifier as CFString,
      1,
      nil
    )
  else {
    throw SpriteError.encodingFailed(url.path)
  }

  CGImageDestinationAddImage(destination, polishedImage, nil)
  guard CGImageDestinationFinalize(destination) else {
    throw SpriteError.encodingFailed(url.path)
  }

  return ProcessedSprite(
    data: outputData as Data,
    width: width,
    height: height,
    partialAlphaPixels: partialAlphaPixels,
    recoloredPixels: recoloredPixels,
    transparentPixels: transparentPixels,
    clearedTransparentPixels: max(sourceTransparentRGBPixels, convertedTransparentRGBPixels),
    addedOutlinePixels: addedOutlinePixels,
    recoloredCanvasEdgePixels: recoloredCanvasEdgePixels
  )
}

// A premultiplied bitmap context turns RGB channels to zero when alpha is
// zero. Inspect the decoded image's original provider as well, otherwise a
// stale PNG can hide a white matte from the validator while it is being
// normalized for output.
func countRawTransparentRGBPixels(in image: CGImage) -> Int {
  guard
    image.bitsPerComponent == 8,
    image.bitsPerPixel >= 32,
    let provider = image.dataProvider,
    let data = provider.data,
    let pointer = CFDataGetBytePtr(data)
  else { return 0 }

  let bytesPerPixel = image.bitsPerPixel / 8
  let bytesPerRow = image.bytesPerRow > 0 ? image.bytesPerRow : image.width * bytesPerPixel
  let alphaInfo = image.alphaInfo
  let alphaOffset: Int
  let redOffset: Int
  let greenOffset: Int
  let blueOffset: Int

  switch alphaInfo {
  case .last, .premultipliedLast:
    alphaOffset = 3
    redOffset = 0
    greenOffset = 1
    blueOffset = 2
  case .first, .premultipliedFirst:
    alphaOffset = 0
    redOffset = 1
    greenOffset = 2
    blueOffset = 3
  default:
    return 0
  }

  let length = CFDataGetLength(data)
  var count = 0
  for y in 0 ..< image.height {
    let rowOffset = y * bytesPerRow
    for x in 0 ..< image.width {
      let offset = rowOffset + x * bytesPerPixel
      guard offset + alphaOffset < length else { return count }
      guard pointer[offset + alphaOffset] == 0 else { continue }
      guard
        offset + blueOffset < length,
        pointer[offset + redOffset] != 0
          || pointer[offset + greenOffset] != 0
          || pointer[offset + blueOffset] != 0
      else { continue }
      count += 1
    }
  }
  return count
}

func polishCanvasEdgePixel(
  x: Int,
  y: Int,
  pixels: inout [UInt8],
  width: Int
) -> Int {
  let offset = pixelOffset(x: x, y: y, width: width)
  guard pixels[offset + 3] > 0 else { return 0 }
  guard
    pixels[offset] != outlineColor.red
      || pixels[offset + 1] != outlineColor.green
      || pixels[offset + 2] != outlineColor.blue
  else { return 0 }

  pixels[offset] = outlineColor.red
  pixels[offset + 1] = outlineColor.green
  pixels[offset + 2] = outlineColor.blue
  return 1
}

func isCoreArtworkPixel(
  x: Int,
  y: Int,
  pixels: [UInt8],
  width: Int
) -> Bool {
  let offset = pixelOffset(x: x, y: y, width: width)
  let alpha = pixels[offset + 3]
  guard alpha >= alphaOpaqueThreshold else { return false }

  let red = unpremultiply(pixels[offset], by: alpha)
  let green = unpremultiply(pixels[offset + 1], by: alpha)
  let blue = unpremultiply(pixels[offset + 2], by: alpha)
  return red != outlineColor.red
    || green != outlineColor.green
    || blue != outlineColor.blue
}

// Only exterior transparency receives a silhouette contour. Closed holes in
// future artwork remain transparent instead of being accidentally filled.
func exteriorTransparentMask(
  pixels: [UInt8],
  width: Int,
  height: Int
) -> [Bool] {
  var exterior = [Bool](repeating: false, count: width * height)
  var queue: [Int] = []

  func enqueueIfTransparent(_ x: Int, _ y: Int) {
    let index = y * width + x
    guard !exterior[index] else { return }
    let offset = pixelOffset(x: x, y: y, width: width)
    guard pixels[offset + 3] == 0 else { return }
    exterior[index] = true
    queue.append(index)
  }

  for x in 0 ..< width {
    enqueueIfTransparent(x, 0)
    if height > 1 { enqueueIfTransparent(x, height - 1) }
  }
  if width > 1 {
    for y in 1 ..< max(1, height - 1) {
      enqueueIfTransparent(0, y)
      enqueueIfTransparent(width - 1, y)
    }
  }

  var queueIndex = 0
  while queueIndex < queue.count {
    let index = queue[queueIndex]
    queueIndex += 1
    let x = index % width
    let y = index / width

    if x > 0 { enqueueIfTransparent(x - 1, y) }
    if x + 1 < width { enqueueIfTransparent(x + 1, y) }
    if y > 0 { enqueueIfTransparent(x, y - 1) }
    if y + 1 < height { enqueueIfTransparent(x, y + 1) }
  }

  return exterior
}

func nearestInteriorColor(
  x: Int,
  y: Int,
  pixels: [UInt8],
  width: Int,
  height: Int
) -> (red: UInt8, green: UInt8, blue: UInt8)? {
  for radius in 1 ... searchRadius {
    var candidate: (red: UInt8, green: UInt8, blue: UInt8)?
    var candidateLuminance = Int.max

    for sampleY in max(0, y - radius) ... min(height - 1, y + radius) {
      for sampleX in max(0, x - radius) ... min(width - 1, x + radius) {
        guard
          abs(sampleX - x) == radius || abs(sampleY - y) == radius
        else { continue }

        let offset = pixelOffset(x: sampleX, y: sampleY, width: width)
        let alpha = pixels[offset + 3]
        guard alpha >= alphaOpaqueThreshold else { continue }

        let red = unpremultiply(pixels[offset], by: alpha)
        let green = unpremultiply(pixels[offset + 1], by: alpha)
        let blue = unpremultiply(pixels[offset + 2], by: alpha)
        let luminance = 2126 * Int(red) + 7152 * Int(green) + 722 * Int(blue)

        // At equal distance, prefer the darker interior color. This retains
        // the intentional brown pixel outline rather than pulling pale fur
        // outward into the translucent boundary.
        if luminance < candidateLuminance {
          candidate = (red, green, blue)
          candidateLuminance = luminance
        }
      }
    }

    if let candidate { return candidate }
  }

  return nil
}

func pixelOffset(x: Int, y: Int, width: Int) -> Int {
  (y * width + x) * 4
}

func premultiply(_ color: UInt8, by alpha: UInt8) -> UInt8 {
  UInt8((Int(color) * Int(alpha) + 127) / 255)
}

func unpremultiply(_ color: UInt8, by alpha: UInt8) -> UInt8 {
  guard alpha > 0 else { return 0 }
  return UInt8(min(255, (Int(color) * 255 + Int(alpha) / 2) / Int(alpha)))
}

func previewURL(for inputURL: URL) -> URL {
  let stem = inputURL.deletingPathExtension().lastPathComponent
  return inputURL.deletingLastPathComponent()
    .appendingPathComponent("\(stem)-polished.png")
}
