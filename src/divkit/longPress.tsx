// The web's "right-click a link" menu, mobile-side, with an iOS haptic-touch feel.
// Long-pressing a navigable element opens a context menu you can slide onto and
// release to fire (or release in place and tap): Open it, copy its shareable web
// URL, or open that URL in the system browser. The web URL comes from
// `host.linkFor` — side-effect actions (post/delete/logout/theme) return null and
// get no menu, exactly like right-clicking a button vs. a link on the web.
//
// One continuous gesture drives the whole thing: a gesture-handler LongPress on
// the trigger opens the overlay (../ui/contextMenu), feeds it the live finger
// position as it moves, and commits on release. `runOnJS(true)` keeps the
// callbacks on the JS thread so they can drive the store directly.

import React, { useMemo } from 'react';
import { Linking } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import {
  commitContextMenu,
  moveContextMenu,
  openContextMenu,
  type ContextMenuItem,
} from '../ui/contextMenu';
import { toast } from '../ui/toast';
import type { DivHost } from './types';

/** The menu for a navigable action url, or null when it isn't a link. */
function linkMenuItems(host: DivHost, url: string): ContextMenuItem[] | null {
  const link = host.linkFor?.(url);
  if (!link) return null;
  return [
    { label: 'Open', icon: 'arrow-up-right', onPress: () => host.fire(url) },
    {
      label: 'Copy link',
      icon: 'link',
      onPress: async () => {
        await Clipboard.setStringAsync(link);
        toast.success('Link copied');
      },
    },
    {
      label: 'Open in browser',
      icon: 'external-link',
      onPress: () => {
        Linking.openURL(link).catch(() => toast.error("Couldn't open the link"));
      },
    },
  ];
}

/** True when long-pressing `url` would offer a link menu — used to decide whether
 *  to wrap the element at all (so non-link actions keep their plain tap). */
export function hasLinkMenu(host: DivHost, url: string): boolean {
  return !!host.linkFor?.(url);
}

function buildGesture(host: DivHost, url: string) {
  return Gesture.LongPress()
    .runOnJS(true)
    .minDuration(300) // a deliberate hold, so a quick tap still navigates and a flick still scrolls
    .maxDistance(20) // moving before it fires lets the scroll win; after it fires, dragging is free
    .shouldCancelWhenOutside(false)
    .onStart((e) => {
      const items = linkMenuItems(host, url);
      if (!items) return;
      // A firm tick on reveal, like iOS's own context menus.
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      host.lockScroll?.(true); // freeze the page so the drag-to-select doesn't scroll it
      openContextMenu(items, { x: e.absoluteX, y: e.absoluteY }, () => host.lockScroll?.(false));
    })
    .onTouchesMove((e) => {
      const t = e.changedTouches[0] ?? e.allTouches[0];
      if (t) moveContextMenu(t.absoluteX, t.absoluteY);
    })
    .onEnd(() => commitContextMenu());
}

/** Wrap a tappable element so a long-press opens its link menu. Renders the child
 *  as-is when `url` isn't a link (no gesture, no overhead). `children` must be a
 *  single element backed by a native view (e.g. a Pressable). */
export function ContextMenuArea({
  host,
  url,
  children,
}: {
  host: DivHost;
  url?: string;
  children: React.ReactElement;
}) {
  const enabled = !!url && hasLinkMenu(host, url);
  const gesture = useMemo(() => (enabled ? buildGesture(host, url!) : null), [host, url, enabled]);
  if (!gesture) return children;
  return <GestureDetector gesture={gesture}>{children}</GestureDetector>;
}
