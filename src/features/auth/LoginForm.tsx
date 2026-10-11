import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { useTheme } from '@/design/ThemeProvider';
import { sizes, spacing } from '@/design/tokens';
import { t } from '@/i18n';
import { useProfileStore } from '@/stores/profileStore';

import { authErrorMessage, validationMessage, type AuthErrorCode } from './authErrors';
import { AuthTitle } from './AuthScaffold';
import * as authService from './authService';
import { FormError } from './FormError';
import { hasErrors, validateLoginForm } from './forms';
import { ResetPasswordSheet } from './ResetPasswordSheet';

type Props = { onCreateAccount: () => void };

export function LoginForm({ onCreateAccount }: Props) {
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<AuthErrorCode | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  // Field errors appear after the first submit and then update live.
  const errors = submitted ? validateLoginForm({ email, password }) : {};

  const submit = async () => {
    setSubmitted(true);
    setFormError(null);
    if (hasErrors(validateLoginForm({ email, password }))) return;
    setLoading(true);
    // After sign-in the profile's theme wins over the local one.
    useProfileStore.getState().setThemeSyncIntent('pull');
    const result = await authService.signIn({ email, password });
    setLoading(false);
    if (!result.ok) {
      useProfileStore.getState().setThemeSyncIntent('none');
      setFormError(result.error);
    }
    // On success the route guard switches to the app.
  };

  return (
    <>
      <View style={styles.intro}>
        <AuthTitle start={t.auth.login.titleStart} emphasis={t.auth.login.titleEmphasis} />
        <AppText variant="body" color="textSecondary">
          {t.auth.login.subtitle}
        </AppText>
      </View>

      <TextField
        label={t.auth.login.emailLabel}
        placeholder={t.auth.login.emailPlaceholder}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        errorText={errors.email ? validationMessage(errors.email) : undefined}
      />
      <View style={styles.passwordBlock}>
        <TextField
          label={t.auth.login.passwordLabel}
          placeholder={t.auth.login.passwordPlaceholder}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
          errorText={errors.password ? validationMessage(errors.password) : undefined}
        />
        <View style={styles.forgot}>
          <Button variant="link" label={t.auth.login.forgot} onPress={() => setResetOpen(true)} />
        </View>
      </View>

      {formError ? <FormError message={authErrorMessage(formError)} /> : null}

      <Button label={t.auth.login.submit} onPress={submit} loading={loading} />

      <View
        style={styles.divider}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={[styles.line, { backgroundColor: colors.border }]} />
        <AppText variant="italicNote">{t.auth.login.or}</AppText>
        <View style={[styles.line, { backgroundColor: colors.border }]} />
      </View>

      <Button variant="secondary" label={t.auth.login.createAccount} onPress={onCreateAccount} />

      <View style={styles.tagline}>
        <View style={[styles.taglineRule, { backgroundColor: colors.accent }]} />
        <AppText variant="italicNote" style={styles.center}>
          {t.auth.login.tagline}
        </AppText>
      </View>

      {resetOpen ? (
        <ResetPasswordSheet initialEmail={email} onClose={() => setResetOpen(false)} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  intro: { gap: spacing.xs },
  passwordBlock: { gap: spacing.xxs },
  forgot: { alignItems: 'flex-end' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  line: { flex: 1, height: sizes.borderWidth },
  tagline: { alignItems: 'center', gap: spacing.md, marginTop: spacing.xxl },
  taglineRule: { width: 40, height: 2, borderRadius: 1 },
  center: { textAlign: 'center' },
});
