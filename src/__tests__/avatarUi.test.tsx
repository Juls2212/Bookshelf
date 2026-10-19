import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking, Text } from 'react-native';

import { ToastProvider } from '@/components/Toast';
import { ThemeProvider } from '@/design/ThemeProvider';
import { CropEditor } from '@/features/library/CropEditor';
import { AvatarSheet } from '@/features/profile/AvatarSheet';
import { avatarImageSource, ProfileAvatar } from '@/features/profile/ProfileAvatar';
import type { Profile } from '@/features/profile/profileRepository';
import { t } from '@/i18n';
import { useProfileStore } from '@/stores/profileStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(), deleteDatabaseAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ getSupabaseClient: jest.fn() }));

const a = t.profile.avatar;
const USER = '11111111-1111-4111-8111-111111111111';
const photo = { uri: 'file:///photo.jpg', width: 1200, height: 900 };

async function sheet({ hasPhoto = false, permission = 'granted' as const } = {}) {
  const avatars = {
    requestCameraPermission: jest.fn(async () => permission as 'granted' | 'denied' | 'blocked'),
    takePhoto: jest.fn(async () => ({ ok: true as const, data: photo })),
    pickFromLibrary: jest.fn(async () => ({ ok: true as const, data: photo })),
  };
  const props = { onClose: jest.fn(), onPicked: jest.fn(), onRemove: jest.fn() };
  await render(
    <ThemeProvider>
      <ToastProvider>
        <AvatarSheet visible hasPhoto={hasPhoto} avatars={avatars} {...props} />
      </ToastProvider>
    </ThemeProvider>,
  );
  return { avatars, ...props };
}

describe('"Foto de perfil" sheet', () => {
  it('without a photo: take or choose, no "Quitar foto"', async () => {
    await sheet();
    expect(screen.getByRole('button', { name: a.takePhoto })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: a.chooseFromGallery })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: a.remove })).toBeNull();
  });

  it('with a photo: also "Quitar foto"', async () => {
    const s = await sheet({ hasPhoto: true });
    await fireEvent.press(screen.getByRole('button', { name: a.remove }));
    expect(s.onClose).toHaveBeenCalled();
    expect(s.onRemove).toHaveBeenCalled();
  });

  it('"Tomar foto" with permission opens the camera and hands the photo on', async () => {
    const s = await sheet();
    await fireEvent.press(screen.getByRole('button', { name: a.takePhoto }));
    expect(s.avatars.takePhoto).toHaveBeenCalled();
    expect(s.onPicked).toHaveBeenCalledWith(photo);
  });

  it('"Elegir de la galería" hands the chosen photo on', async () => {
    const s = await sheet();
    await fireEvent.press(screen.getByRole('button', { name: a.chooseFromGallery }));
    expect(s.avatars.pickFromLibrary).toHaveBeenCalled();
    expect(s.onPicked).toHaveBeenCalledWith(photo);
  });

  it('camera denied: explains it and offers to ask again or use the gallery', async () => {
    const s = await sheet({ permission: 'denied' as never });
    await fireEvent.press(screen.getByRole('button', { name: a.takePhoto }));
    expect(s.avatars.takePhoto).not.toHaveBeenCalled();
    expect(screen.getByTestId('avatar-sheet-denied')).toBeOnTheScreen();
    expect(screen.getByText(a.cameraDeniedTitle)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: a.allowCamera })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: a.chooseFromGallery })).toBeOnTheScreen();
  });

  it('camera blocked: only the system settings can change it', async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await sheet({ permission: 'blocked' as never });
    await fireEvent.press(screen.getByRole('button', { name: a.takePhoto }));
    expect(screen.queryByRole('button', { name: a.allowCamera })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: a.openSettings }));
    expect(openSettings).toHaveBeenCalled();
  });
});

const profile = (overrides: Partial<Profile> = {}): Profile => ({
  id: USER,
  displayName: 'Ana',
  theme: 'system',
  avatarPath: null,
  avatarLocalUri: null,
  avatarUpdatedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  ...overrides,
});

describe('avatar image', () => {
  it('local file first, then the signed URL; the cache key follows avatar_updated_at', () => {
    const withPhoto = profile({
      avatarPath: `${USER}/avatar.jpg`,
      avatarLocalUri: 'file:///a.jpg',
      avatarUpdatedAt: '2026-10-12T10:00:00.000Z',
    });
    expect(avatarImageSource(withPhoto, 'https://signed')).toEqual({
      uri: 'file:///a.jpg',
      cacheKey: `avatar:${USER}:2026-10-12T10:00:00.000Z`,
    });
    expect(avatarImageSource({ ...withPhoto, avatarLocalUri: null }, 'https://signed')).toEqual({
      uri: 'https://signed',
      cacheKey: `avatar:${USER}:2026-10-12T10:00:00.000Z`,
    });
    expect(avatarImageSource({ ...withPhoto, avatarLocalUri: null }, null)).toBeNull();
    expect(avatarImageSource(profile(), 'https://signed')).toBeNull();
  });

  const renderAvatar = async (p: Profile) => {
    useProfileStore.setState({ profile: p });
    const avatars = {
      getSignedUrl: jest.fn(async () => ({ ok: true as const, data: 'https://x' })),
    };
    await render(<ProfileAvatar fallback={<Text>A</Text>} avatars={avatars} />);
    return avatars;
  };

  it('shows the initials without a photo', async () => {
    await renderAvatar(profile());
    expect(screen.getByText('A')).toBeOnTheScreen();
    expect(screen.queryByTestId('profile-avatar-image')).toBeNull();
  });

  it('shows the photo (accessible), and the initials again when it fails to load', async () => {
    await renderAvatar(
      profile({
        avatarPath: `${USER}/avatar.jpg`,
        avatarLocalUri: 'file:///missing.jpg',
        avatarUpdatedAt: '2026-10-12T10:00:00.000Z',
      }),
    );
    const image = screen.getByTestId('profile-avatar-image');
    expect(image.props.accessibilityLabel).toBe(a.a11y);
    expect(screen.queryByText('A')).toBeNull();
    await fireEvent(image, 'error', { nativeEvent: { error: 'not found' } });
    expect(screen.getByText('A')).toBeOnTheScreen();
  });

  it('uses a signed URL while this device has no local copy', async () => {
    const avatars = await renderAvatar(
      profile({ avatarPath: `${USER}/avatar.jpg`, avatarUpdatedAt: '2026-10-12T10:00:00.000Z' }),
    );
    expect(await screen.findByTestId('profile-avatar-image')).toBeOnTheScreen();
    expect(avatars.getSignedUrl).toHaveBeenCalledWith(`${USER}/avatar.jpg`);
  });
});

describe('square crop step', () => {
  it('1:1 frame with a circular guide; applying returns a square crop of the photo', async () => {
    const onApply = jest.fn();
    const covers = {
      measure: jest.fn(async () => ({ ok: true as const, data: { width: 1200, height: 900 } })),
    };
    await render(
      <ThemeProvider>
        <CropEditor
          image={photo}
          initialCrop={null}
          aspect={1}
          circleGuide
          title={a.cropTitle}
          hint={a.cropHint}
          covers={covers}
          onApply={onApply}
          onCancel={jest.fn()}
        />
      </ThemeProvider>,
    );
    expect(screen.getByText(a.cropTitle)).toBeOnTheScreen();
    await fireEvent(screen.getByTestId('crop-area'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 344, height: 544 } },
    });
    expect(await screen.findByTestId('crop-circle-guide')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: t.cropEditor.apply }));
    const crop = onApply.mock.calls[0][0] as { width: number; height: number };
    // Full height of the landscape photo, and square in pixels.
    expect(crop.height).toBeCloseTo(1);
    expect((crop.width * photo.width) / (crop.height * photo.height)).toBeCloseTo(1, 3);
  });
});
