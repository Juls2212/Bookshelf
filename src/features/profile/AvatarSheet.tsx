// "Foto de perfil": take a photo, choose one from the gallery or (with a photo) remove it.
// Without camera permission the sheet explains it and offers to ask again (or open the system
// settings when Android no longer asks), plus the gallery. The picked image goes to the crop step.
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
import { spacing } from '@/design/tokens';
import type { LocalImage } from '@/features/library/coverService';
import { t } from '@/i18n';

import { avatarService, type AvatarService } from './avatarService';

const a = t.profile.avatar;

type Step = 'options' | 'denied' | 'blocked';

type Props = {
  visible: boolean;
  hasPhoto: boolean;
  onClose: () => void;
  /** An image was taken or chosen (the sheet is already closed). */
  onPicked: (image: LocalImage) => void;
  onRemove: () => void;
  avatars?: Pick<AvatarService, 'requestCameraPermission' | 'takePhoto' | 'pickFromLibrary'>;
};

export function AvatarSheet({
  visible,
  hasPhoto,
  onClose,
  onPicked,
  onRemove,
  avatars = avatarService,
}: Props) {
  const toast = useToast();
  const [step, setStep] = useState<Step>('options');

  const close = () => {
    setStep('options');
    onClose();
  };

  /** The system camera or picker opens after the sheet closes. */
  const launch = async (open: () => ReturnType<AvatarService['takePhoto']>) => {
    close();
    const result = await open();
    if (result.ok) onPicked(result.data);
    else if (result.error !== 'cancelled') toast.show(a.pickFailed, 'error');
  };

  const takePhoto = async () => {
    const permission = await avatars.requestCameraPermission();
    if (permission !== 'granted') {
      setStep(permission);
      return;
    }
    await launch(() => avatars.takePhoto());
  };

  const chooseFromGallery = () => launch(() => avatars.pickFromLibrary());

  const remove = () => {
    close();
    onRemove();
  };

  return (
    <BottomSheet visible={visible} onClose={close} title={a.sheetTitle}>
      {step === 'options' ? (
        <View style={styles.actions} testID="avatar-sheet-options">
          <Button variant="secondary" icon="scan" label={a.takePhoto} onPress={takePhoto} />
          <Button
            variant="secondary"
            icon="image"
            label={a.chooseFromGallery}
            onPress={chooseFromGallery}
          />
          {hasPhoto ? (
            <Button variant="ghostDanger" icon="trash" label={a.remove} onPress={remove} />
          ) : null}
        </View>
      ) : (
        <View style={styles.actions} testID={`avatar-sheet-${step}`}>
          <AppText variant="heading" accessibilityRole="header">
            {a.cameraDeniedTitle}
          </AppText>
          <AppText variant="body" color="textSecondary">
            {a.cameraDeniedMessage}
          </AppText>
          {step === 'denied' ? (
            <Button label={a.allowCamera} onPress={takePhoto} />
          ) : (
            <Button label={a.openSettings} onPress={() => void Linking.openSettings()} />
          )}
          <Button
            variant="secondary"
            icon="image"
            label={a.chooseFromGallery}
            onPress={chooseFromGallery}
          />
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.sm },
});
