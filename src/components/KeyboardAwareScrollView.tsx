import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Keyboard,
  Platform,
  ScrollView,
  TextInput,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { spacing } from '@/design/tokens';

type Props = {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
};

/** Gap kept between the focused field and the top of the keyboard. */
const FIELD_MARGIN = spacing.xxl;

/**
 * ScrollView that never lets the keyboard cover the focused field. Works with Android
 * edge-to-edge (where the window is not resized): it pads the content by the keyboard height
 * and scrolls the focused input into view. No extra dependency needed.
 */
export function KeyboardAwareScrollView({ children, contentContainerStyle }: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const offsetRef = useRef(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const { height: windowHeight } = useWindowDimensions();

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (event) => {
      const height = event.endCoordinates.height;
      setKeyboardHeight(height);
      const input = TextInput.State.currentlyFocusedInput();
      if (!input) return;
      // Wait a frame so the extra padding is laid out before scrolling.
      requestAnimationFrame(() => {
        input.measureInWindow((_x, y, _w, h) => {
          const visibleBottom = windowHeight - height - FIELD_MARGIN;
          const overlap = y + h - visibleBottom;
          if (overlap > 0) {
            scrollRef.current?.scrollTo({ y: offsetRef.current + overlap, animated: true });
          }
        });
      });
    });
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [windowHeight]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offsetRef.current = event.nativeEvent.contentOffset.y;
  };

  return (
    <ScrollView
      ref={scrollRef}
      onScroll={onScroll}
      scrollEventThrottle={32}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      contentContainerStyle={[
        contentContainerStyle,
        { paddingBottom: keyboardHeight + spacing.xxl },
      ]}
    >
      {children}
    </ScrollView>
  );
}
