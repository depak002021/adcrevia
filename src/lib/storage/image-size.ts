/**
 * Width and height from a PNG or JPEG header, without decoding the image.
 * Providers return sizes other than the one requested (Gemini's "2K" 9:16 is
 * 1536×2752), and the row should record what was actually stored.
 */
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  // PNG: IHDR width/height at bytes 16–23.
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  // JPEG: walk segments to the first start-of-frame marker.
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null
      const marker = bytes[offset + 1]
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (bytes[offset + 5] << 8) | bytes[offset + 6], width: (bytes[offset + 7] << 8) | bytes[offset + 8] }
      }
      offset += 2 + length
    }
  }
  return null
}
