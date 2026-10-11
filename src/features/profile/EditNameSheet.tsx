import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { useToast } from '@/components/Toast';
import { validationMessage } from '@/features/auth/authErrors';
import { NAME_MAX_LENGTH, validateDisplayName } from '@/features/auth/validation';
import { t } from '@/i18n';
import { useProfileStore } from '@/stores/profileStore';

type Props = { initialName: string; onClose: () => void };

// Mounted only while open, so every opening starts from the current name.
export function EditNameSheet({ initialName, onClose }: Props) {
  const toast = useToast();
  const [name, setName] = useState(initialName);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const error = submitted ? validateDisplayName(name) : null;

  const save = async () => {
    setSubmitted(true);
    if (validateDisplayName(name)) return;
    setSaving(true);
    const result = await useProfileStore.getState().updateDisplayName(name);
    setSaving(false);
    if (result.ok) {
      toast.show(t.profile.nameSaved, 'success');
      onClose();
    } else {
      toast.show(
        result.error === 'network_error' ? t.auth.errors.network_error : t.profile.nameSaveError,
        'error',
      );
    }
  };

  return (
    <BottomSheet visible onClose={onClose} title={t.profile.editNameTitle}>
      <TextField
        label={t.auth.register.nameLabel}
        placeholder={t.auth.register.namePlaceholder}
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        autoComplete="name"
        maxLength={NAME_MAX_LENGTH + 20}
        returnKeyType="done"
        onSubmitEditing={save}
        errorText={error ? validationMessage(error) : undefined}
      />
      <View style={styles.actions}>
        <Button label={t.profile.saveName} onPress={save} loading={saving} />
        <Button variant="secondary" label={t.bookDetail.cancel} onPress={onClose} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 8 },
});
