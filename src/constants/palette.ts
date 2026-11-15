// Native equivalents of the supplied CSS variables. The system chooses the theme.
const shared = { secondary: '#1a2a6c', deepBlue: '#0b1b3b', orange: '#ff8a00', white: '#ffffff' };
export const palettes = {
  light: { ...shared, background: '#f4f7fb', foreground: '#17263e', card: '#ffffff', surface: '#f8fafc', primary: '#087acb', accent: '#087f9d', border: '#dce5f0', borderSubtle: '#edf1f6', muted: '#61718a', textSecondary: '#53657d' },
  dark: { ...shared, background: '#080f1c', foreground: '#eaf0f9', card: '#0e1828', surface: '#0b1423', primary: '#61b8ff', accent: '#51d5e8', border: '#213047', borderSubtle: '#1b273a', muted: '#8b9ab0', textSecondary: '#a1aec2' },
};
export type Palette = typeof palettes.light;
