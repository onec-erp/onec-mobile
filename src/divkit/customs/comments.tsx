// onec-comments — a per-record discussion thread. custom_props.target =
// { kind, name, id }; the widget loads/posts from /api/comments/... It mirrors the
// web entity-comments-widget: a card with the thread listed above an inline
// composer (input + Send side by side), author avatars, and relative timestamps.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Text, TextInput, View } from 'react-native';
import type { Row } from '../../api/onecClient';
import { onUiEvent } from '../../api/events';
import { colors } from '../theme';
import type { CustomRenderer, DivHost } from '../types';
import { LucideIcon } from './lucide';
import { Touchable } from '../../ui/touchable';

// Up to two initials from a display name, for the author avatar fallback.
function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

// A compact "time ago" for recent comments, falling back to an absolute date for
// older ones. createdAt is a server LocalDateTime (no zone), read in local time.
function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 45) return 'just now';
  if (secs < 90) return 'a minute ago';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function Avatar({ url, name, c }: { url?: string | null; name?: string | null; c: ReturnType<typeof colors> }) {
  const size = 30;
  const base = { width: size, height: size, borderRadius: size / 2 } as const;
  if (url) return <Image source={{ uri: url }} style={[base, { backgroundColor: c.surface }]} />;
  return (
    <View style={[base, { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ fontSize: 11, fontWeight: '600', color: c.muted }}>{initials(name)}</Text>
    </View>
  );
}

function Comments({ target, host }: { target: Record<string, any>; host: DivHost }) {
  const c = colors(host.theme);
  const kind = (target.kind as string) ?? '';
  const name = (target.name as string) ?? '';
  const id = (target.id as string) ?? '';
  const [comments, setComments] = useState<Row[] | null>(null);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);

  async function load() {
    try {
      setComments(await host.client.comments(kind, name, id));
    } catch {
      setComments([]);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, name, id]);

  // Live-sync: the server stamps a comment post/delete as an EntityChangedEvent
  // (entityType "comment", scoped to this record's name+id) on the same SSE stream.
  // Refetch the thread when one matches, so other viewers' posts/deletes appear without
  // a reload. The viewer's own write already showed optimistically — this reconciles it.
  useEffect(() => {
    return onUiEvent((ev) => {
      if (ev.entityType === 'comment' && String(ev.id) === String(id) && ev.entityName === name) load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, name, id]);

  async function send() {
    const body = text.trim();
    if (!body || posting) return;
    setPosting(true);
    try {
      const saved = await host.client.addComment(kind, name, id, body);
      // Append the saved row optimistically (it carries the server-stamped author
      // and timestamp) rather than re-fetching the whole thread.
      setComments((prev) => [...(prev ?? []), saved]);
      setText('');
    } catch {
      /* keep the draft so the user can retry */
    } finally {
      setPosting(false);
    }
  }

  async function remove(commentId: string) {
    // Optimistic: drop it immediately, restore the prior list on failure.
    const prev = comments;
    setComments((cur) => (cur ?? []).filter((cm) => String(cm.id) !== commentId));
    try {
      await host.client.deleteComment(commentId);
    } catch {
      setComments(prev ?? null);
    }
  }

  const count = comments?.length ?? 0;
  const canSend = !!text.trim() && !posting;

  return (
    <View style={{ marginTop: 8, borderRadius: 16, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, padding: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <LucideIcon name="message-square" size={16} color={c.muted} />
        <Text style={{ fontSize: 14, fontWeight: '600', color: c.text }}>Comments</Text>
        {count > 0 ? <Text style={{ fontSize: 14, color: c.muted }}>{count}</Text> : null}
      </View>

      {/* Thread first, composer last — the order a mobile reader expects. */}
      {comments == null ? (
        <Text style={{ color: c.muted, fontSize: 13 }}>Loading…</Text>
      ) : comments.length === 0 ? (
        <Text style={{ color: c.muted, fontSize: 13 }}>No comments yet. Start the conversation below.</Text>
      ) : (
        <View style={{ gap: 14 }}>
          {comments.map((cm, i) => {
            const cid = String(cm.id ?? i);
            const author = (cm.authorName as string) || 'Unknown';
            const when = timeAgo(cm.createdAt as string);
            const edited = cm.editedAt ? ' · edited' : '';
            return (
              <View key={cid} style={{ flexDirection: 'row', gap: 10 }}>
                <Avatar url={cm.authorAvatarUrl as string} name={cm.authorName as string} c={c} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: c.text }} numberOfLines={1}>{author}</Text>
                    {when ? <Text style={{ fontSize: 12, color: c.muted }}>{when}{edited}</Text> : null}
                    {cm.canDelete ? (
                      <Touchable
                        onPress={() => remove(cid)}
                        hitSlop={8}
                        style={{ marginLeft: 'auto', padding: 2 }}
                        accessibilityLabel="Delete comment"
                      >
                        <LucideIcon name="trash-2" size={15} color={c.muted} />
                      </Touchable>
                    ) : null}
                  </View>
                  <Text style={{ fontSize: 14, color: c.text, marginTop: 2 }}>{String(cm.body ?? '')}</Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Inline composer: input grows, Send pinned to its bottom-right. */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 16 }}>
        <TextInput
          style={{ flex: 1, borderWidth: 1, borderColor: c.fieldBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: c.text, minHeight: 44, maxHeight: 120, backgroundColor: c.fieldBg }}
          value={text}
          onChangeText={setText}
          placeholder="Write a comment…"
          placeholderTextColor={c.muted}
          multiline
          textAlignVertical="top"
          editable={!posting}
        />
        <Touchable
          style={{ height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, paddingHorizontal: 16, backgroundColor: c.accentBg, opacity: canSend ? 1 : 0.5 }}
          disabled={!canSend}
          onPress={send}
        >
          {posting ? (
            <ActivityIndicator color={c.accentFg} size="small" />
          ) : (
            <>
              <LucideIcon name="send" size={15} color={c.accentFg} />
              <Text style={{ color: c.accentFg, fontWeight: '600', fontSize: 14 }}>Send</Text>
            </>
          )}
        </Touchable>
      </View>
    </View>
  );
}

export const onecComments: CustomRenderer = ({ block, host }) => {
  const target = (block.custom_props?.target as Record<string, any>) ?? {};
  return <Comments target={target} host={host} />;
};
