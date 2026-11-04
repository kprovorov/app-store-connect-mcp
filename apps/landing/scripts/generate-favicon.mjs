import { readFile, writeFile } from "node:fs/promises";
import { createElement } from "react";
import { ImageResponse } from "next/og.js";

const icon = await readFile(new URL("../src/app/icon.svg", import.meta.url));
const src = `data:image/svg+xml;base64,${icon.toString("base64")}`;
const sizes = [16, 32, 48];
const images = await Promise.all(
  sizes.map(async (size) => {
    const image = new ImageResponse(
      createElement("img", { src, width: size, height: size }),
      { width: size, height: size },
    );
    return Buffer.from(await image.arrayBuffer());
  }),
);

const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;

for (const [index, size] of sizes.entries()) {
  const entry = 6 + index * 16;
  header.writeUInt8(size, entry);
  header.writeUInt8(size, entry + 1);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[index].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
}

await writeFile(
  new URL("../src/app/favicon.ico", import.meta.url),
  Buffer.concat([header, ...images]),
);
