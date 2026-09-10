import { useMutation } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { asImages, crop, shrink } from './image';

/** Puts the bill photos in Convex storage and hands back their ids. */
export function useUploader() {
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);

  return async function upload(files) {
    const ids = [];
    for (const incoming of files) {
      // A PDF is rendered to one image per page before anything leaves the
      // browser — nothing is ever stored as a PDF. Photographs are cropped to
      // the sheet and shrunk. Either way what reaches storage is a modest
      // JPEG, and a page is never lost for want of a crop.
      for (const original of await asImages(incoming)) {
      const file = await shrink(await crop(original));
      const url = await generateUploadUrl();
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!res.ok) throw new Error(`Could not upload ${file.name}`);
      const { storageId } = await res.json();
      ids.push(storageId);
      }
    }
    return ids;
  };
}
