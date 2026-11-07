import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { MobileSyncCoordinator } from '../services/sync';
import { MobileStorage } from '../services/storage';
import { SyncStatus } from '../types';

export const SyncScreen: React.FC = () => {
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [offlineQueue, setOfflineQueue] = useState<any[]>([]);

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      const status = await MobileSyncCoordinator.getStatus();
      setSyncStatus(status);
      const queue = await MobileStorage.getOfflineQueue();
      setOfflineQueue(queue);
    } catch {
      // ignore
    }
  };

  const handleTriggerSync = async () => {
    setSyncing(true);
    try {
      const res = await MobileSyncCoordinator.sync();
      if (res.success) {
        Alert.alert('Sync Complete', `Pushed ${res.pushedCount} local changes, pulled ${res.pulledCount} cloud changes.`);
      } else {
        Alert.alert('Sync Notice', res.error || 'Failed to sync with Render cloud backend.');
      }
      await loadStatus();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleClearQueue = async () => {
    Alert.alert(
      'Confirm Clear',
      'Are you sure you want to discard all pending offline drafts?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear Queue',
          style: 'destructive',
          onPress: async () => {
            await MobileStorage.setOfflineQueue([]);
            await loadStatus();
          },
        },
      ]
    );
  };

  const formatDate = (iso?: string | null) => {
    if (!iso) return 'Never';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Cloud Synchronization</Text>
        <Text style={styles.subtitle}>
          Two-way incremental synchronization with monotonic sequence tokens and conflict safety.
        </Text>
      </View>

      {/* Sync Card */}
      <View style={styles.statusCard}>
        <View style={styles.statusRow}>
          <View>
            <Text style={styles.statusLabel}>SYNC STATE</Text>
            <View style={styles.badgeRow}>
              <View style={[styles.dot, syncStatus?.pendingCount ? styles.amberDot : styles.greenDot]} />
              <Text style={styles.badgeText}>
                {syncStatus?.pendingCount ? `${syncStatus.pendingCount} Pending Local Changes` : 'Synchronized with Cloud'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.infoGrid}>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>LAST SYNC</Text>
            <Text style={styles.infoVal}>{formatDate(syncStatus?.lastSync)}</Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>LAST SEQ TOKEN</Text>
            <Text style={styles.infoVal}>#{syncStatus?.lastSeq || 0}</Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>CLOUD HOST</Text>
            <Text style={styles.infoVal} numberOfLines={1}>render.com (PostgreSQL)</Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>CONFLICT POLICY</Text>
            <Text style={styles.infoVal}>Last-Write-Wins (LWW)</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.syncButton, syncing && styles.syncButtonDisabled]}
          onPress={handleTriggerSync}
          disabled={syncing}
        >
          {syncing ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.syncButtonText}>Trigger Cloud Synchronization</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Pending Offline Queue */}
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>PENDING OFFLINE MUTATIONS ({offlineQueue.length})</Text>
        {offlineQueue.length > 0 && (
          <TouchableOpacity onPress={handleClearQueue}>
            <Text style={styles.clearText}>Clear Drafts</Text>
          </TouchableOpacity>
        )}
      </View>

      {offlineQueue.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Offline Queue Clean</Text>
          <Text style={styles.emptyDesc}>
            All local transactions and modifications have been acknowledged and safely committed to Render PostgreSQL.
          </Text>
        </View>
      ) : (
        offlineQueue.map((item, idx) => (
          <View key={item.client_mutation_id || idx} style={styles.queueItem}>
            <View style={styles.queueHeader}>
              <Text style={styles.queueType}>
                {item.action?.toUpperCase()} {item.entity_type?.toUpperCase()}
              </Text>
              <Text style={styles.queueTime}>
                {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
            <Text style={styles.queueData}>
              {item.data?.description || 'Transaction'} - ${item.data?.amount}
            </Text>
            <Text style={styles.queueId}>ID: {item.client_mutation_id}</Text>
          </View>
        ))
      )}

      {/* Architecture Info */}
      <View style={styles.archCard}>
        <Text style={styles.archTitle}>Production Sync Guarantee</Text>
        <Text style={styles.archBody}>
          1. Monotonic Sequences: Render assigns an immutable, monotonically increasing seq_num to every committed change.{'\n\n'}
          2. Idempotency: Every mutation carries a unique client_mutation_id, guaranteeing duplicate pushes cause zero double-counting.{'\n\n'}
          3. Local Autonomy: You can draft transactions offline anywhere. Changes are queued locally and automatically synced once a network connection is restored.
        </Text>
      </View>

      <View style={styles.bottomSpace} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  content: {
    padding: 16,
  },
  header: {
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0F172A',
  },
  subtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 4,
  },
  statusCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 20,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  greenDot: {
    backgroundColor: '#10B981',
  },
  amberDot: {
    backgroundColor: '#F59E0B',
  },
  badgeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  divider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 14,
  },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  infoItem: {
    width: '47%',
  },
  infoLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94A3B8',
    marginBottom: 2,
  },
  infoVal: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  syncButton: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncButtonDisabled: {
    opacity: 0.7,
  },
  syncButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.8,
  },
  clearText: {
    fontSize: 12,
    color: '#DC2626',
    fontWeight: '600',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  emptyDesc: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 4,
  },
  queueItem: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 8,
  },
  queueHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  queueType: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },
  queueTime: {
    fontSize: 11,
    color: '#94A3B8',
  },
  queueData: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 2,
  },
  queueId: {
    fontSize: 10,
    color: '#94A3B8',
    fontFamily: 'monospace',
  },
  archCard: {
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    marginTop: 8,
  },
  archTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 8,
  },
  archBody: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 18,
  },
  bottomSpace: {
    height: 32,
  },
});
