import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { PlaceholderScreen, usePlaceholderTextColor } from '@/components/PlaceholderScreen';
import { t } from '@/i18n';
import { checkSupabaseHealth, type HealthResult } from '@/lib/supabaseHealth';

function DevHealthStatus() {
  const color = usePlaceholderTextColor();
  const [result, setResult] = useState<HealthResult | null>(null);

  useEffect(() => {
    let active = true;
    checkSupabaseHealth().then((value) => {
      if (active) setResult(value);
    });
    return () => {
      active = false;
    };
  }, []);

  const message =
    result === null
      ? t.health.checking
      : result.status === 'ok'
        ? t.health.ok
        : t.health.errors[result.code];

  return (
    <>
      <Text style={{ color, fontWeight: '600' }}>{t.health.title}</Text>
      <Text style={{ color, textAlign: 'center' }}>{message}</Text>
    </>
  );
}

export default function HomeScreen() {
  return (
    <PlaceholderScreen title={t.tabs.home}>
      {__DEV__ ? <DevHealthStatus /> : null}
    </PlaceholderScreen>
  );
}
