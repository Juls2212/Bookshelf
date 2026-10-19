// Dev-only route. Production builds fold __DEV__ to false, so this require is dropped and the
// gallery (with its fake-service switches and the Skia check) is not in the bundle at all.
import { Redirect } from 'expo-router';
import type { ComponentType } from 'react';

const Gallery: ComponentType | null = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('@/dev/DevGallery') as typeof import('@/dev/DevGallery')).DevGallery
  : null;

export default function DevGalleryRoute() {
  return Gallery ? <Gallery /> : <Redirect href="/" />;
}
