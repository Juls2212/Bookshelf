import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { useToast } from '@/components/Toast';
import { Icon } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import { spacing } from '@/design/tokens';
import { format, t } from '@/i18n';
import { INPUT_LIMITS } from '@/lib/inputLimits';
import { emailInput, lineInput } from '@/lib/inputSanitizers';
import { useProfileStore } from '@/stores/profileStore';

import { authErrorMessage, validationMessage, type AuthErrorCode } from './authErrors';
import { AuthTitle } from './AuthScaffold';
import * as authService from './authService';
import { FormError } from './FormError';
import { hasErrors, validateRegisterForm, type RegisterValues } from './forms';

type Props = { onSignIn: () => void };

const emptyValues: RegisterValues = { displayName: '', email: '', password: '', confirmation: '' };

function CheckEmail({ email, onSignIn }: { email: string; onSignIn: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.checkEmail} accessibilityLiveRegion="polite">
      <Icon name="check" size={32} color={colors.success} />
      <AppText variant="title" accessibilityRole="header">
        {t.auth.register.checkEmailTitle}
      </AppText>
      <AppText variant="body" color="textSecondary">
        {format(t.auth.register.checkEmailText, { email })}
      </AppText>
      <Button label={t.auth.register.goToLogin} onPress={onSignIn} />
    </View>
  );
}

export function RegisterForm({ onSignIn }: Props) {
  const toast = useToast();
  const [values, setValues] = useState<RegisterValues>(emptyValues);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<AuthErrorCode | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const errors = submitted ? validateRegisterForm(values) : {};
  const setField = (field: keyof RegisterValues) => (text: string) =>
    setValues((current) => ({ ...current, [field]: text }));
  const fieldError = (field: keyof RegisterValues) => {
    const code = errors[field];
    return code ? validationMessage(code) : undefined;
  };

  const submit = async () => {
    setSubmitted(true);
    setFormError(null);
    if (hasErrors(validateRegisterForm(values))) return;
    setLoading(true);
    // After sign-up the local theme is pushed to the new profile.
    useProfileStore.getState().setThemeSyncIntent('push');
    const result = await authService.signUp(values);
    setLoading(false);
    if (!result.ok) {
      useProfileStore.getState().setThemeSyncIntent('none');
      setFormError(result.error);
      return;
    }
    if (result.data.sessionCreated) {
      // The route guard enters the app; the toast lives above the navigator.
      toast.show(t.auth.register.welcome, 'success');
    } else {
      useProfileStore.getState().setThemeSyncIntent('none');
      setPendingEmail(values.email.trim());
    }
  };

  if (pendingEmail) return <CheckEmail email={pendingEmail} onSignIn={onSignIn} />;

  return (
    <>
      <View style={styles.intro}>
        <AuthTitle start={t.auth.register.titleStart} emphasis={t.auth.register.titleEmphasis} />
        <AppText variant="body" color="textSecondary">
          {t.auth.register.subtitle}
        </AppText>
      </View>

      <TextField
        label={t.auth.register.nameLabel}
        placeholder={t.auth.register.namePlaceholder}
        value={values.displayName}
        onChangeText={(text) => setField('displayName')(lineInput(text, INPUT_LIMITS.displayName))}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        maxLength={INPUT_LIMITS.displayName}
        errorText={fieldError('displayName')}
      />
      <TextField
        label={t.auth.register.emailLabel}
        placeholder={t.auth.register.emailPlaceholder}
        value={values.email}
        onChangeText={(text) => setField('email')(emailInput(text, INPUT_LIMITS.email))}
        keyboardType="email-address"
        inputMode="email"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={INPUT_LIMITS.email}
        autoComplete="email"
        textContentType="emailAddress"
        errorText={fieldError('email')}
      />
      <TextField
        label={t.auth.register.passwordLabel}
        placeholder={t.auth.register.passwordPlaceholder}
        value={values.password}
        onChangeText={setField('password')}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={INPUT_LIMITS.passwordMax}
        helperText={format(t.auth.register.passwordHint, {
          min: INPUT_LIMITS.passwordMin,
          max: INPUT_LIMITS.passwordMax,
        })}
        autoComplete="new-password"
        textContentType="newPassword"
        errorText={fieldError('password')}
      />
      <TextField
        label={t.auth.register.confirmLabel}
        placeholder={t.auth.register.confirmPlaceholder}
        value={values.confirmation}
        onChangeText={setField('confirmation')}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={INPUT_LIMITS.passwordMax}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={submit}
        errorText={fieldError('confirmation')}
      />

      {formError ? <FormError message={authErrorMessage(formError)} /> : null}

      <Button label={t.auth.register.submit} onPress={submit} loading={loading} />

      <View style={styles.footer}>
        <AppText variant="body" color="textSecondary">
          {t.auth.register.haveAccount}
        </AppText>
        <Button variant="link" label={t.auth.register.signIn} onPress={onSignIn} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  intro: { gap: spacing.xs },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  checkEmail: { gap: spacing.md, paddingTop: spacing.lg },
});
