// ResultModal.tsx
import React, { useRef, useEffect } from 'react';
import { StyleSheet, View, Text, Animated, TouchableOpacity } from 'react-native';
import { RecognitionResult } from '../services/FaceRecognitionService';
import { COLORS, FONTS, RADIUS, SPACING } from '../utils/theme';

interface Props {
  phase: 'GRANTED' | 'DENIED';
  result: RecognitionResult;
  onDismiss: () => void;
}

export default function ResultModal({ phase, result, onDismiss }: Props) {
  const slideAnim = useRef(new Animated.Value(60)).current;
  const fadeAnim  = useRef(new Animated.Value(0)).current;

  const isGranted = phase === 'GRANTED';
  const color = isGranted ? COLORS.success : COLORS.danger;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, { toValue: 0, friction: 8, tension: 50, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
          borderColor: isGranted ? 'rgba(0,224,150,0.3)' : 'rgba(255,59,92,0.3)',
          backgroundColor: isGranted ? 'rgba(0,224,150,0.06)' : 'rgba(255,59,92,0.06)',
        },
      ]}
    >
      <View style={[styles.iconCircle, { borderColor: color }]}>
        <Text style={[styles.icon, { color }]}>{isGranted ? '✓' : '✗'}</Text>
      </View>

      <Text style={[styles.statusText, { color }]}>
        {isGranted ? 'ACCESS GRANTED' : 'ACCESS DENIED'}
      </Text>

      {isGranted && result.personId && (
        <Text style={styles.personId}>{result.personId}</Text>
      )}

      <View style={styles.confRow}>
        <Text style={styles.confLabel}>Match confidence</Text>
        <Text style={[styles.confValue, { color }]}>
          {(result.similarity * 100).toFixed(1)}%
        </Text>
      </View>

      <View style={styles.confRow}>
        <Text style={styles.confLabel}>Processing time</Text>
        <Text style={[styles.confValue, { color: COLORS.textSecondary }]}>
          {result.processingMs}ms
        </Text>
      </View>

      <TouchableOpacity style={[styles.dismissBtn, { borderColor: color }]} onPress={onDismiss}>
        <Text style={[styles.dismissText, { color }]}>
          {isGranted ? 'Continue' : 'Try Again'}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── StatusBar component (separate export) ──────────────────────────────────
interface StatusBarProps {
  phase: string;
  isOnline: boolean;
  livenessScore: number;
}

export function StatusBar({ phase, isOnline, livenessScore }: StatusBarProps) {
  return (
    <View style={statusStyles.container}>
      <View style={[statusStyles.pill, { backgroundColor: isOnline ? 'rgba(0,224,150,0.15)' : 'rgba(255,59,92,0.15)' }]}>
        <View style={[statusStyles.dot, { backgroundColor: isOnline ? COLORS.success : COLORS.danger }]} />
        <Text style={[statusStyles.pillText, { color: isOnline ? COLORS.success : COLORS.danger }]}>
          {isOnline ? 'Online' : 'Offline'}
        </Text>
      </View>

      <View style={statusStyles.phaseChip}>
        <Text style={statusStyles.phaseText}>{phase}</Text>
      </View>

      {livenessScore > 0 && (
        <View style={statusStyles.livenessPill}>
          <Text style={statusStyles.livenessText}>PAD {(livenessScore * 100).toFixed(0)}%</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 100, left: 20, right: 20,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.lg,
    alignItems: 'center',
  },
  iconCircle: {
    width: 64, height: 64, borderRadius: 32,
    borderWidth: 2, alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  icon: { fontSize: 32 },
  statusText: { fontSize: 18, fontWeight: '800', letterSpacing: 2, fontFamily: FONTS.heading, marginBottom: 8 },
  personId: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 12 },
  confRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    width: '100%', paddingVertical: 4,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
    marginBottom: 4,
  },
  confLabel: { fontSize: 12, color: COLORS.textSecondary },
  confValue: { fontSize: 13, fontWeight: '700', fontFamily: FONTS.heading },
  dismissBtn: {
    marginTop: 16, paddingHorizontal: 32, paddingVertical: 10,
    borderRadius: RADIUS.full, borderWidth: 1.5,
  },
  dismissText: { fontSize: 14, fontWeight: '700', letterSpacing: 1 },
});

const statusStyles = StyleSheet.create({
  container: {
    position: 'absolute', top: 56, left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADIUS.full,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 11, fontWeight: '700' },
  phaseChip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADIUS.full,
    backgroundColor: 'rgba(0,200,255,0.1)', borderWidth: 1, borderColor: 'rgba(0,200,255,0.2)',
  },
  phaseText: { fontSize: 11, fontWeight: '700', color: COLORS.primary, letterSpacing: 1 },
  livenessPill: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADIUS.full,
    backgroundColor: 'rgba(0,255,178,0.08)', borderWidth: 1, borderColor: 'rgba(0,255,178,0.2)',
  },
  livenessText: { fontSize: 11, fontWeight: '700', color: COLORS.accent },
});
