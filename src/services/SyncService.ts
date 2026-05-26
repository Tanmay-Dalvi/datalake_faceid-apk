/**
 * SyncService
 * -----------
 * Manages offline-to-cloud sync with reliability guarantees.
 *
 * Backend: Supabase (Free tier — PostgreSQL + REST API)
 *
 * Strategy:
 *   1. NetInfo listener detects connectivity restore
 *   2. Queue all unsynced records (max 50 per batch)
 *   3. Upload with idempotent upload_token (prevents duplicates on retry)
 *   4. Exponential backoff on failure: 1s → 2s → 4s → ... → 30s
 *   5. After server upsert: mark synced locally
 *   6. Purge records older than 24h that are synced
 */

import NetInfo from '@react-native-community/netinfo';
import { DatabaseService, AttendanceRecord } from './DatabaseService';
import { getSupabase, IS_SUPABASE_CONFIGURED } from './SupabaseClient';

const MAX_RETRIES = 10;
const MAX_BATCH_SIZE = 50;

type SyncStatus = 'idle' | 'syncing' | 'error' | 'success';

class SyncServiceClass {
  private isOnline = false;
  private isSyncing = false;
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private statusListeners: Array<(status: SyncStatus, count: number) => void> = [];

  startNetworkListener(): void {
    NetInfo.addEventListener(state => {
      const wasOffline = !this.isOnline;
      this.isOnline = !!(state.isConnected && state.isInternetReachable);

      if (wasOffline && this.isOnline) {
        console.log('[Sync] Network restored — starting sync');
        this.triggerSync();
      }
    });
  }

  onStatusChange(cb: (status: SyncStatus, pendingCount: number) => void): () => void {
    this.statusListeners.push(cb);
    return () => {
      this.statusListeners = this.statusListeners.filter(l => l !== cb);
    };
  }

  async triggerSync(): Promise<void> {
    if (this.isSyncing || !this.isOnline) return;

    // Skip cloud upload when Supabase is not configured
    if (!IS_SUPABASE_CONFIGURED) {
      await DatabaseService.purgeSyncedRecords();
      this.notifyListeners('success', 0);
      console.log('[Sync] Complete — 0 records synced (Supabase not configured)');
      return;
    }

    this.isSyncing = true;
    this.notifyListeners('syncing', 0);

    try {
      let totalSynced = 0;
      let hasMore = true;

      while (hasMore && this.isOnline) {
        const records = await DatabaseService.getUnsyncedRecords();
        if (records.length === 0) { hasMore = false; break; }

        const batch = records.slice(0, MAX_BATCH_SIZE);
        const syncedIds = await this.uploadBatch(batch);

        for (const id of syncedIds) {
          await DatabaseService.markRecordSynced(id);
          totalSynced++;
        }

        if (syncedIds.length < batch.length) {
          hasMore = false;
        }

        hasMore = records.length >= MAX_BATCH_SIZE;
      }

      await DatabaseService.purgeSyncedRecords();

      this.retryCount = 0;
      this.notifyListeners('success', 0);
      console.log(`[Sync] Complete — ${totalSynced} records synced to Supabase`);

    } catch (err) {
      console.log('[Sync] Deferred — server unreachable:', err instanceof Error ? err.message : err);
      this.scheduleRetry();
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Upload a batch of records to Supabase.
   * Uses upsert with upload_token as conflict key to guarantee idempotency.
   */
  private async uploadBatch(records: AttendanceRecord[]): Promise<string[]> {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase not configured');

    const rows = records.map(r => ({
      upload_token: r.uploadToken,
      local_id: r.id,
      person_id: r.personId,
      person_name: r.personName,
      timestamp: new Date(r.timestamp).toISOString(),
      formatted_time: new Date(r.timestamp).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }),
      similarity: r.similarity,
      device_id: r.deviceId,
      embedding_hash: r.embeddingHash,
      synced_at: new Date().toISOString(),
    }));

    const { data, error } = await supabase
      .from('attendance_records')
      .upsert(rows, { onConflict: 'upload_token' })
      .select('local_id');

    if (error) {
      throw new Error(`Supabase upsert failed: ${error.message}`);
    }

    // Return local IDs that were successfully synced
    return (data ?? []).map((row: any) => row.local_id);
  }

  private scheduleRetry(): void {
    if (this.retryCount >= MAX_RETRIES) {
      console.log('[Sync] Max retries reached — will retry on next network change');
      this.retryCount = 0;
      this.notifyListeners('error', 0);
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.retryCount), 30000);
    this.retryCount++;

    console.log(`[Sync] Retry ${this.retryCount}/${MAX_RETRIES} in ${delay}ms`);

    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.isSyncing = false;
      this.triggerSync();
    }, delay);
  }

  private async notifyListeners(status: SyncStatus, count: number): Promise<void> {
    const { pending } = await DatabaseService.getRecordCount();
    for (const cb of this.statusListeners) cb(status, pending);
  }

  getOnlineStatus(): boolean { return this.isOnline; }
  isSyncInProgress(): boolean { return this.isSyncing; }
  isCloudConfigured(): boolean { return IS_SUPABASE_CONFIGURED; }
}

export const SyncService = new SyncServiceClass();
