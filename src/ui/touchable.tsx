// A Pressable with consistent press feedback baked in — the thing most of the
// app's buttons/rows were missing. Dims on press (iOS + everywhere) and adds a
// subtle Android ripple. Drop-in for <Pressable>: it forwards every prop (and the
// ref, for callers that measure themselves) and merges the dim into whatever
// `style` you pass (object or state-function).
//
//   <Touchable style={{ ...btn }} onPress={…}>…</Touchable>
//
// Pass `dim={n}` to tune the pressed opacity, or `dim={1}` to disable the fade
// (e.g. when the element supplies its own pressed background).

import React from 'react';
import { Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

const FADE = 0.55;
const RIPPLE = 'rgba(127,127,127,0.18)';

export const Touchable = React.forwardRef<View, PressableProps & { dim?: number }>(function Touchable(
  { style, android_ripple, dim = FADE, ...props },
  ref,
) {
  return (
    <Pressable
      ref={ref}
      android_ripple={android_ripple ?? { color: RIPPLE }}
      style={(state) => {
        const base = (typeof style === 'function' ? style(state) : style) as StyleProp<ViewStyle>;
        return state.pressed ? [base, { opacity: dim }] : base;
      }}
      {...props}
    />
  );
});
