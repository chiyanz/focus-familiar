#!/usr/bin/env swift

import AppKit
import Foundation
import ImageIO
import UniformTypeIdentifiers

private let alphaOpaqueThreshold: UInt8 = 240
private let searchRadius = 3
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
      guard processed.addedOutlinePixels == 0 else {
        throw SpriteError.validationFailed(
          inputPath,
          "\(processed.addedOutlinePixels) silhouette pixels still need the polished outline"
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
  var clearedTransparentPixels = 0
  var addedOutlinePixels = 0
  var recoloredCanvasEdgePixels = 0

  for y in 0 ..< height {
    for x in 0 ..< width {
      let offset = pixelOffset(x: x, y: y, width: width)
      let alpha = original[offset + 3]

      if alpha == 0 {
        transparentPixels += 1
        if pixels[offset] != 0 || pixels[offset + 1] != 0 || pixels[offset + 2] != 0 {
          clearedTransparentPixels += 1
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

  // The source sprites use hard alpha, so pale silhouette pixels can touch a
  // dark desktop directly and read as a white fringe. Add one consistent
  // pixel of the existing dark-brown line color outside the silhouette. The
  // original opaque artwork and canvas dimensions remain unchanged.
  for y in 0 ..< height {
    for x in 0 ..< width {
      let offset = pixelOffset(x: x, y: y, width: width)
      guard original[offset + 3] == 0 else { continue }
      guard touchesUnoutlinedOpaquePixel(
        x: x,
        y: y,
        pixels: original,
        width: width,
        height: height
      ) else { continue }

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
    clearedTransparentPixels: clearedTransparentPixels,
    addedOutlinePixels: addedOutlinePixels,
    recoloredCanvasEdgePixels: recoloredCanvasEdgePixels
  )
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

func touchesUnoutlinedOpaquePixel(
  x: Int,
  y: Int,
  pixels: [UInt8],
  width: Int,
  height: Int
) -> Bool {
  for sampleY in max(0, y - 1) ... min(height - 1, y + 1) {
    for sampleX in max(0, x - 1) ... min(width - 1, x + 1) {
      guard sampleX != x || sampleY != y else { continue }
      let offset = pixelOffset(x: sampleX, y: sampleY, width: width)
      guard pixels[offset + 3] >= alphaOpaqueThreshold else { continue }
      let isExistingPolishedOutline = pixels[offset] == outlineColor.red
        && pixels[offset + 1] == outlineColor.green
        && pixels[offset + 2] == outlineColor.blue
      if !isExistingPolishedOutline { return true }
    }
  }
  return false
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
