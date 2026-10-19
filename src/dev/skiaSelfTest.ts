// Development check (dev gallery only): Skia can render offscreen, encode a JPEG and write it
// to the cache on this device. Resolves with the file size in bytes; never logs image data.
import { ImageFormat, Skia } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';

import { palettes } from '@/design/tokens';
import { ENHANCED_JPEG_QUALITY } from '@/features/scan/coverEnhancer';

export async function skiaSelfTest(): Promise<number> {
  const surface = Skia.Surface.Make(16, 16);
  if (!surface) throw new Error('skia_surface_unavailable');
  try {
    surface.getCanvas().drawColor(Skia.Color(palettes.light.surface));
    surface.flush();
    const image = surface.makeImageSnapshot();
    const jpeg = image.encodeToBytes(ImageFormat.JPEG, ENHANCED_JPEG_QUALITY);
    image.dispose?.();
    if (!jpeg || jpeg.length === 0) throw new Error('skia_encode_failed');
    const file = new File(Paths.cache, `skia-self-test-${Date.now()}.jpg`);
    file.create({ overwrite: true });
    file.write(jpeg);
    const size = file.size ?? jpeg.length;
    file.delete();
    return size;
  } finally {
    surface.dispose?.();
  }
}
