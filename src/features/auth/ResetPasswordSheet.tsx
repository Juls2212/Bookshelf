import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { format, t } from '@/i18n';
import { INPUT_LIMITS } from '@/lib/inputLimits';
import { emailInput } from '@/lib/inputSanitizers';

import { authErrorMessage, validationMessage, type AuthErrorCode } from './authErrors';
import * as authService from './authService';
import { validateResetForm } from './forms';
import { FormError } from './FormError';

type Props = {
  initialEmail: string;
  onClose: () => void;
};

// Mounted only while open, so every opening starts fresh.
export function ResetPasswordSheet({ initialEmail, onClose }: Props) {
  const [email, setEmail] = useState(initialEmail);
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<AuthErrorCode | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const fieldError = submitted ? validateResetForm(email).email : undefined;

  const send = async () => {
    setSubmitted(true);
    if (validateResetForm(email).email) return;
    setSending(true);
    setError(null);
    const result = await authService.requestPasswordReset(email);
    setSending(false);
    if (result.ok) setSentTo(email.trim());
    else setError(result.error);
  };

  if (sentTo) {
    return (
      <BottomSheet visible onClose={onClose} title={t.auth.reset.successTitle}>
        <AppText variant="body" color="textSecondary" accessibilityLiveRegion="polite">
          {format(t.auth.reset.successText, { email: sentTo })}
        </AppText>
        <Button label={t.auth.reset.done} onPress={onClose} />
      </BottomSheet>
    );
  }

  return (
    <BottomSheet visible onClose={onClose} title={t.auth.reset.title}>
      <AppText variant="body" color="textSecondary">
        {t.auth.reset.text}
      </AppText>
      <TextField
        label={t.auth.login.emailLabel}
        placeholder={t.auth.login.emailPlaceholder}
        value={email}
        onChangeText={(text) => setEmail(emailInput(text, INPUT_LIMITS.email))}
        keyboardType="email-address"
        inputMode="email"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={INPUT_LIMITS.email}
        autoComplete="email"
        textContentType="emailAddress"
        errorText={fieldError ? validationMessage(fieldError) : undefined}
      />
      {error ? <FormError message={authErrorMessage(error)} /> : null}
      <View style={styles.actions}>
        <Button label={t.auth.reset.submit} onPress={send} loading={sending} />
        <Button variant="secondary" label={t.auth.reset.cancel} onPress={onClose} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 8 },
});
