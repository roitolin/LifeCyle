import { forwardRef, ReactNode } from "react";
import {
  Platform,
  ScrollViewProps,
  StyleProp,
  ViewStyle,
} from "react-native";
import {
  KeyboardAwareScrollView as KeyboardControllerScrollView,
  KeyboardAwareScrollViewRef,
} from "react-native-keyboard-controller";

type KeyboardAwareScrollViewProps = ScrollViewProps & {
  children: ReactNode;
  keyboardVerticalOffset?: number;
  bottomOffset?: number;
  extraKeyboardSpace?: number;
  style?: StyleProp<ViewStyle>;
};

const KeyboardAwareScrollView = forwardRef<KeyboardAwareScrollViewRef, KeyboardAwareScrollViewProps>(
  function KeyboardAwareScrollView(
    {
      children,
      keyboardShouldPersistTaps = "handled",
      keyboardVerticalOffset,
      bottomOffset,
      extraKeyboardSpace,
      style,
      ...scrollViewProps
    },
    ref
  ) {
    return (
      <KeyboardControllerScrollView
        {...scrollViewProps}
        ref={ref}
        style={style}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        bottomOffset={bottomOffset ?? keyboardVerticalOffset ?? 16}
        extraKeyboardSpace={extraKeyboardSpace}
      >
        {children}
      </KeyboardControllerScrollView>
    );
  }
);

export default KeyboardAwareScrollView;
