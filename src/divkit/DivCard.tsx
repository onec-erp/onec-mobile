// Top-level host for a DivKit card envelope (`{ templates, card }`). Resolves
// templates once, seeds the card's variables (plus any externally-injected ones
// like `active_path`), and renders the active state. Action dispatch, the API
// client, refresh, and image-origin come from the embedding app.

import React, { useMemo, useState } from 'react';
import type { OnecClient } from '../api/onecClient';
import { Div } from './Div';
import { applyTemplates } from './templates';
import type { DivCardEnvelope, DivHost, DivVariable } from './types';

export interface DivCardProps {
  envelope: DivCardEnvelope;
  fire: (url: string) => void;
  client: OnecClient;
  refresh?: () => void;
  baseUrl?: string;
  theme?: 'light' | 'dark';
  /** Variables injected by the app (e.g. `active_path` for nav highlight). */
  vars?: Record<string, unknown>;
  stateId?: number;
}

export function DivCard({
  envelope,
  fire,
  client,
  refresh,
  baseUrl,
  theme = 'light',
  vars: externalVars,
  stateId,
}: DivCardProps) {
  const { card, templates = {} } = envelope;
  const [localVars, setLocalVars] = useState<Record<string, unknown>>(() => seedVars(card.variables));

  // External vars (active_path, …) overlay the card's own, and stay live.
  const vars = useMemo(() => ({ ...localVars, ...(externalVars ?? {}) }), [localVars, externalVars]);

  const host: DivHost = useMemo(
    () => ({
      fire,
      client,
      refresh: refresh ?? (() => {}),
      baseUrl,
      theme,
      getVar: (name) => vars[name],
      setVar: (name, value) => setLocalVars((v) => ({ ...v, [name]: value })),
    }),
    [fire, client, refresh, baseUrl, theme, vars],
  );

  const state = useMemo(() => {
    const states = card.states ?? [];
    const chosen = stateId != null ? states.find((s) => s.state_id === stateId) : states[0];
    return chosen ? applyTemplates(chosen.div, templates) : null;
  }, [card, templates, stateId]);

  if (!state) return null;
  return <Div block={state} ctx={{ vars, host }} />;
}

function seedVars(vars?: DivVariable[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const v of vars ?? []) out[v.name] = v.value;
  return out;
}
