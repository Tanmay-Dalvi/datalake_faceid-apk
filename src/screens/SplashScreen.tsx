import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, Text, Animated, Dimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { COLORS, FONTS } from '../utils/theme';

const { width: W, height: H } = Dimensions.get('window');

export default function SplashScreen() {
  const navigation = useNavigation<any>();
  const logoScale   = useRef(new Animated.Value(0.6)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const ring1Scale  = useRef(new Animated.Value(0.8)).current;
  const ring2Scale  = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.spring(logoScale,   { toValue: 1, friction: 5, tension: 40, useNativeDriver: true }),
        Animated.timing(logoOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(textOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(ring1Scale,  { toValue: 1.15, friction: 4, useNativeDriver: true }),
        Animated.spring(ring2Scale,  { toValue: 1.3,  friction: 4, useNativeDriver: true }),
      ]),
    ]).start();

    const timer = setTimeout(() => navigation.replace('Home'), 2400);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.bgGrid} />

      <Animated.View style={[styles.logoWrap, { opacity: logoOpacity, transform: [{ scale: logoScale }] }]}>
        <Animated.View style={[styles.ring, styles.ring2, { transform: [{ scale: ring2Scale }] }]} />
        <Animated.View style={[styles.ring, styles.ring1, { transform: [{ scale: ring1Scale }] }]} />
        <View style={styles.logoCore}>
          <Text style={styles.logoGlyph}>◈</Text>
        </View>
      </Animated.View>

      <Animated.View style={[styles.textBlock, { opacity: textOpacity }]}>
        <Text style={styles.appName}>DATALAKE 3.0</Text>
        <Text style={styles.tagline}>Offline Face ID System</Text>
        <View style={styles.divider} />
        <Text style={styles.sub}>Powered by MobileFaceNet · ArcFace · CLAHE</Text>
      </Animated.View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Hackathon 7.0 Submission</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center' },
  bgGrid: { ...StyleSheet.absoluteFillObject },

  logoWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: 40 },
  ring: {
    position: 'absolute', borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(0,200,255,0.15)',
  },
  ring1: { width: 140, height: 140 },
  ring2: { width: 200, height: 200 },
  logoCore: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(0,200,255,0.08)',
    borderWidth: 1.5, borderColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  logoGlyph: { fontSize: 36, color: COLORS.primary },

  textBlock: { alignItems: 'center' },
  appName: {
    fontSize: 24, fontWeight: '800',
    letterSpacing: 6, color: COLORS.textPrimary,
    fontFamily: FONTS.heading,
  },
  tagline: { fontSize: 13, color: COLORS.textSecondary, letterSpacing: 3, marginTop: 6 },
  divider: { width: 40, height: 1, backgroundColor: 'rgba(0,200,255,0.3)', marginVertical: 14 },
  sub: { fontSize: 11, color: COLORS.textMuted, letterSpacing: 1 },

  footer: { position: 'absolute', bottom: 40 },
  footerText: { fontSize: 11, color: COLORS.textMuted, letterSpacing: 2 },
});
