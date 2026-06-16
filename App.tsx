import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DivCard } from './src/divkit';
import { sampleDocumentListCard } from './src/divkit/sampleCard';

export default function App() {
  const [log, setLog] = useState<string[]>([]);
  const envelope = sampleDocumentListCard();

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.kicker}>DivKit → React Native (no WebView)</Text>

        <View style={styles.card}>
          <DivCard
            envelope={envelope}
            theme="light"
            fire={(url) => setLog((l) => [url, ...l].slice(0, 6))}
          />
        </View>

        <Text style={styles.kicker}>Dispatched actions</Text>
        <View style={styles.console}>
          {log.length === 0 ? (
            <Text style={styles.muted}>Tap a row to fire its onec:// action…</Text>
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
  scroll: { padding: 16, gap: 12 },
  kicker: { fontSize: 12, fontWeight: '600', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  console: { backgroundColor: '#111827', borderRadius: 10, padding: 12, minHeight: 60, gap: 4 },
  muted: { color: '#6B7280', fontSize: 13 },
  logLine: { color: '#34D399', fontFamily: 'Courier', fontSize: 13 },
});
