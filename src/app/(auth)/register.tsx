import { useRouter } from 'expo-router';

import { AuthScaffold } from '@/features/auth/AuthScaffold';
import { RegisterForm } from '@/features/auth/RegisterForm';

export default function RegisterScreen() {
  const router = useRouter();
  const goToLogin = () => (router.canGoBack() ? router.back() : router.replace('/login'));
  return (
    <AuthScaffold variant="register">
      <RegisterForm onSignIn={goToLogin} />
    </AuthScaffold>
  );
}
