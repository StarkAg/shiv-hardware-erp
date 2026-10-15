/**
 * A photo chosen from the computer, as a JPEG small enough to send to the
 * photo reader before it is uploaded: the long side at most `maxSide` pixels,
 * base64 without the data: prefix. A phone camera's 4000-pixel original is
 * several megabytes; at 2000 pixels the handwriting still reads.
 */
export async function photoAsJpeg(file: Blob, maxSide = 2000): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const url = canvas.toDataURL('image/jpeg', 0.85)
  return url.slice(url.indexOf(',') + 1)
}
