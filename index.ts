// Gesture handler must be imported once, before anything else, so its native
// module initializes correctly (required by @gorhom/bottom-sheet).
import 'react-native-gesture-handler';

import { registerRootComponent } from 'expo';
import { createElement } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';

import App from './App';

// Root provider stack:
//   GestureHandlerRootView   — required at the top for gesture-handler / bottom-sheet.
//   SafeAreaProvider         — so useSafeAreaInsets() can read notch / home-indicator insets.
//   BottomSheetModalProvider — lets any BottomSheetModal deep in the tree present itself.
const Root = () =>
  createElement(
    GestureHandlerRootView,
    { style: { flex: 1 } },
    createElement(
      SafeAreaProvider,
      null,
      createElement(BottomSheetModalProvider, null, createElement(App)),
    ),
  );

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately.
registerRootComponent(Root);
