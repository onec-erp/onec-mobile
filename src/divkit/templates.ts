// DivKit template resolution. The `templates` section of a card defines
// reusable blocks; a block references one by putting the template name in its
// `type`, and fills template parameters (template values written as `"$name"`)
// from its own properties. Templates may extend other templates.
//
// This mirrors the web SDK's template step, which runs *before* rendering and
// is fully platform-agnostic — so we reuse the idea verbatim for RN.

import type { DivBlock } from './types';

const MAX_DEPTH = 32;

export function applyTemplates(
  block: DivBlock,
  templates: Record<string, DivBlock>,
  depth = 0,
): DivBlock {
  if (depth > MAX_DEPTH || !block || typeof block !== 'object') return block;

  let resolved: DivBlock = block;

  if (block.type && templates[block.type]) {
    const tmpl = templates[block.type];
    const params: Record<string, unknown> = {};
    for (const k of Object.keys(block)) {
      if (k !== 'type') params[k] = (block as Record<string, unknown>)[k];
    }
    const consumed = new Set<string>();
    const expanded = substitute(tmpl, params, consumed) as DivBlock;

    // The template's own `type` may itself be a template → resolve again.
    const inner = applyTemplates(expanded, templates, depth + 1);

    // Instance properties that weren't template params override the result.
    const merged: DivBlock = { ...inner };
    for (const k of Object.keys(params)) {
      if (!consumed.has(k)) (merged as Record<string, unknown>)[k] = params[k];
    }
    resolved = merged;
  }

  // Recurse into children.
  if (Array.isArray(resolved.items)) {
    resolved = {
      ...resolved,
      items: resolved.items.map((c) => applyTemplates(c, templates, depth + 1)),
    };
  }
  return resolved;
}

/** Deep-copy `node`, replacing any `"$name"` string with `params[name]`. */
function substitute(node: unknown, params: Record<string, unknown>, consumed: Set<string>): unknown {
  if (typeof node === 'string') {
    if (node.startsWith('$') && node.length > 1) {
      const name = node.slice(1);
      if (name in params) {
        consumed.add(name);
        return params[name];
      }
    }
    return node;
  }
  if (Array.isArray(node)) return node.map((n) => substitute(n, params, consumed));
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      // A key written as `$prop` links a template param to an instance prop.
      if (k.startsWith('$') && typeof v === 'string' && v in params) {
        consumed.add(v);
        out[k.slice(1)] = params[v];
      } else {
        out[k] = substitute(v, params, consumed);
      }
    }
    return out;
  }
  return node;
}
