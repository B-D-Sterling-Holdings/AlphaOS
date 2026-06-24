// One-time migration for thesis `newsUpdates`. Images used to live in a separate
// `entry.images` array rendered as its own gallery. Images are inline-in-the-body
// everywhere now, so fold any legacy `entry.images` into the body as image blocks
// (which RichTextArea renders inline and rewrites to inline HTML on the next save)
// and drop the `images` array. A no-op when nothing needs migrating.
export function migrateNewsImages(thesis) {
  const updates = thesis?.newsUpdates;
  if (!Array.isArray(updates) || !updates.some(e => e?.images?.length)) return thesis;
  return {
    ...thesis,
    newsUpdates: updates.map(entry => {
      if (!entry?.images?.length) return entry;
      const { images, ...rest } = entry;
      const baseBlocks = Array.isArray(entry.body)
        ? entry.body
        : [{ type: 'text', value: typeof entry.body === 'string' ? entry.body : '' }];
      const imageBlocks = images.map(img => ({ type: 'image', url: img.url, path: img.path, name: img.name }));
      return { ...rest, body: [...baseBlocks, ...imageBlocks] };
    }),
  };
}
