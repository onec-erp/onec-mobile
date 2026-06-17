// onec-comments — a per-record discussion thread. custom_props.target =
// { kind, name, id }; the widget loads/posts from /api/comments/... Port of
// onec_comments.dart.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Row } from '../../api/onecClient';
import { formatMonthDay, pickField } from '../format';
import type { CustomRenderer, DivHost } from '../types';

function Comments({ target, host }: { target: Record<string, any>; host: DivHost }) {
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

  async function send() {
    const body = text.trim();
    if (!body || posting) return;
    setPosting(true);
    try {
      await host.client.addComment(kind, name, id, body);
      setText('');
      await load();
    } catch {
      /* ignore; keep text */
    } finally {
      setPosting(false);
    }
  }

  return (
    <View>
      <Text style={s.title}>Comments</Text>
      <View style={s.composer}>
        <TextInput
          style={s.input}
          value={text}
          onChangeText={setText}
          placeholder="Add a comment…"
          placeholderTextColor="#9CA3AF"
          multiline
        />
        <Pressable style={[s.send, (!text.trim() || posting) && { opacity: 0.5 }]} disabled={!text.trim() || posting} onPress={send}>
          {posting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.sendText}>Post</Text>}
        </Pressable>
      </View>

      {comments == null ? (
        <ActivityIndicator style={{ marginVertical: 16 }} />
      ) : comments.length === 0 ? (
        <Text style={s.muted}>No comments yet.</Text>
      ) : (
        comments.map((c, i) => {
          const author = pickField(c, ['author_display', 'author', 'createdBy', 'user']) ?? '—';
          const dateStr = String(c._date ?? c.createdAt ?? c.created_at ?? '');
          const body = String(c.body ?? c.text ?? '');
          return (
            <View key={c._id ?? i} style={s.comment}>
              <View style={s.commentHead}>
                <Text style={s.author}>{author}</Text>
                {dateStr ? <Text style={s.muted}>{formatMonthDay(dateStr) ?? ''}</Text> : null}
              </View>
              <Text style={s.body}>{body}</Text>
            </View>
          );
        })
      )}
    </View>
  );
}

export const onecComments: CustomRenderer = ({ block, host }) => {
  const target = (block.custom_props?.target as Record<string, any>) ?? {};
  return <Comments target={target} host={host} />;
};

const s = StyleSheet.create({
  title: { fontSize: 16, fontWeight: '700', color: '#0A0A0A', marginBottom: 10 },
  composer: { gap: 8, marginBottom: 14 },
  input: {
    borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: '#0A0A0A', minHeight: 44, backgroundColor: '#FFFFFF',
  },
  send: { backgroundColor: '#111827', borderRadius: 8, paddingVertical: 10, alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 20 },
  sendText: { color: '#FFFFFF', fontWeight: '600' },
  muted: { color: '#737373', fontSize: 12 },
  comment: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  commentHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  author: { fontWeight: '600', color: '#0A0A0A', fontSize: 13 },
  body: { color: '#374151', fontSize: 14 },
});
