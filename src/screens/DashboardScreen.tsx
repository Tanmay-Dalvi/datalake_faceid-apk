import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet, View, Text, ScrollView,
  TouchableOpacity, Animated, RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { DatabaseService, AttendanceRecord } from '../services/DatabaseService';
import { SyncService } from '../services/SyncService';
import { COLORS, FONTS, SPACING, RADIUS } from '../utils/theme';

interface KPI {
  label: string;
  value: string;
  color: string;
  delta?: string;
}

export default function DashboardScreen() {
  const navigation = useNavigation<any>();
  const [records, setRecords]   = useState<AttendanceRecord[]>([]);
  const [counts, setCounts]     = useState({ total: 0, synced: 0, pending: 0 });
  const [isOnline, setIsOnline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    loadData();
    const unsub = SyncService.onStatusChange(() => {
      loadData();
      setIsOnline(SyncService.getOnlineStatus());
    });
    setIsOnline(SyncService.getOnlineStatus());

    Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    return unsub;
  }, []);

  const loadData = async () => {
    const [recs, c] = await Promise.all([
      DatabaseService.getTodayRecords(),
      DatabaseService.getRecordCount(),
    ]);
    setRecords(recs);
    setCounts(c);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const kpis: KPI[] = [
    { label: 'Total Today',  value: counts.total.toString(),  color: COLORS.primary,   delta: 'All records' },
    { label: 'Synced',       value: counts.synced.toString(), color: COLORS.success,   delta: 'To AWS' },
    { label: 'Pending Sync', value: counts.pending.toString(), color: COLORS.warning,  delta: 'In queue' },
    { label: 'Avg Speed',    value: '<1s',                     color: COLORS.accent,   delta: 'On-device' },
  ];

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const getInitials = (name: string) => {
    if (!name) return '??';
    return name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  };

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Dashboard</Text>
        <View style={[styles.onlinePill, { backgroundColor: isOnline ? 'rgba(0,224,150,0.12)' : 'rgba(255,59,92,0.12)' }]}>
          <View style={[styles.onlineDot, { backgroundColor: isOnline ? COLORS.success : COLORS.danger }]} />
          <Text style={[styles.onlineText, { color: isOnline ? COLORS.success : COLORS.danger }]}>
            {isOnline ? 'Online' : 'Offline'}
          </Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        {/* Date label */}
        <Text style={styles.dateLabel}>
          {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </Text>

        {/* KPI row */}
        <View style={styles.kpiRow}>
          {kpis.map((k, i) => (
            <View key={i} style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>{k.label}</Text>
              <Text style={[styles.kpiValue, { color: k.color }]}>{k.value}</Text>
              {k.delta && <Text style={styles.kpiDelta}>{k.delta}</Text>}
            </View>
          ))}
        </View>

        {/* Model info strip */}
        <View style={styles.modelStrip}>
          <View style={styles.modelItem}>
            <Text style={styles.modelItemLabel}>Recognition</Text>
            <Text style={styles.modelItemValue}>MobileFaceNet INT8</Text>
          </View>
          <View style={styles.modelItemDivider} />
          <View style={styles.modelItem}>
            <Text style={styles.modelItemLabel}>Liveness</Text>
            <Text style={styles.modelItemValue}>MiniXception PAD</Text>
          </View>
          <View style={styles.modelItemDivider} />
          <View style={styles.modelItem}>
            <Text style={styles.modelItemLabel}>Size</Text>
            <Text style={styles.modelItemValue}>~13 MB total</Text>
          </View>
        </View>

        {/* Attendance log */}
        <View style={styles.tableCard}>
          <View style={styles.tableHeader}>
            <Text style={styles.tableTitle}>Attendance Log</Text>
            {counts.pending > 0 && (
              <TouchableOpacity
                style={[
                  styles.syncNowBtn,
                  !SyncService.isCloudConfigured() && { backgroundColor: 'rgba(255,176,32,0.1)', borderColor: 'rgba(255,176,32,0.25)' }
                ]}
                onPress={() => {
                  if (SyncService.isCloudConfigured()) {
                    SyncService.triggerSync();
                  } else {
                    navigation.navigate('Sync');
                  }
                }}
              >
                <Text style={[
                  styles.syncNowText,
                  !SyncService.isCloudConfigured() && { color: COLORS.warning }
                ]}>
                  {SyncService.isCloudConfigured() ? `Sync ${counts.pending}` : `${counts.pending} Local`}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {records.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>◎</Text>
              <Text style={styles.emptyText}>No records yet today</Text>
              <Text style={styles.emptySubtext}>Authentications will appear here</Text>
            </View>
          ) : (
            records.map((rec, i) => (
              <View key={rec.id} style={[styles.recordRow, i === records.length - 1 && styles.recordRowLast]}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{getInitials(rec.personName)}</Text>
                </View>
                <View style={styles.recordInfo}>
                  <Text style={styles.recordName}>{rec.personName}</Text>
                  <Text style={styles.recordTime}>{formatTime(rec.timestamp)}</Text>
                </View>
                <View style={styles.recordRight}>
                  <Text style={[styles.recordSim, { color: rec.similarity >= 0.95 ? COLORS.success : COLORS.warning }]}>
                    {(rec.similarity * 100).toFixed(1)}%
                  </Text>
                  <View style={[
                    styles.syncPill,
                    rec.synced
                      ? { backgroundColor: 'rgba(0,224,150,0.1)', borderColor: 'rgba(0,224,150,0.25)' }
                      : { backgroundColor: 'rgba(255,176,32,0.1)', borderColor: 'rgba(255,176,32,0.25)' },
                  ]}>
                    <Text style={[styles.syncPillText, { color: rec.synced ? COLORS.success : COLORS.warning }]}>
                      {rec.synced ? 'Synced' : 'Pending'}
                    </Text>
                  </View>
                </View>
              </View>
            ))
          )}
        </View>

        {/* Security note */}
        <View style={styles.securityNote}>
          <Text style={styles.securityIcon}>🔒</Text>
          <Text style={styles.securityText}>
            All records encrypted with AES-256-GCM. Raw images never stored. Embeddings purged after AWS sync confirmation.
          </Text>
        </View>
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 56, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.full, backgroundColor: COLORS.surface },
  backBtnText: { color: COLORS.textSecondary, fontSize: 13 },
  title: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary, fontFamily: FONTS.heading },
  onlinePill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADIUS.full },
  onlineDot: { width: 6, height: 6, borderRadius: 3, marginRight: 5 },
  onlineText: { fontSize: 12, fontWeight: '600' },

  content: { padding: SPACING.lg },

  dateLabel: { fontSize: 13, color: COLORS.textSecondary, marginBottom: SPACING.md },

  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: SPACING.md },
  kpiCard: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.md,
    padding: 12, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center',
  },
  kpiLabel: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.5, color: COLORS.textMuted, marginBottom: 4 },
  kpiValue: { fontSize: 22, fontWeight: '800', fontFamily: FONTS.heading },
  kpiDelta: { fontSize: 10, color: COLORS.textMuted, marginTop: 2 },

  modelStrip: {
    flexDirection: 'row', backgroundColor: COLORS.surface, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.md,
    overflow: 'hidden',
  },
  modelItem: { flex: 1, padding: 12, alignItems: 'center' },
  modelItemLabel: { fontSize: 9, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 3 },
  modelItemValue: { fontSize: 11, fontWeight: '700', color: COLORS.primary, textAlign: 'center' },
  modelItemDivider: { width: 1, backgroundColor: COLORS.border },

  tableCard: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden',
    marginBottom: SPACING.md,
  },
  tableHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  tableTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 2, color: COLORS.textSecondary },
  syncNowBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: RADIUS.full, backgroundColor: 'rgba(0,255,178,0.1)', borderWidth: 1, borderColor: 'rgba(0,255,178,0.25)' },
  syncNowText: { fontSize: 11, fontWeight: '700', color: COLORS.accent },

  emptyState: { padding: 40, alignItems: 'center' },
  emptyIcon: { fontSize: 32, marginBottom: 8, color: COLORS.textMuted },
  emptyText: { fontSize: 16, fontWeight: '600', color: COLORS.textSecondary },
  emptySubtext: { fontSize: 13, color: COLORS.textMuted, marginTop: 4 },

  recordRow: {
    flexDirection: 'row', alignItems: 'center', padding: SPACING.md,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  recordRowLast: { borderBottomWidth: 0 },

  avatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,200,255,0.15)',
    borderWidth: 1, borderColor: 'rgba(0,200,255,0.3)',
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: { fontSize: 12, fontWeight: '700', color: COLORS.primary },

  recordInfo: { flex: 1 },
  recordName: { fontSize: 14, fontWeight: '600', color: COLORS.textPrimary },
  recordTime: { fontSize: 11, color: COLORS.textMuted, marginTop: 2, fontFamily: FONTS.mono },

  recordRight: { alignItems: 'flex-end', gap: 4 },
  recordSim: { fontSize: 13, fontWeight: '700', fontFamily: FONTS.heading },
  syncPill: {
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: RADIUS.full, borderWidth: 1,
  },
  syncPillText: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },

  securityNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border,
  },
  securityIcon: { fontSize: 16 },
  securityText: { flex: 1, fontSize: 12, color: COLORS.textSecondary, lineHeight: 18 },
});
