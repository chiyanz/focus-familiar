#!/usr/bin/env swift

import AppKit
import Foundation
import ImageIO
import UniformTypeIdentifiers

// The idle-loop PNGs share a 384x512 canvas. The anchor is expressed in
// top-left image coordinates so it remains easy to compare with an editor or
// an exported contact sheet: the silhouette should be centered at x=192 and
// rest on y=460. Only integer translation is applied; the generated artwork
// is not rescaled or otherwise filtered.
private let targetCenterX = 192.0
private let targetBaselineY = 460
private let centerTolerance = 1.0
private let baselineTolerance = 1

private struct Bounds {
  let minX: Int
  let maxX: Int
  let minY: Int
  let maxY: Int

  var centerX: Double {
    Double(minX + maxX) / 2
  }

  var baselineY: Int {
    maxY
  }
}

private struct DecodedSprite {
  let url: URL
  let width: Int
  let height: Int
  let pixels: [UInt8]
  let bounds: Bounds
  let transparentRGBPixels: Int
}

private enum SpriteError: LocalizedError {
  case invalidArguments
  case unreadableImage(String)
  case contextCreationFailed(String)
  case encodingFailed(String)
  case invalidCanvas(String, Int, Int)
  case emptySprite(String)
  case outOfBounds(String, Int, Int)
  case validationFailed(String, String)

  var errorDescription: String? {
    switch self {
    case .invalidArguments:
      return "Usage: swift scripts/normalize-idle-loop.swift [--in-place | --check] PNG [PNG ...]"
    case let .unreadableImage(path):
      return "Could not decode PNG: \(path)"
    case let .contextCreationFailed(path):
      return "Could not create an RGBA bitmap for: \(path)"
    case let .encodingFailed(path):
      return "Could not encode normalized PNG: \(path)"
    case let .invalidCanvas(path, width, height):
      return "Idle-loop sprite must use a 384x512 canvas: \(path) is \(width)x\(height)"
    case let .emptySprite(path):
      return "Idle-loop sprite has no visible pixels: \(path)"
    case let .outOfBounds(path, dx, dy):
      return "Normalizing \(path) would move artwork outside the canvas (dx=\(dx), dy=\(dy))"
    case let .validationFailed(path, reason):
      return "Idle-loop alignment validation failed for \(path): \(reason)"
    }
  }
}

let arguments = Array(CommandLine.arguments.dropFirst())
let inPlace = arguments.contains("--in-place")
let checkOnly = arguments.contains("--check")
let inputPaths = arguments.filter { $0 != "--in-place" && $0 != "--check" }

guard !inputPaths.isEmpty, inPlace != checkOnly else {
  fputs("\(SpriteError.invalidArguments.localizedDescription)\n", stderr)
  exit(2)
}

do {
  for inputPath in inputPaths {
    let sprite = try decodeSprite(at: URL(fileURLWithPath: inputPath))
    guard sprite.width == 384, sprite.height == 512 else {
      throw SpriteError.invalidCanvas(inputPath, sprite.width, sprite.height)
    }

    let centerDelta = abs(sprite.bounds.centerX - targetCenterX)
    let baselineDelta = abs(sprite.bounds.baselineY - targetBaselineY)

    if checkOnly {
      guard sprite.transparentRGBPixels == 0 else {
        throw SpriteError.validationFailed(
          inputPath,
          "\(sprite.transparentRGBPixels) fully transparent pixels contain non-zero RGB data"
        )
      }
      guard centerDelta <= centerTolerance else {
        throw SpriteError.validationFailed(
          inputPath,
          "silhouette center x=\(format(sprite.bounds.centerX)); expected \(format(targetCenterX)) ± \(format(centerTolerance))"
        )
      }
      guard baselineDelta <= baselineTolerance else {
        throw SpriteError.validationFailed(
          inputPath,
          "silhouette baseline y=\(sprite.bounds.baselineY); expected \(targetBaselineY) ± \(baselineTolerance)"
        )
      }
      print(
        "Verified \(sprite.url.lastPathComponent): "
          + "center x=\(format(sprite.bounds.centerX)), baseline y=\(sprite.bounds.baselineY)"
      )
      continue
    }

    // Use ties-to-even so a half-pixel center does not oscillate by one pixel
    // when an already-normalized PNG is processed again.
    let dx = Int((targetCenterX - sprite.bounds.centerX).rounded(.toNearestOrEven))
    let dy = targetBaselineY - sprite.bounds.baselineY
    guard
      sprite.bounds.minX + dx >= 0,
      sprite.bounds.maxX + dx < sprite.width,
      sprite.bounds.minY + dy >= 0,
      sprite.bounds.maxY + dy < sprite.height
    else {
      throw SpriteError.outOfBounds(inputPath, dx, dy)
    }

    let normalizedData = try normalizedPNG(for: sprite, dx: dx, dy: dy)
    try normalizedData.write(to: sprite.url, options: .atomic)
    print(
      "Normalized \(sprite.url.lastPathComponent): "
        + "dx=\(dx), dy=\(dy), "
        + "center x=\(format(sprite.bounds.centerX + Double(dx))), "
        + "baseline y=\(sprite.bounds.baselineY + dy)"
    )
  }
} catch {
  fputs("\(error.localizedDescription)\n", stderr)
  exit(1)
}

private func decodeSprite(at url: URL) throws -> DecodedSprite {
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

  var minX = width
  var maxX = -1
  var minY = height
  var maxY = -1
  var transparentRGBPixels = 0

  for y in 0 ..< height {
    for x in 0 ..< width {
      let offset = pixelOffset(x: x, y: y, width: width)
      let alpha = pixels[offset + 3]
      if alpha == 0 {
        if pixels[offset] != 0 || pixels[offset + 1] != 0 || pixels[offset + 2] != 0 {
          transparentRGBPixels += 1
        }
        continue
      }

      minX = min(minX, x)
      maxX = max(maxX, x)
      minY = min(minY, y)
      maxY = max(maxY, y)
    }
  }

  guard maxX >= 0 else {
    throw SpriteError.emptySprite(url.path)
  }

  return DecodedSprite(
    url: url,
    width: width,
    height: height,
    pixels: pixels,
    bounds: Bounds(minX: minX, maxX: maxX, minY: minY, maxY: maxY),
    transparentRGBPixels: transparentRGBPixels
  )
}

private func normalizedPNG(for sprite: DecodedSprite, dx: Int, dy: Int) throws -> Data {
  let bytesPerRow = sprite.width * 4
  var pixels = [UInt8](repeating: 0, count: bytesPerRow * sprite.height)

  for y in 0 ..< sprite.height {
    for x in 0 ..< sprite.width {
      let sourceOffset = pixelOffset(x: x, y: y, width: sprite.width)
      guard sprite.pixels[sourceOffset + 3] > 0 else { continue }

      let targetX = x + dx
      let targetY = y + dy
      guard
        targetX >= 0,
        targetX < sprite.width,
        targetY >= 0,
        targetY < sprite.height
      else {
        throw SpriteError.outOfBounds(sprite.url.path, dx, dy)
      }

      let targetOffset = pixelOffset(x: targetX, y: targetY, width: sprite.width)
      pixels[targetOffset] = sprite.pixels[sourceOffset]
      pixels[targetOffset + 1] = sprite.pixels[sourceOffset + 1]
      pixels[targetOffset + 2] = sprite.pixels[sourceOffset + 2]
      pixels[targetOffset + 3] = sprite.pixels[sourceOffset + 3]
    }
  }

  let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)
    ?? CGColorSpaceCreateDeviceRGB()
  let bitmapInfo = CGBitmapInfo.byteOrder32Big.rawValue
    | CGImageAlphaInfo.premultipliedLast.rawValue

  guard
    let context = CGContext(
      data: &pixels,
      width: sprite.width,
      height: sprite.height,
      bitsPerComponent: 8,
      bytesPerRow: bytesPerRow,
      space: colorSpace,
      bitmapInfo: bitmapInfo
    ),
    let image = context.makeImage()
  else {
    throw SpriteError.contextCreationFailed(sprite.url.path)
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
    throw SpriteError.encodingFailed(sprite.url.path)
  }

  CGImageDestinationAddImage(destination, image, nil)
  guard CGImageDestinationFinalize(destination) else {
    throw SpriteError.encodingFailed(sprite.url.path)
  }
  return outputData as Data
}

private func pixelOffset(x: Int, y: Int, width: Int) -> Int {
  (y * width + x) * 4
}

private func format(_ value: Double) -> String {
  String(format: "%.1f", value)
}
