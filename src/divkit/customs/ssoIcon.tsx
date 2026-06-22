// onno-sso-icon — the provider's brand mark on a server-driven SSO button (e.g. the Telegram logo on
// "Войти через Telegram"). The web renders this via sso-icon-bridge; here we render the remote logo.
//
// Registering this custom is also what keeps the SSO button WORKING: DivKit drops the tap action on a
// container that holds an UNKNOWN custom block, so before this renderer existed the button rendered but
// did nothing. The framework (onno-ui #170) puts this mark inside the button, so the app must know it.
import React from 'react';
import { Image } from 'react-native';
import { SvgUri } from 'react-native-svg';
import { color } from '../style';
import type { CustomRenderer } from '../types';

/** Resolve a possibly-relative icon url (e.g. /api/auth/telegram/logo.svg) against the server base. */
function absUrl(url: string, base?: string): string {
  if (!url || /^https?:\/\//.test(url) || url.startsWith('data:')) return url;
  if (!base) return url;
  return base.replace(/\/$/, '') + (url.startsWith('/') ? url : `/${url}`);
}

export const onnoSsoIcon: CustomRenderer = ({ customProps, host }) => {
  const raw = customProps.src as string | undefined;
  const size = Number(customProps.size ?? 18);
  if (!raw) return null;
  const uri = absUrl(raw, host.baseUrl);
  const tint = color(customProps.color as string | undefined);
  const monochrome = customProps.monochrome === true;

  // The framework's marks are SVG and drawn with fill="currentColor"; SvgUri's `color` sets that, so a
  // monochrome mark follows the button's text color while a logo with its own fills is unaffected.
  if (uri.toLowerCase().split('?')[0].endsWith('.svg')) {
    return <SvgUri uri={uri} width={size} height={size} color={tint} />;
  }
  return (
    <Image
      source={{ uri }}
      style={{ width: size, height: size, ...(monochrome && tint ? { tintColor: tint } : null) }}
      resizeMode="contain"
    />
  );
};
