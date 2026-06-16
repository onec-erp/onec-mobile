import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ONEC_BASE_URL } from './src/api/config';
import { OnecClient } from './src/api/onecClient';
import { DivCard } from './src/divkit';
import type { DivCardEnvelope } from './src/divkit';

type Status = 'connecting' | 'ready' | 'error';

export default function App() {
  const client = useRef(new OnecClient(ONEC_BASE_URL)).current;
  const [status, setStatus] = useState<Status>('connecting');
  const [error, setError] = useState<string>('');
  const [user, setUser] = useState<string>('');
  const [route, setRoute] = useState<string>('/');
  const [envelope, setEnvelope] = useState<DivCardEnvelope | null>(null);
  const [log, setLog] = useState<string[]>([]);

  // Load a content route from the server, replacing the current card.
  async function load(path: string) {
    setStatus('connecting');
    setError('');
    try {
      const env = (await client.content(path)) as DivCardEnvelope;
      setRoute(path);
      setEnvelope(env);
      setStatus('ready');
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setStatus('error');
    }
  }

  // Connect once: ensure logged in (admin/admin), then load home.
  useEffect(() => {
    (async () => {
      try {
        let me = await client.me();
        if (!me.authenticated) me = await client.login('admin', 'admin');
        setUser(me.username);
        await load('/');
      } catch (e: any) {
        setError(String(e?.message ?? e));
        setStatus('error');
      }
    })();
  }, []);

  // An onec:// action: log it, and navigate if it looks like a content route.
  function fire(url: string) {
    setLog((l) => [url, ...l].slice(0, 6));
    if (url.startsWith('onec://')) {
      const rest = url.slice('onec://'.length).replace(/\?.*$/, '');
      if (rest && !rest.includes('://')) load('/' + rest);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>OneC · React Native</Text>
          <Text style={styles.sub}>
            {ONEC_BASE_URL.replace(/^https?:\/\//, '')}
            {user ? `  ·  ${user}` : ''}
            {`  ·  ${route}`}
          </Text>
        </View>
        {route !== '/' && (
          <Pressable style={styles.btn} onPress={() => load('/')}>
            <Text style={styles.btnText}>Home</Text>
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {status === 'connecting' && (
          <View style={styles.center}>
            <ActivityIndicator />
            <Text style={styles.muted}>Loading {route} from the server…</Text>
          </View>
        )}

        {status === 'error' && (
          <View style={styles.center}>
            <Text style={styles.errTitle}>Couldn’t reach the server</Text>
            <Text style={styles.muted}>{error}</Text>
            <Text style={styles.muted}>Base URL: {ONEC_BASE_URL}</Text>
            <Pressable style={styles.btn} onPress={() => load(route)}>
              <Text style={styles.btnText}>Retry</Text>
            </Pressable>
          </View>
        )}

        {status === 'ready' && envelope && (
          <View style={styles.card}>
            <DivCard envelope={envelope} theme="light" fire={fire} baseUrl={ONEC_BASE_URL} />
          </View>
        )}

        <Text style={styles.kicker}>Dispatched actions</Text>
        <View style={styles.console}>
          {log.length === 0 ? (
            <Text style={styles.consoleMuted}>Tap something to fire its onec:// action…</Text>
          ) : (
            log.map((u, i) => (
              <Text key={i} style={styles.logLine}>
                → {u}
              </Text>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F3F4F6' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  title: { fontSize: 16, fontWeight: '700', color: '#0A0A0A' },
  sub: { fontSize: 12, color: '#737373', marginTop: 2 },
  btn: { backgroundColor: '#111827', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  btnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 13 },
  scroll: { padding: 16, gap: 12 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 48 },
  errTitle: { fontSize: 15, fontWeight: '700', color: '#B91C1C' },
  kicker: { fontSize: 12, fontWeight: '600', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', overflow: 'hidden' },
  muted: { color: '#6B7280', fontSize: 13, textAlign: 'center' },
  console: { backgroundColor: '#111827', borderRadius: 10, padding: 12, minHeight: 60, gap: 4 },
  consoleMuted: { color: '#6B7280', fontSize: 13 },
  logLine: { color: '#34D399', fontFamily: 'Courier', fontSize: 13 },
});
