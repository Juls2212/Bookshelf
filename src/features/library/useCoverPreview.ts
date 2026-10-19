// What the form shows for a newly chosen cover: the image itself, or a small rendered copy of
// its crop. Preview files live in the cache and are removed when replaced or on unmount.
import { useEffect, useState } from 'react';

import { coverService, type CoverService, type LocalImage } from './coverService';

type Deps = { covers?: Pick<CoverService, 'renderPreview' | 'removeLocal'> };

const previewKey = (image: LocalImage) =>
  image.crop
    ? `${image.uri}#${image.crop.x},${image.crop.y},${image.crop.width},${image.crop.height}`
    : null;

/** URI to show, or null while the cropped preview is being rendered (or if it failed). */
export function useCoverPreview(
  image: LocalImage | null,
  { covers = coverService }: Deps = {},
): string | null {
  const [preview, setPreview] = useState<{ key: string; uri: string } | null>(null);
  const key = image ? previewKey(image) : null;

  useEffect(() => {
    if (!image || !key) return;
    let active = true;
    let rendered: string | null = null;
    void covers.renderPreview(image).then((result) => {
      if (!result.ok) return;
      rendered = result.data.uri;
      if (active) setPreview({ key, uri: rendered });
      else covers.removeLocal(rendered);
    });
    return () => {
      active = false;
      if (rendered) covers.removeLocal(rendered);
    };
  }, [image, key, covers]);

  if (!image) return null;
  if (!key) return image.uri;
  return preview?.key === key ? preview.uri : null;
}
