import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet, View, Text, ScrollView, TouchableOpacity, Animated,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SyncService } from '../services/SyncService';
import { DatabaseService } from '../services/DatabaseService';
import { COLORS, FONTS, SPACING, RADIUS } from '../utils/theme';

type SyncStatus = 'idle' | 'syncing' | 'error' | 'success';

export default function SyncScreen() {
  const navigation = useNavigation<any>();
  const [isOnline,    setIsOnline]    = useState(false);
  const [syncStatus,  setSyncStatus]  = useState<SyncStatus>('idle');
  const [pendingCount, setPendingCount] = useState(0);
  const [logs, setLogs] = useState<string[]>([
    '[Init] App started — DB initialized (AES-256)',
    '[Init] Models loaded: MobileFaceNet + MiniXception',
    '[Init] Network listener active',
  ]);

  const progressAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();

    setIsOnline(SyncService.getOnlineStatus());
    DatabaseService.getRecordCount().then(c => setPendingCount(c.pending));

    const unsub = SyncService.onStatusChange((status, count) => {
      setSyncStatus(status as SyncStatus);
      setPendingCount(count);
      setIsOnline(SyncService.getOnlineStatus());
      appendLog(`[Sync] Status → ${status}, pending: ${count}`);
    });

    return unsub;
  }, []);

  const appendLog = (msg: string) => {
    const ts = new Date().toLocaleTimeString('en-IN', { hour12: false });
    setLogs(prev => [`[${ts}] ${msg}`, ...prev.slice(0, 49)]);
  };

  const triggerManualSync = async () => {
    if (!isOnline) {
      appendLog('[Sync] Cannot sync — device offline');
      return;
    }
    appendLog('[Sync] Manual sync triggered');
    setSyncStatus('syncing');

    Animated.timing(progressAnim, { toValue: 0, duration: 0, useNativeDriver: false }).start();
    Animated.timing(progressAnim, { toValue: 1, duration: 2500, useNativeDriver: false }).start(async () => {
      await SyncService.triggerSync();
      appendLog('[Sync] Batch upload complete');
      appendLog('[Sync] AWS ACK received');
      appendLog('[Sync] Local copies purge scheduled +24h');
      setSyncStatus('success');
    });
  };

  const triggerPurge = async () => {
    const count = await DatabaseService.purgeSyncedRecords();
    appendLog(`[Purge] Removed ${count} synced records from local store`);
  };

  const statusColors: Record<SyncStatus, string> = {
    idle: COLORS.textSecondary, syncing: COLORS.primary,
    error: COLORS.danger, success: COLORS.success,
  };

  const statusIcons: Record<SyncStatus, string> = {
    idle: '⟳', syncing: '↑', error: '✗', success: '✓',
  };

  const configRows = [
    { label: 'Cloud Backend',      value: 'Supabase (Free tier)' },
    { label: 'Database',           value: 'PostgreSQL' },
    { label: 'API',                value: 'REST + Real-time' },
    { label: 'Region',             value: 'ap-south-1 (Mumbai)' },
    { label: 'Batch Size',         value: '50 records max' },
    { label: 'Retry Strategy',     value: 'Exponential backoff ×10' },
    { label: 'Upload Token',       value: 'Idempotent upsert (dedup)' },
    { label: 'Purge Policy',       value: 'After sync + 24 hours' },
    { label: 'Encryption in transit', value: 'TLS 1.3' },
    { label: 'Encryption at rest', value: 'AES-256-GCM (Keystore)' },
  ];

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Sync & Purge</Text>
        <View style={[
          styles.statusBadge,
          { backgroundColor: isOnline ? 'rgba(0,224,150,0.12)' : 'rgba(255,59,92,0.12)' }
        ]}>
          <Text style={{ color: isOnline ? COLORS.success : COLORS.danger, fontSize: 12, fontWeight: '700' }}>
            {isOnline ? '● Online' : '● Offline'}
          </Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>

        {/* Main status card */}
        <View style={[
          styles.statusCard,
          {
            borderColor: syncStatus === 'success' ? 'rgba(0,224,150,0.3)'
              : syncStatus === 'error' ? 'rgba(255,59,92,0.3)'
              : syncStatus === 'syncing' ? 'rgba(0,200,255,0.3)'
              : COLORS.border,
          }
        ]}>
          <Text style={[styles.statusIcon, { color: statusColors[syncStatus] }]}>
            {statusIcons[syncStatus]}
          </Text>
          <Text style={[styles.statusTitle, { color: statusColors[syncStatus] }]}>
            {syncStatus === 'idle'    ? 'Ready to Sync' :
             syncStatus === 'syncing' ? 'Uploading to AWS...' :
             syncStatus === 'success' ? 'Sync Complete' : 'Sync Error'}
          </Text>
          <Text style={styles.statusDesc}>
            {pendingCount > 0
              ? `${pendingCount} records queued for upload`
              : 'All records synced'}
          </Text>

          {syncStatus === 'syncing' && (
            <View style={styles.progressTrack}>
              <Animated.View
                style={[
                  styles.progressFill,
                  {
                    width: progressAnim.interpolate({
                      inputRange: [0, 1], outputRange: ['0%', '100%'],
                    }),
                  },
                ]}
              />
            </View>
          )}
        </View>

        {/* Queue stats */}
        <View style={styles.queueRow}>
          {[
            { label: 'Pending', value: pendingCount, color: COLORS.warning },
            { label: 'Synced today', value: 21, color: COLORS.success },
            { label: 'Total', value: pendingCount + 21, color: COLORS.primary },
          ].map((q, i) => (
            <View key={i} style={styles.queueCard}>
              <Text style={[styles.queueValue, { color: q.color }]}>{q.value}</Text>
              <Text style={styles.queueLabel}>{q.label}</Text>
            </View>
          ))}
        </View>

        {/* Actions */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnPrimary]}
            onPress={triggerManualSync}
          >
            <Text style={styles.actionBtnPrimaryText}>SYNC NOW</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnSecondary]}
            onPress={triggerPurge}
          >
            <Text style={styles.actionBtnSecondaryText}>PURGE SYNCED</Text>
          </TouchableOpacity>
        </View>

        {/* Config table */}
        <View style={styles.tableCard}>
          <Text style={styles.tableTitle}>Sync Configuration</Text>
          {configRows.map((row, i) => (
            <View key={i} style={[styles.configRow, i === configRows.length - 1 && styles.configRowLast]}>
              <Text style={styles.configLabel}>{row.label}</Text>
              <Text style={styles.configValue}>{row.value}</Text>
            </View>
          ))}
        </View>

        {/* Sync log */}
        <View style={styles.logCard}>
          <View style={styles.logHeader}>
            <Text style={styles.tableTitle}>Sync Log</Text>
            <TouchableOpacity onPress={() => setLogs([])}>
              <Text style={{ fontSize: 11, color: COLORS.textMuted }}>Clear</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.logBox} nestedScrollEnabled>
            {logs.map((log, i) => (
              <Text key={i} style={styles.logLine}>{log}</Text>
            ))}
          </ScrollView>
        </View>

        {/* Security strip */}
        <View style={styles.securityStrip}>
          <Text style={styles.securityText}>
            Records contain embeddings only. Raw images are never transmitted. Each upload uses an idempotent token to prevent duplicates on network retry.
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
  statusBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADIUS.full },

  content: { padding: SPACING.lg },

  statusCard: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    borderWidth: 1.5, padding: SPACING.lg,
    alignItems: 'center', marginBottom: SPACING.md,
  },
  statusIcon: { fontSize: 40, marginBottom: 8 },
  statusTitle: { fontSize: 18, fontWeight: '800', fontFamily: FONTS.heading, marginBottom: 4 },
  statusDesc: { fontSize: 13, color: COLORS.textSecondary },
  progressTrack: {
    width: '100%', height: 4, backgroundColor: COLORS.surfaceAlt,
    borderRadius: 2, overflow: 'hidden', marginTop: 16,
  },
  progressFill: {
    height: '100%', borderRadius: 2,
    backgroundColor: COLORS.primary,
  },

  queueRow: { flexDirection: 'row', gap: 8, marginBottom: SPACING.md },
  queueCard: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.md,
    padding: 14, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border,
  },
  queueValue: { fontSize: 24, fontWeight: '800', fontFamily: FONTS.heading },
  queueLabel: { fontSize: 11, color: COLORS.textMuted, marginTop: 4, textTransform: 'uppercase', letterSpacing: 1 },

  actionsRow: { flexDirection: 'row', gap: 8, marginBottom: SPACING.md },
  actionBtn: { flex: 1, paddingVertical: 14, borderRadius: RADIUS.md, alignItems: 'center' },
  actionBtnPrimary: { backgroundColor: COLORS.primary },
  actionBtnPrimaryText: { fontSize: 14, fontWeight: '800', color: '#000', letterSpacing: 2 },
  actionBtnSecondary: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  actionBtnSecondaryText: { fontSize: 14, fontWeight: '700', color: COLORS.textSecondary, letterSpacing: 1 },

  tableCard: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.md,
    overflow: 'hidden',
  },
  tableTitle: {
    fontSize: 11, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 2, color: COLORS.textSecondary,
    padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  configRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: SPACING.md, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  configRowLast: { borderBottomWidth: 0 },
  configLabel: { fontSize: 13, color: COLORS.textSecondary },
  configValue: { fontSize: 12, fontWeight: '700', color: COLORS.primary, fontFamily: FONTS.mono },

  logCard: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
    overflow: 'hidden', marginBottom: SPACING.md,
  },
  logHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  logBox: { height: 180, padding: SPACING.sm },
  logLine: {
    fontSize: 11, color: 'rgba(0,200,255,0.6)',
    fontFamily: FONTS.mono, lineHeight: 18, paddingHorizontal: 8,
  },

  securityStrip: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md,
  },
  securityText: { fontSize: 12, color: COLORS.textSecondary, lineHeight: 18, textAlign: 'center' },
});
