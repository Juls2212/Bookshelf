import { useRouter } from 'expo-router';

import { AuthScaffold } from '@/features/auth/AuthScaffold';
import { LoginForm } from '@/features/auth/LoginForm';

export default function LoginScreen() {
  const router = useRouter();
  return (
    <AuthScaffold variant="login">
      <LoginForm onCreateAccount={() => router.push('/register')} />
    </AuthScaffold>
  );
}
