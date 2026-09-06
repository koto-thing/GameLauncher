import { Crc32 } from "./crc32.ts";
import { ArtifactBuildCancelledError } from "./types.ts";

export type ZipEntrySource = {
  archivePath: string; // e.g. "build/bin/game.exe" or "metadata/release.json"
  size: number;
  // File data source can be Uint8Array (for metadata), Blob/File, or chunk streamer
  getData: () => Promise<Uint8Array | Blob | AsyncIterable<Uint8Array>>;
};

export type ZipProgressCallback = (
  completedBytes: number,
  totalBytes: number,
  currentFile: string,
) => void;

export type DeflateResult = {
  compressedSize: number;
  blobParts: Blob[];
};

/**
 * Compresses data using raw DEFLATE (RFC 1951) without zlib headers or footers.
 * Output chunks are immediately wrapped into Blob-backed parts to minimize JS heap memory retention.
 * Works in both browser (CompressionStream('deflate-raw')) and Node.js (node:zlib).
 */
export async function deflateRawStreamToBlobParts(
  inputChunks: AsyncIterable<Uint8Array>,
  signal?: AbortSignal,
): Promise<DeflateResult> {
  if (signal?.aborted) {
    throw new ArtifactBuildCancelledError();
  }

  // 1. Browser Web Streams API
  if (typeof globalThis.CompressionStream === "function") {
    const cs = new globalThis.CompressionStream("deflate-raw");
    const writer = cs.writable.getWriter();
    const reader = cs.readable.getReader();

    const blobParts: Blob[] = [];
    let compressedSize = 0;

    const readPromise = (async () => {
      while (true) {
        if (signal?.aborted) {
          throw new ArtifactBuildCancelledError();
        }
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.length > 0) {
          compressedSize += value.byteLength;
          // Immediately move compressed chunk to Blob-backed store
          blobParts.push(new Blob([value]));
        }
      }
    })();

    for await (const chunk of inputChunks) {
      if (signal?.aborted) {
        writer.abort(new ArtifactBuildCancelledError());
        throw new ArtifactBuildCancelledError();
      }
      await writer.write(chunk as unknown as BufferSource);
    }
    await writer.close();
    await readPromise;

    return { compressedSize, blobParts };
  }

  // 2. Node.js environment fallback using streaming zlib
  try {
    const zlib = await import(/* @vite-ignore */ "node:zlib");
    const blobParts: Blob[] = [];
    let compressedSize = 0;

    const deflate = zlib.createDeflateRaw({ level: 6 });

    const chunksPromise = new Promise<void>((resolve, reject) => {
      deflate.on("data", (chunk: Buffer) => {
        compressedSize += chunk.length;
        const u8 = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        blobParts.push(new Blob([u8 as unknown as BlobPart]));
      });
      deflate.on("end", () => resolve());
      deflate.on("error", (err: Error) => reject(err));
    });

    for await (const chunk of inputChunks) {
      if (signal?.aborted) {
        deflate.destroy(new ArtifactBuildCancelledError());
        throw new ArtifactBuildCancelledError();
      }
      const ok = deflate.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      if (!ok) {
        await new Promise((r) => deflate.once("drain", r));
      }
    }
    deflate.end();
    await chunksPromise;

    return { compressedSize, blobParts };
  } catch (err) {
    if (err instanceof ArtifactBuildCancelledError) throw err;
    throw new Error(`DEFLATE compression is unavailable in this environment: ${err}`, { cause: err });
  }
}


/**
 * Converts a Blob or Uint8Array into an AsyncIterable of chunks (e.g. 1 MiB chunks)
 */
async function* streamChunksFromSource(
  source: Uint8Array | Blob | AsyncIterable<Uint8Array>,
  chunkSize: number = 1024 * 1024,
): AsyncIterable<Uint8Array> {
  if (source instanceof Uint8Array) {
    let offset = 0;
    while (offset < source.length) {
      const end = Math.min(offset + chunkSize, source.length);
      yield source.subarray(offset, end);
      offset = end;
    }
    return;
  }

  if (typeof Blob !== "undefined" && source instanceof Blob) {
    let offset = 0;
    const total = source.size;
    while (offset < total) {
      const end = Math.min(offset + chunkSize, total);
      const slice = source.slice(offset, end);
      const buf = await slice.arrayBuffer();
      yield new Uint8Array(buf);
      offset = end;
    }
    return;
  }

  if (Symbol.asyncIterator in Object(source)) {
    yield* source as AsyncIterable<Uint8Array>;
    return;
  }

  throw new Error("Unsupported zip entry source data type");
}

export type ProcessedEntry = {
  archivePath: string;
  utf8PathBytes: Uint8Array;
  uncompressedSize: number;
  compressedSize: number;
  crc32: number;
  localHeaderOffset: number;
  useZip64: boolean;
};

const UINT32_MAX = 0xffffffff;
const UINT16_MAX = 0xffff;

/**
 * Creates a deterministic ZIP archive from entries matching desktop Python zipfile specification.
 * - Date/time fixed to 1980-01-01 00:00:00 (DOS time=0, date=0x0021)
 * - Unix external attributes: 0o100644 << 16 (0x81a40000)
 * - Compression: DEFLATE level 6
 * - UTF-8 filename flag enabled
 * - Supports Zip64 for files or archives exceeding 4 GiB
 * - Compressed chunks are immediately converted to Blob parts without accumulating in JS memory
 * - ProcessedEntry stores only file metadata, NOT compressed body
 */
export async function createDeterministicZip(
  entries: ZipEntrySource[],
  options: {
    onProgress?: ZipProgressCallback;
    signal?: AbortSignal;
  } = {},
): Promise<Blob> {
  const { onProgress, signal } = options;

  const checkCancel = () => {
    if (signal?.aborted) {
      throw new ArtifactBuildCancelledError();
    }
  };

  checkCancel();

  const totalBytes = entries.reduce((acc, e) => acc + e.size, 0);
  let completedBytes = 0;

  const processedEntries: ProcessedEntry[] = [];
  const blobParts: BlobPart[] = [];
  let currentOffset = 0;

  const encoder = new TextEncoder();

  // Step 1: Process each entry, compute CRC-32 & DEFLATE, write Local File Headers & Blob parts
  for (const entry of entries) {
    checkCancel();
    onProgress?.(completedBytes, totalBytes, entry.archivePath);

    const utf8PathBytes = encoder.encode(entry.archivePath);
    const uncompressedSize = entry.size;

    const crcHasher = new Crc32();
    let entryProcessed = 0;

    // Collect chunks, update CRC-32, and feed to deflate
    const dataChunksForDeflate = (async function* () {
      const chunkIterable = streamChunksFromSource(await entry.getData());
      for await (const chunk of chunkIterable) {
        checkCancel();
        crcHasher.update(chunk);
        entryProcessed += chunk.length;
        onProgress?.(completedBytes + entryProcessed, totalBytes, entry.archivePath);
        yield chunk;
      }
    })();

    const { compressedSize, blobParts: entryBlobParts } =
      await deflateRawStreamToBlobParts(dataChunksForDeflate, signal);
    const crc = crcHasher.digest();

    completedBytes += uncompressedSize;

    const useZip64 =
      uncompressedSize >= UINT32_MAX ||
      compressedSize >= UINT32_MAX ||
      currentOffset >= UINT32_MAX;

    const localHeaderOffset = currentOffset;

    // Build Local File Header
    const extraLen = useZip64 ? 20 : 0; // Zip64 extra field: 2 (tag) + 2 (size) + 8 (uncomp) + 8 (comp)
    const localHeader = new Uint8Array(30 + utf8PathBytes.length + extraLen);
    const view = new DataView(localHeader.buffer, localHeader.byteOffset, localHeader.byteLength);

    // Signature 0x04034b50
    view.setUint32(0, 0x04034b50, true);
    // Version needed to extract (45 for Zip64, 20 for deflate)
    view.setUint16(4, useZip64 ? 45 : 20, true);
    // General purpose bit flag (bit 11 for UTF-8)
    view.setUint16(6, 0x0800, true);
    // Compression method (8 = Deflate)
    view.setUint16(8, 8, true);
    // Last mod file time (0)
    view.setUint16(10, 0x0000, true);
    // Last mod file date (1980-01-01 = 0x0021)
    view.setUint16(12, 0x0021, true);
    // CRC-32
    view.setUint32(14, crc, true);
    // Compressed size
    view.setUint32(18, useZip64 ? UINT32_MAX : compressedSize, true);
    // Uncompressed size
    view.setUint32(22, useZip64 ? UINT32_MAX : uncompressedSize, true);
    // File name length
    view.setUint16(26, utf8PathBytes.length, true);
    // Extra field length
    view.setUint16(28, extraLen, true);

    // File name
    localHeader.set(utf8PathBytes, 30);

    // Zip64 Extra Field
    if (useZip64) {
      const extraOffset = 30 + utf8PathBytes.length;
      view.setUint16(extraOffset, 0x0001, true); // Zip64 tag
      view.setUint16(extraOffset + 2, 16, true); // Data size (8 + 8)
      view.setBigUint64(extraOffset + 4, BigInt(uncompressedSize), true);
      view.setBigUint64(extraOffset + 12, BigInt(compressedSize), true);
    }

    blobParts.push(localHeader as unknown as BlobPart);
    currentOffset += localHeader.length;

    for (const part of entryBlobParts) {
      blobParts.push(part as unknown as BlobPart);
    }
    currentOffset += compressedSize;

    // Notice: ProcessedEntry only records metadata, NO compressed body
    processedEntries.push({
      archivePath: entry.archivePath,
      utf8PathBytes,
      uncompressedSize,
      compressedSize,
      crc32: crc,
      localHeaderOffset,
      useZip64,
    });
  }

  // Step 2: Build Central Directory
  const centralDirStartOffset = currentOffset;
  let centralDirSize = 0;

  for (const item of processedEntries) {
    checkCancel();
    const needsZip64Extra =
      item.uncompressedSize >= UINT32_MAX ||
      item.compressedSize >= UINT32_MAX ||
      item.localHeaderOffset >= UINT32_MAX;

    let extraLen = 0;
    if (needsZip64Extra) {
      extraLen = 4; // header id (2) + size (2)
      if (item.uncompressedSize >= UINT32_MAX) extraLen += 8;
      if (item.compressedSize >= UINT32_MAX) extraLen += 8;
      if (item.localHeaderOffset >= UINT32_MAX) extraLen += 8;
    }

    const cdHeader = new Uint8Array(46 + item.utf8PathBytes.length + extraLen);
    const view = new DataView(cdHeader.buffer, cdHeader.byteOffset, cdHeader.byteLength);

    // Central directory file header signature 0x02014b50
    view.setUint32(0, 0x02014b50, true);
    // Version made by (Unix = 3, version 2.0 = 20, or 45 if zip64)
    view.setUint16(4, (3 << 8) | (needsZip64Extra ? 45 : 20), true);
    // Version needed to extract
    view.setUint16(6, needsZip64Extra ? 45 : 20, true);
    // General purpose bit flag (UTF-8)
    view.setUint16(8, 0x0800, true);
    // Compression method (8 = Deflate)
    view.setUint16(10, 8, true);
    // Last mod file time
    view.setUint16(12, 0x0000, true);
    // Last mod file date
    view.setUint16(14, 0x0021, true);
    // CRC-32
    view.setUint32(16, item.crc32, true);
    // Compressed size
    view.setUint32(
      20,
      item.compressedSize >= UINT32_MAX ? UINT32_MAX : item.compressedSize,
      true,
    );
    // Uncompressed size
    view.setUint32(
      24,
      item.uncompressedSize >= UINT32_MAX ? UINT32_MAX : item.uncompressedSize,
      true,
    );
    // File name length
    view.setUint16(28, item.utf8PathBytes.length, true);
    // Extra field length
    view.setUint16(30, extraLen, true);
    // File comment length
    view.setUint16(32, 0, true);
    // Disk number start
    view.setUint16(34, 0, true);
    // Internal file attributes
    view.setUint16(36, 0, true);
    // External file attributes: 0o100644 << 16 (0x81a40000)
    view.setUint32(38, 0x81a40000, true);
    // Relative offset of local header
    view.setUint32(
      42,
      item.localHeaderOffset >= UINT32_MAX ? UINT32_MAX : item.localHeaderOffset,
      true,
    );

    // File name
    cdHeader.set(item.utf8PathBytes, 46);

    // Extra field
    if (needsZip64Extra) {
      let extraOffset = 46 + item.utf8PathBytes.length;
      view.setUint16(extraOffset, 0x0001, true);
      view.setUint16(extraOffset + 2, extraLen - 4, true);
      extraOffset += 4;
      if (item.uncompressedSize >= UINT32_MAX) {
        view.setBigUint64(extraOffset, BigInt(item.uncompressedSize), true);
        extraOffset += 8;
      }
      if (item.compressedSize >= UINT32_MAX) {
        view.setBigUint64(extraOffset, BigInt(item.compressedSize), true);
        extraOffset += 8;
      }
      if (item.localHeaderOffset >= UINT32_MAX) {
        view.setBigUint64(extraOffset, BigInt(item.localHeaderOffset), true);
      }
    }

    blobParts.push(cdHeader as unknown as BlobPart);
    centralDirSize += cdHeader.length;
    currentOffset += cdHeader.length;
  }

  const isZip64Archive =
    processedEntries.length >= UINT16_MAX ||
    centralDirSize >= UINT32_MAX ||
    centralDirStartOffset >= UINT32_MAX ||
    processedEntries.some((e) => e.useZip64);

  // Step 3: Zip64 End of Central Directory if needed
  if (isZip64Archive) {
    const zip64EOCDOffset = currentOffset;

    // Zip64 End of Central Directory Record (56 bytes)
    const z64Eocd = new Uint8Array(56);
    const z64View = new DataView(z64Eocd.buffer, z64Eocd.byteOffset, z64Eocd.byteLength);
    // Signature 0x06064b50
    z64View.setUint32(0, 0x06064b50, true);
    // Size of zip64 end of central dir record (44)
    z64View.setBigUint64(4, BigInt(44), true);
    // Version made by (0x032d)
    z64View.setUint16(12, (3 << 8) | 45, true);
    // Version needed to extract (45)
    z64View.setUint16(14, 45, true);
    // Number of this disk (0)
    z64View.setUint32(16, 0, true);
    // Number of disk with central directory (0)
    z64View.setUint32(20, 0, true);
    // Total entries on this disk
    z64View.setBigUint64(24, BigInt(processedEntries.length), true);
    // Total entries
    z64View.setBigUint64(32, BigInt(processedEntries.length), true);
    // Size of central directory
    z64View.setBigUint64(40, BigInt(centralDirSize), true);
    // Offset of central directory
    z64View.setBigUint64(48, BigInt(centralDirStartOffset), true);

    blobParts.push(z64Eocd as unknown as BlobPart);

    // Zip64 End of Central Directory Locator (20 bytes)
    const z64Loc = new Uint8Array(20);
    const locView = new DataView(z64Loc.buffer, z64Loc.byteOffset, z64Loc.byteLength);
    // Signature 0x07064b50
    locView.setUint32(0, 0x07064b50, true);
    // Disk number with zip64 EOCD (0)
    locView.setUint32(4, 0, true);
    // Relative offset of zip64 EOCD
    locView.setBigUint64(8, BigInt(zip64EOCDOffset), true);
    // Total number of disks (1)
    locView.setUint32(16, 1, true);

    blobParts.push(z64Loc as unknown as BlobPart);
  }

  // Step 4: Standard End of Central Directory Record (22 bytes)
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer, eocd.byteOffset, eocd.byteLength);
  // Signature 0x06054b50
  eocdView.setUint32(0, 0x06054b50, true);
  // Disk number (0)
  eocdView.setUint16(4, 0, true);
  // Disk number with central dir (0)
  eocdView.setUint16(6, 0, true);
  // Entries on this disk
  eocdView.setUint16(
    8,
    isZip64Archive || processedEntries.length >= UINT16_MAX ? UINT16_MAX : processedEntries.length,
    true,
  );
  // Total entries
  eocdView.setUint16(
    10,
    isZip64Archive || processedEntries.length >= UINT16_MAX ? UINT16_MAX : processedEntries.length,
    true,
  );
  // Size of central directory
  eocdView.setUint32(
    12,
    isZip64Archive || centralDirSize >= UINT32_MAX ? UINT32_MAX : centralDirSize,
    true,
  );
  // Offset of central directory
  eocdView.setUint32(
    16,
    isZip64Archive || centralDirStartOffset >= UINT32_MAX ? UINT32_MAX : centralDirStartOffset,
    true,
  );
  // Comment length (0)
  eocdView.setUint16(20, 0, true);

  blobParts.push(eocd as unknown as BlobPart);

  checkCancel();
  onProgress?.(totalBytes, totalBytes, "完了");

  return new Blob(blobParts, { type: "application/zip" });
}
