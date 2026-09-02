import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const maxImageBufferBytes = 16 * 1024 * 1024;

const sheets = [
  {
    source: "docs/design/assets/shokupan-cat-design-directions-v1.png",
    outputDirectory: "docs/design/assets/shokupan-cat/isolated/designs",
    width: 1774,
    height: 887,
    columns: 4,
    rows: 1,
    background: "warm",
    names: [
      "design-01-crust-cap",
      "design-02-pull-apart-milk",
      "design-03-marbled-toast",
      "design-04-black-sesame",
    ],
  },
  {
    source: "docs/design/assets/shokupan-cat/idle-action-keyposes-v1.png",
    outputDirectory: "docs/design/assets/shokupan-cat/isolated/idle-actions",
    width: 1536,
    height: 1024,
    columns: 4,
    rows: 2,
    background: "warm",
    names: [
      "idle-01-curled-sleep",
      "idle-02-paw-cover",
      "idle-03-slow-blink",
      "idle-04-kneading",
      "idle-05-forward-stretch",
      "idle-06-paw-groom",
      "idle-07-face-groom",
      "idle-08-blep-resettle",
    ],
  },
  {
    source: "docs/design/assets/shokupan-cat/idle-breathing-loop-v1.png",
    outputDirectory: "docs/design/assets/shokupan-cat/isolated/idle-loop",
    width: 1536,
    height: 1024,
    columns: 4,
    rows: 2,
    background: "checkerboard",
    names: [
      "loop-01-neutral",
      "loop-02-inhale-start",
      "loop-03-inhale-peak",
      "loop-04-exhale-start",
      "loop-05-ear-turn",
      "loop-06-ear-twitch",
      "loop-07-settle",
      "loop-08-close",
    ],
  },
  {
    source: "docs/design/assets/shokupan-cat/reaction-keyposes-v1.png",
    outputDirectory: "docs/design/assets/shokupan-cat/isolated/reactions",
    width: 1536,
    height: 1024,
    columns: 4,
    rows: 2,
    background: "warm",
    names: [
      "reaction-01-grace-glance",
      "reaction-02-corner-peek",
      "reaction-03-half-lens-stare",
      "reaction-04-side-eye",
      "reaction-05-paw-tap",
      "reaction-06-polite-wait",
      "reaction-07-tiny-shock",
      "reaction-08-facepalm",
    ],
  },
];

function runText(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: maxImageBufferBytes,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} exited with status ${result.status}.\n${result.stderr}`,
    );
  }

  return result.stdout.trim();
}

function runBinary(command, arguments_, input) {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    input,
    encoding: null,
    maxBuffer: maxImageBufferBytes,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} exited with status ${result.status}.\n${result.stderr.toString("utf8")}`,
    );
  }

  return result.stdout;
}

function inspectDimensions(source) {
  const dimensions = runText("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0:s=x",
    source,
  ]);
  const [width, height] = dimensions.split("x").map(Number);
  return { width, height };
}

function decodeCell(source, crop) {
  return runBinary("ffmpeg", [
    "-v",
    "error",
    "-i",
    source,
    "-vf",
    `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},format=rgba`,
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "pipe:1",
  ]);
}

function isBackgroundPixel(red, green, blue, background) {
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const chroma = maximum - minimum;

  if (background === "checkerboard") {
    return minimum >= 238 && chroma <= 10;
  }

  return (
    red >= 220 &&
    green >= 212 &&
    blue >= 202 &&
    red - green <= 18 &&
    green - blue <= 20
  );
}

function removeBorderConnectedBackground(pixels, width, height, background) {
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let queueStart = 0;
  let queueEnd = 0;

  function enqueueIfBackground(index) {
    if (visited[index] !== 0) return;
    visited[index] = 1;
    const offset = index * 4;
    if (
      isBackgroundPixel(
        pixels[offset],
        pixels[offset + 1],
        pixels[offset + 2],
        background,
      )
    ) {
      queue[queueEnd] = index;
      queueEnd += 1;
    }
  }

  for (let x = 0; x < width; x += 1) {
    enqueueIfBackground(x);
    enqueueIfBackground((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueueIfBackground(y * width);
    enqueueIfBackground(y * width + width - 1);
  }

  while (queueStart < queueEnd) {
    const index = queue[queueStart];
    queueStart += 1;
    pixels[index * 4 + 3] = 0;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueueIfBackground(index - 1);
    if (x + 1 < width) enqueueIfBackground(index + 1);
    if (y > 0) enqueueIfBackground(index - width);
    if (y + 1 < height) enqueueIfBackground(index + width);
  }
}

function removeDistantFragments(pixels, width, height) {
  const pixelCount = width * height;
  const labels = new Int32Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const components = [];
  let nextLabel = 1;

  for (let start = 0; start < pixelCount; start += 1) {
    if (pixels[start * 4 + 3] === 0 || labels[start] !== 0) continue;

    let queueStart = 0;
    let queueEnd = 1;
    queue[0] = start;
    labels[start] = nextLabel;
    let size = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    while (queueStart < queueEnd) {
      const index = queue[queueStart];
      queueStart += 1;
      size += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
        for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
          if (deltaX === 0 && deltaY === 0) continue;
          const neighborX = x + deltaX;
          const neighborY = y + deltaY;
          if (
            neighborX < 0 ||
            neighborX >= width ||
            neighborY < 0 ||
            neighborY >= height
          ) {
            continue;
          }

          const neighbor = neighborY * width + neighborX;
          if (pixels[neighbor * 4 + 3] !== 0 && labels[neighbor] === 0) {
            labels[neighbor] = nextLabel;
            queue[queueEnd] = neighbor;
            queueEnd += 1;
          }
        }
      }
    }

    components.push({ label: nextLabel, size, minX, minY, maxX, maxY });
    nextLabel += 1;
  }

  if (components.length === 0) {
    throw new Error("Background removal produced an empty cell.");
  }

  const primary = components.reduce((largest, component) =>
    component.size > largest.size ? component : largest,
  );
  const keepLabels = new Set([primary.label]);

  for (const component of components) {
    if (component.label === primary.label || component.size < 2) continue;
    const horizontalDistance = Math.max(
      0,
      primary.minX - component.maxX,
      component.minX - primary.maxX,
    );
    const verticalDistance = Math.max(
      0,
      primary.minY - component.maxY,
      component.minY - primary.maxY,
    );
    if (Math.hypot(horizontalDistance, verticalDistance) <= 24) {
      keepLabels.add(component.label);
    }
  }

  for (let index = 0; index < pixelCount; index += 1) {
    pixels[index * 4 + 3] = keepLabels.has(labels[index]) ? 255 : 0;
  }
}

function assertNoInteriorTransparency(pixels, width, height) {
  const exterior = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let queueStart = 0;
  let queueEnd = 0;

  function enqueueIfTransparent(index) {
    if (exterior[index] !== 0 || pixels[index * 4 + 3] !== 0) return;
    exterior[index] = 1;
    queue[queueEnd] = index;
    queueEnd += 1;
  }

  for (let x = 0; x < width; x += 1) {
    enqueueIfTransparent(x);
    enqueueIfTransparent((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueueIfTransparent(y * width);
    enqueueIfTransparent(y * width + width - 1);
  }

  while (queueStart < queueEnd) {
    const index = queue[queueStart];
    queueStart += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueueIfTransparent(index - 1);
    if (x + 1 < width) enqueueIfTransparent(index + 1);
    if (y > 0) enqueueIfTransparent(index - width);
    if (y + 1 < height) enqueueIfTransparent(index + width);
  }

  for (let index = 0; index < exterior.length; index += 1) {
    if (pixels[index * 4 + 3] === 0 && exterior[index] === 0) {
      const x = index % width;
      const y = Math.floor(index / width);
      throw new Error(`Transparent hole detected at ${x},${y}.`);
    }
  }
}

function writePng(output, pixels, width, height) {
  runBinary(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      "-s",
      `${width}x${height}`,
      "-i",
      "pipe:0",
      "-frames:v",
      "1",
      output,
    ],
    pixels,
  );
}

for (const sheet of sheets) {
  const source = resolve(repositoryRoot, sheet.source);
  const outputDirectory = resolve(repositoryRoot, sheet.outputDirectory);
  const actual = inspectDimensions(source);

  if (actual.width !== sheet.width || actual.height !== sheet.height) {
    throw new Error(
      `${sheet.source} is ${actual.width}x${actual.height}; expected ${sheet.width}x${sheet.height}.`,
    );
  }
  if (sheet.names.length !== sheet.columns * sheet.rows) {
    throw new Error(`${sheet.source} does not have one name per grid cell.`);
  }

  mkdirSync(outputDirectory, { recursive: true });

  for (let index = 0; index < sheet.names.length; index += 1) {
    const column = index % sheet.columns;
    const row = Math.floor(index / sheet.columns);
    const x = Math.floor((sheet.width * column) / sheet.columns);
    const y = Math.floor((sheet.height * row) / sheet.rows);
    const right = Math.floor((sheet.width * (column + 1)) / sheet.columns);
    const bottom = Math.floor((sheet.height * (row + 1)) / sheet.rows);
    const crop = { x, y, width: right - x, height: bottom - y };
    const output = resolve(outputDirectory, `${sheet.names[index]}.png`);
    const pixels = decodeCell(source, crop);

    removeBorderConnectedBackground(
      pixels,
      crop.width,
      crop.height,
      sheet.background,
    );
    removeDistantFragments(pixels, crop.width, crop.height);
    assertNoInteriorTransparency(pixels, crop.width, crop.height);
    writePng(output, pixels, crop.width, crop.height);
  }
}

console.log(
  `Created ${sheets.reduce((count, sheet) => count + sheet.names.length, 0)} transparent PNGs without clearing enclosed light pixels.`,
);
