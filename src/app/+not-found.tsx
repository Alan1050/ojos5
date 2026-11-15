import { Link } from 'expo-router';
import { StyleSheet, Text, useColorScheme, View } from 'react-native';
import { palettes } from '../constants/palette';

export default function NotFound() {
  const colors = palettes[useColorScheme() === 'dark' ? 'dark' : 'light'];
  return <View style={[styles.page, { backgroundColor: colors.background }]}><Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>No encontramos esta página</Text><Link href="/" style={[styles.link, { color: colors.primary }]}>Volver a Ojos</Link></View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 20 },
  title: { fontSize: 22, fontWeight: '600', textAlign: 'center' },
  link: { padding: 16, fontSize: 16 },
});
