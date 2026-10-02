export type Attachment = {
  url?: string | null
  previewUrl?: string | null
  contentType?: string | null
  label?: string
  name?: string
  storageId?: string
  kind?: string
}

export function isPdfAttachment(file: Attachment) {
  return /pdf/i.test(file.contentType ?? '') || /(?:\.pdf(?:[?#]|$)|^data:application\/pdf)/i.test(file.url ?? '')
}

export function attachmentName(file: Attachment, index = 0) {
  const name = (file.name || file.label || 'Attachment ' + (index + 1)).replace(/[\\/:*?"<>|]/g, '-').trim()
  if (/\.[a-z0-9]{2,5}$/i.test(name)) return name
  const extension = isPdfAttachment(file) ? 'pdf' : /png/i.test(file.contentType ?? '') ? 'png' : /webp/i.test(file.contentType ?? '') ? 'webp' : 'jpg'
  return name + '.' + extension
}
