/**
 * Design Tokens — DataLake FaceID
 * --------------------------------
 * Central theme file for the entire app.
 * Dark-mode-first, cyberpunk-inspired palette optimized for
 * readability on outdoor AMOLED displays.
 */

export const COLORS = {
  // Backgrounds
  background: '#060B18',
  surface: 'rgba(255,255,255,0.04)',
  surfaceAlt: 'rgba(255,255,255,0.08)',
  border: 'rgba(255,255,255,0.08)',

  // Brand
  primary: '#00C8FF',     // Cyan-blue — main accent
  accent: '#00FFB2',      // Mint-green — liveness / success-secondary
  secondary: '#7B61FF',   // Purple — secondary accent

  // Semantic
  success: '#00E096',     // Green — granted / synced
  danger: '#FF3B5C',      // Red — denied / error
  warning: '#FFB020',     // Amber — pending / caution

  // Text hierarchy
  textPrimary: '#F0F4FF',
  textSecondary: 'rgba(240,244,255,0.6)',
  textMuted: 'rgba(240,244,255,0.35)',
};

export const FONTS = {
  heading: undefined,       // Falls back to platform default (SF Pro / Roboto)
  body: undefined,
  mono: 'monospace',       // Used in sync logs & technical readouts
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const RADIUS = {
  sm: 6,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
};
