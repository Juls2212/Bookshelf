import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { SchemeOverride, useTheme } from '@/design/ThemeProvider';
import { spacing } from '@/design/tokens';
import { CameraStep } from '@/features/scan/CameraStep';
import { PhotoPreview, ProcessingStep, ScanPanel } from '@/features/scan/ProcessingStep';
import { ReviewStep } from '@/features/scan/ReviewStep';
import { ScanFailureCard } from '@/features/scan/ScanFailureCard';
import { RoundIconButton } from '@/features/scan/ScanChrome';
import { useScanFlow } from '@/features/scan/useScanFlow';
import { t } from '@/i18n';

export default function ScanScreen() {
  const router = useRouter();
  // The camera is always dark; the panels and the review use the app's own theme.
  const { scheme } = useTheme();
  const flow = useScanFlow();
  const { phase } = flow;
  const manual = () => router.replace('/book/new');

  // Android back steps back inside the flow (and cancels a running request).
  const inCamera = phase.name === 'camera';
  useEffect(() => {
    if (inCamera) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      flow.retake();
      return true;
    });
    return () => subscription.remove();
  }, [inCamera, flow]);

  if (phase.name === 'review') {
    return <ReviewStep photo={phase.photo} book={phase.book} onRetake={flow.retake} />;
  }

  return (
    <SchemeOverride scheme="dark">
      <StatusBar style="light" />
      <Screen
        texture={false}
        // The bottom panel reaches the screen edge and pads the inset itself.
        edges={
          phase.name === 'camera' ? ['top', 'bottom', 'left', 'right'] : ['top', 'left', 'right']
        }
        contentStyle={styles.screen}
      >
        {phase.name === 'camera' ? (
          <CameraStep
            mode={flow.mode}
            onModeChange={flow.setMode}
            onPhoto={flow.identifyPhoto}
            onManual={manual}
            onClose={() => router.back()}
          />
        ) : phase.name === 'processing' ? (
          <ProcessingStep
            photo={phase.photo}
            mode={flow.mode}
            panelScheme={scheme}
            onCancel={flow.cancel}
          />
        ) : (
          <View style={styles.flex}>
            <View style={styles.topBar}>
              <RoundIconButton icon="chevron-left" label={t.common.back} onPress={flow.retake} />
            </View>
            <PhotoPreview photo={phase.photo} scanning={false} />
            <ScanPanel scheme={scheme}>
              <ScanFailureCard error={phase.error} onRetry={flow.retry} onManual={manual} />
            </ScanPanel>
          </View>
        )}
      </Screen>
    </SchemeOverride>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 0 },
  flex: { flex: 1 },
  topBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
});
