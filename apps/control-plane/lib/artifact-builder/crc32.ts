/**
 * Fast streaming CRC-32 (IEEE 802.3 polynomial 0xEDB88320)
 */
export class Crc32 {
  private static table: Uint32Array = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let j = 0; j < 8; j += 1) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  private crc = 0xffffffff;

  public update(chunk: Uint8Array): this {
    const table = Crc32.table;
    let crc = this.crc;
    const len = chunk.length;
    for (let i = 0; i < len; i += 1) {
      crc = table[(crc ^ chunk[i]) & 0xff] ^ (crc >>> 8);
    }
    this.crc = crc;
    return this;
  }

  public digest(): number {
    return ((this.crc ^ 0xffffffff) >>> 0);
  }
}

export function crc32Bytes(data: Uint8Array): number {
  return new Crc32().update(data).digest();
}
