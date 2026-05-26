import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated, Dimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SyncService } from '../services/SyncService';
import { DatabaseService } from '../services/DatabaseService';
import { COLORS, FONTS, SPACING, RADIUS } from '../utils/theme';

const { width: W } = Dimensions.get('window');

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const [isOnline, setIsOnline] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncStatus, setSyncStatus] = useState<string>('idle');

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.05, duration: 2000, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 2000, useNativeDriver: true }),
      ])
    ).start();

    const unsubscribe = SyncService.onStatusChange((status, count) => {
      setSyncStatus(status);
      setPendingCount(count);
    });

    setIsOnline(SyncService.getOnlineStatus());
    DatabaseService.getRecordCount().then(c => setPendingCount(c.pending));

    return unsubscribe;
  }, []);

  return (
    <View style={styles.container}>
      {/* Background grid */}
      <View style={styles.gridOverlay} />

      {/* Header */}
      <Animated.View style={[styles.header, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        <Text style={styles.appName}>DataLake 3.0</Text>
        <Text style={styles.tagline}>Offline Face ID System</Text>
        <View style={[styles.onlinePill, { backgroundColor: isOnline ? 'rgba(0,224,150,0.15)' : 'rgba(255,59,92,0.15)' }]}>
          <View style={[styles.onlineDot, { backgroundColor: isOnline ? COLORS.success : COLORS.danger }]} />
          <Text style={[styles.onlineText, { color: isOnline ? COLORS.success : COLORS.danger }]}>
            {isOnline ? 'Online' : 'Offline Mode'}
          </Text>
        </View>
      </Animated.View>

      {/* Central logo area */}
      <Animated.View style={[styles.logoArea, { transform: [{ scale: pulse }] }]}>
        <View style={styles.logoRing3} />
        <View style={styles.logoRing2} />
        <View style={styles.logoRing1} />
        <View style={styles.logoCore}>
          <Text style={styles.logoIcon}>◈</Text>
        </View>
      </Animated.View>

      {/* Stats */}
      <Animated.View style={[styles.statsRow, { opacity: fadeAnim }]}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{pendingCount}</Text>
          <Text style={styles.statLabel}>Pending Sync</Text>
        </View>
        <View style={[styles.statCard, styles.statCardCenter]}>
          <Text style={styles.statValue}>~13MB</Text>
          <Text style={styles.statLabel}>Model Size</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>&lt;1s</Text>
          <Text style={styles.statLabel}>Auth Speed</Text>
        </View>
      </Animated.View>

      {/* Main CTA */}
      <Animated.View style={[styles.actionArea, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        <TouchableOpacity style={styles.primaryButton} onPress={() => navigation.navigate('Auth')}>
          <Text style={styles.primaryButtonText}>AUTHENTICATE</Text>
          <Text style={styles.primaryButtonSub}>Tap to scan face</Text>
        </TouchableOpacity>

        <View style={styles.secondaryRow}>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => navigation.navigate('Enroll')}>
            <Text style={styles.secondaryButtonText}>Enroll Person</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => navigation.navigate('Dashboard')}>
            <Text style={styles.secondaryButtonText}>Dashboard</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.syncNavButton} onPress={() => navigation.navigate('Sync')}>
          <Text style={styles.syncNavButtonText}>
            {pendingCount > 0 ? `Sync & Purge · ${pendingCount} pending` : 'Sync & Purge'}
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, paddingHorizontal: SPACING.lg },
  gridOverlay: { ...StyleSheet.absoluteFillObject, opacity: 0.03 },

  header: { marginTop: 60, alignItems: 'center' },
  appName: { fontSize: 28, fontWeight: '700', color: COLORS.textPrimary, letterSpacing: 4, textTransform: 'uppercase' },
  tagline: { fontSize: 13, color: COLORS.textSecondary, marginTop: 4, letterSpacing: 2 },
  onlinePill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.full, marginTop: 12 },
  onlineDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  onlineText: { fontSize: 12, fontWeight: '600' },

  logoArea: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  logoRing3: { position: 'absolute', width: 240, height: 240, borderRadius: 120, borderWidth: 1, borderColor: 'rgba(0,200,255,0.06)' },
  logoRing2: { position: 'absolute', width: 180, height: 180, borderRadius: 90, borderWidth: 1, borderColor: 'rgba(0,200,255,0.12)' },
  logoRing1: { position: 'absolute', width: 120, height: 120, borderRadius: 60, borderWidth: 1.5, borderColor: 'rgba(0,200,255,0.25)' },
  logoCore: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(0,200,255,0.1)', justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: COLORS.primary },
  logoIcon: { fontSize: 32, color: COLORS.primary },

  statsRow: { flexDirection: 'row', marginBottom: SPACING.xl },
  statCard: { flex: 1, alignItems: 'center', paddingVertical: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  statCardCenter: { marginHorizontal: SPACING.sm },
  statValue: { fontSize: 22, fontWeight: '700', color: COLORS.primary },
  statLabel: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2, textTransform: 'uppercase', letterSpacing: 1 },

  actionArea: { paddingBottom: 48 },
  primaryButton: { backgroundColor: COLORS.primary, borderRadius: RADIUS.lg, paddingVertical: SPACING.lg, alignItems: 'center', marginBottom: SPACING.md },
  primaryButtonText: { fontSize: 18, fontWeight: '800', color: '#000', letterSpacing: 3 },
  primaryButtonSub: { fontSize: 12, color: 'rgba(0,0,0,0.6)', marginTop: 2 },

  secondaryRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.sm },
  secondaryButton: { flex: 1, paddingVertical: SPACING.md, alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  secondaryButtonText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },

  syncNavButton: { paddingVertical: SPACING.md, alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginTop: SPACING.sm },
  syncNavButtonText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
});
