// Top-level host for a DivKit card envelope (`{ templates, card }`). Resolves
// templates once, seeds the card's variables into state, and renders the active
// state's root block. Action dispatch and image-origin resolution come from the
// embedding app via the `host` prop.

import React, { useMemo, useState } from 'react';
import { Div } from './Div';
import { applyTemplates } from './templates';
import type { DivCardEnvelope, DivHost, DivVariable } from './types';

export interface DivCardProps {
  envelope: DivCardEnvelope;
  /** url dispatcher (`onec://…`); image origin; theme. */
  fire: (url: string) => void;
  baseUrl?: string;
  theme?: 'light' | 'dark';
  /** which card state to show (defaults to the first). */
  stateId?: number;
}

export function DivCard({ envelope, fire, baseUrl, theme = 'light', stateId }: DivCardProps) {
  const { card, templates = {} } = envelope;

  // Variables: seed from the card, expose get/set to children and customs.
  const [vars, setVars] = useState<Record<string, unknown>>(() => seedVars(card.variables));
  const host: DivHost = useMemo(
    () => ({
      fire,
      baseUrl,
      theme,
      getVar: (name) => vars[name],
      setVar: (name, value) => setVars((v) => ({ ...v, [name]: value })),
    }),
    [fire, baseUrl, theme, vars],
  );

  const state = useMemo(() => {
    const states = card.states ?? [];
    const chosen = stateId != null ? states.find((s) => s.state_id === stateId) : states[0];
    if (!chosen) return null;
    return applyTemplates(chosen.div, templates);
  }, [card, templates, stateId]);

  if (!state) return null;
  return <Div block={state} ctx={{ vars, host }} />;
}

function seedVars(vars?: DivVariable[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const v of vars ?? []) out[v.name] = v.value;
  return out;
}
