// The recursive renderer: one DivKit block → native RN components. This is the
// piece the Svelte web SDK does against the DOM; here it targets React Native's
// View / Text / Image / ScrollView. Expressions and templates are already
// resolved by the caller chain (templates up front, expressions per-prop here).

import React from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { resolve, resolveString, type Variables } from './expr';
import { CustomPlaceholder, getCustom } from './registry';
import { boxStyle, color, containerStyle, textStyle } from './style';
import type { DivAction, DivBlock, DivHost } from './types';

interface Ctx {
  vars: Variables;
  host: DivHost;
}

export function Div({ block, ctx }: { block: DivBlock; ctx: Ctx }): React.ReactElement | null {
  if (!block || typeof block !== 'object') return null;
  if (block.visibility === 'gone') return null;
  const invisible = block.visibility === 'invisible';
  const baseStyle = [boxStyle(block), invisible ? { opacity: 0 } : null];

  let node: React.ReactElement | null;
  switch (block.type) {
    case 'text':
      node = (
        <Text
          style={[textStyle(block), boxStyle(block)]}
          numberOfLines={block.max_lines}
        >
          {resolveString(block.text, ctx.vars)}
        </Text>
      );
      break;

    case 'image': {
      const uri = absolutize(resolveString(block.image_url, ctx.vars), ctx.host.baseUrl);
      node = <Image source={{ uri }} style={[{ width: 40, height: 40 }, baseStyle] as any} resizeMode="cover" />;
      break;
    }

    case 'separator': {
      const horizontal = block.delimiter_style?.orientation !== 'vertical';
      node = (
        <View
          style={[
            horizontal
              ? { height: 1, alignSelf: 'stretch' }
              : { width: 1, alignSelf: 'stretch' },
            { backgroundColor: color(block.delimiter_style?.color) ?? '#E5E7EB' },
            boxStyle(block),
          ]}
        />
      );
      break;
    }

    case 'gallery':
      node = (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={containerStyle({ ...block, orientation: 'horizontal' })}
          style={baseStyle}
        >
          {(block.items ?? []).map((c, i) => (
            <Div key={i} block={c} ctx={ctx} />
          ))}
        </ScrollView>
      );
      break;

    case 'grid': {
      const cols = block.column_count ?? 2;
      node = (
        <View style={[{ flexDirection: 'row', flexWrap: 'wrap' }, baseStyle]}>
          {(block.items ?? []).map((c, i) => (
            <View key={i} style={{ width: `${100 / cols}%` }}>
              <Div block={c} ctx={ctx} />
            </View>
          ))}
        </View>
      );
      break;
    }

    case 'state': {
      // Minimal: render the first state's div (state switching is variable-driven
      // and not used on the mobile surfaces yet).
      const states = (block.states as Array<{ div: DivBlock }>) ?? [];
      node = states.length ? <Div block={states[0].div} ctx={ctx} /> : null;
      break;
    }

    case 'custom': {
      const type = block.custom_type ?? '';
      const renderer = getCustom(type);
      const inner = renderer
        ? renderer({ block, customProps: block.custom_props ?? {}, host: ctx.host })
        : <CustomPlaceholder type={type} />;
      node = <View style={baseStyle}>{inner}</View>;
      break;
    }

    case 'container':
    default:
      node = (
        <View style={[containerStyle(block), baseStyle]}>
          {(block.items ?? []).map((c, i) => (
            <Div key={i} block={c} ctx={ctx} />
          ))}
        </View>
      );
      break;
  }

  return wrapActions(node, block, ctx);
}

function wrapActions(
  node: React.ReactElement | null,
  block: DivBlock,
  ctx: Ctx,
): React.ReactElement | null {
  if (!node) return null;
  const actions: DivAction[] = block.actions ?? (block.action ? [block.action] : []);
  if (actions.length === 0) return node;
  return (
    <Pressable
      onPress={() => {
        for (const a of actions) {
          const url = resolveString(a.url, ctx.vars);
          if (url) ctx.host.fire(url);
        }
      }}
      style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
    >
      {node}
    </Pressable>
  );
}

function absolutize(url: string, baseUrl?: string): string {
  if (!url || !baseUrl) return url;
  if (/^https?:\/\//.test(url) || url.startsWith('data:')) return url;
  return baseUrl.replace(/\/$/, '') + (url.startsWith('/') ? url : `/${url}`);
}

// re-export for convenience
export { resolve };
