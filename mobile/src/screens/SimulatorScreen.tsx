import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { MobileStorage } from '../services/storage';
import { DeviceFinancialEngine } from '../services/financial-engine';
import { ScenarioParams, ScenarioResult, Transaction } from '../types';

export const SimulatorScreen: React.FC = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [openingCash, setOpeningCash] = useState<number>(100000);
  const [loading, setLoading] = useState<boolean>(true);

  // Scenario parameters
  const [revenueDelta, setRevenueDelta] = useState<number>(0);
  const [expenseDelta, setExpenseDelta] = useState<number>(0);
  const [arDelay, setArDelay] = useState<number>(0);
  const [apDelay, setApDelay] = useState<number>(0);
  const [oneOffCapex, setOneOffCapex] = useState<number>(0);

  // Result
  const [result, setResult] = useState<ScenarioResult | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const txs = await MobileStorage.getTransactions();
      const accounts = await MobileStorage.getAccounts();
      const cash = accounts.reduce((sum, a) => sum + (a.balance || a.current_balance || 0), 0);
      setTransactions(txs);
      setOpeningCash(cash > 0 ? cash : 125000);
      recalculate(txs, cash > 0 ? cash : 125000, 0, 0, 0, 0, 0);
    } catch {
      // fallback
    } finally {
      setLoading(false);
    }
  };

  const recalculate = (
    txs: Transaction[],
    cash: number,
    revD: number,
    expD: number,
    arD: number,
    apD: number,
    capex: number
  ) => {
    const params: ScenarioParams = {
      name: 'Custom Mobile Simulation',
      revenue_growth_pct: revD,
      expense_growth_pct: expD,
      receivables_delay_days: arD,
      payables_delay_days: apD,
      one_off_capex: capex,
      projection_days: 90,
    };
    const res = DeviceFinancialEngine.simulateScenario(txs, params, cash);
    setResult(res);
  };

  const handleUpdate = (
    revD = revenueDelta,
    expD = expenseDelta,
    arD = arDelay,
    apD = apDelay,
    capex = oneOffCapex
  ) => {
    recalculate(transactions, openingCash, revD, expD, arD, apD, capex);
  };

  const presetScenarios = [
    {
      label: 'Baseline (0%)',
      rev: 0,
      exp: 0,
      ar: 0,
      ap: 0,
      capex: 0,
    },
    {
      label: 'Growth Push (+20% Rev, +10% Exp)',
      rev: 20,
      exp: 10,
      ar: 0,
      ap: 0,
      capex: 10000,
    },
    {
      label: 'Recession Stress (-25% Rev, +30d AR delay)',
      rev: -25,
      exp: 0,
      ar: 30,
      ap: 0,
      capex: 0,
    },
    {
      label: 'Cost Cutting (-15% Exp)',
      rev: 0,
      exp: -15,
      ar: 0,
      ap: 15,
      capex: 0,
    },
  ];

  const applyPreset = (preset: typeof presetScenarios[0]) => {
    setRevenueDelta(preset.rev);
    setExpenseDelta(preset.exp);
    setArDelay(preset.ar);
    setApDelay(preset.ap);
    setOneOffCapex(preset.capex);
    handleUpdate(preset.rev, preset.exp, preset.ar, preset.ap, preset.capex);
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(val);
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#059669" />
        <Text style={styles.loadingText}>Initializing On-Device Simulator...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>What-If Scenario Sandbox</Text>
        <Text style={styles.subtitle}>
          100% device-powered deterministic financial simulation. Zero latency, works offline.
        </Text>
      </View>

      {/* Presets */}
      <Text style={styles.sectionHeader}>QUICK PRESETS</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetsRow}>
        {presetScenarios.map((p, idx) => (
          <TouchableOpacity
            key={idx}
            style={styles.presetChip}
            onPress={() => applyPreset(p)}
          >
            <Text style={styles.presetText}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Interactive Controls */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Simulation Parameters</Text>

        <View style={styles.sliderGroup}>
          <View style={styles.sliderLabelRow}>
            <Text style={styles.sliderLabel}>Revenue Delta (%)</Text>
            <Text style={[styles.sliderValue, revenueDelta > 0 ? styles.green : revenueDelta < 0 ? styles.red : null]}>
              {revenueDelta > 0 ? `+${revenueDelta}%` : `${revenueDelta}%`}
            </Text>
          </View>
          <View style={styles.stepperRow}>
            {[-25, -10, -5, 0, 5, 10, 25].map((val) => (
              <TouchableOpacity
                key={val}
                style={[styles.stepBtn, revenueDelta === val && styles.stepBtnActive]}
                onPress={() => {
                  setRevenueDelta(val);
                  handleUpdate(val, expenseDelta, arDelay, apDelay, oneOffCapex);
                }}
              >
                <Text style={[styles.stepBtnText, revenueDelta === val && styles.stepBtnTextActive]}>
                  {val > 0 ? `+${val}%` : `${val}%`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.sliderGroup}>
          <View style={styles.sliderLabelRow}>
            <Text style={styles.sliderLabel}>Expense Delta (%)</Text>
            <Text style={[styles.sliderValue, expenseDelta > 0 ? styles.red : expenseDelta < 0 ? styles.green : null]}>
              {expenseDelta > 0 ? `+${expenseDelta}%` : `${expenseDelta}%`}
            </Text>
          </View>
          <View style={styles.stepperRow}>
            {[-20, -10, 0, 10, 20, 30].map((val) => (
              <TouchableOpacity
                key={val}
                style={[styles.stepBtn, expenseDelta === val && styles.stepBtnActive]}
                onPress={() => {
                  setExpenseDelta(val);
                  handleUpdate(revenueDelta, val, arDelay, apDelay, oneOffCapex);
                }}
              >
                <Text style={[styles.stepBtnText, expenseDelta === val && styles.stepBtnTextActive]}>
                  {val > 0 ? `+${val}%` : `${val}%`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.sliderGroup}>
          <View style={styles.sliderLabelRow}>
            <Text style={styles.sliderLabel}>Customer AR Delay (Days)</Text>
            <Text style={styles.sliderValue}>{arDelay} days</Text>
          </View>
          <View style={styles.stepperRow}>
            {[0, 15, 30, 45, 60].map((val) => (
              <TouchableOpacity
                key={val}
                style={[styles.stepBtn, arDelay === val && styles.stepBtnActive]}
                onPress={() => {
                  setArDelay(val);
                  handleUpdate(revenueDelta, expenseDelta, val, apDelay, oneOffCapex);
                }}
              >
                <Text style={[styles.stepBtnText, arDelay === val && styles.stepBtnTextActive]}>
                  +{val}d
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.sliderLabel}>One-off Capital Expenditure ($)</Text>
          <TextInput
            style={styles.textInput}
            keyboardType="numeric"
            value={oneOffCapex === 0 ? '' : oneOffCapex.toString()}
            placeholder="e.g. 15000"
            placeholderTextColor="#94A3B8"
            onChangeText={(txt) => {
              const num = parseFloat(txt) || 0;
              setOneOffCapex(num);
              handleUpdate(revenueDelta, expenseDelta, arDelay, apDelay, num);
            }}
          />
        </View>
      </View>

      {/* Projection Outcomes */}
      {result && (
        <View style={styles.outcomeCard}>
          <Text style={styles.outcomeTitle}>90-Day Simulation Projection</Text>

          <View style={styles.metricGrid}>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>PROJECTED CASH</Text>
              <Text style={[styles.metricVal, result.projected_ending_cash < 0 ? styles.red : styles.green]}>
                {formatCurrency(result.projected_ending_cash)}
              </Text>
              <Text style={styles.metricSub}>at Day 90</Text>
            </View>

            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>CASH RUNWAY</Text>
              <Text style={[styles.metricVal, result.runway_months < 3 ? styles.red : styles.navy]}>
                {result.runway_months > 99 ? '> 99 mos' : `${result.runway_months.toFixed(1)} mos`}
              </Text>
              <Text style={styles.metricSub}>based on burn rate</Text>
            </View>

            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>PROJECTED BURN</Text>
              <Text style={[styles.metricVal, styles.navy]}>
                {formatCurrency(result.projected_burn_rate)}
              </Text>
              <Text style={styles.metricSub}>per month</Text>
            </View>

            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>RESERVE STATUS</Text>
              <Text style={[styles.metricVal, result.breach_date ? styles.red : styles.green]}>
                {result.breach_date ? 'Breach Risk' : 'Adequate'}
              </Text>
              <Text style={styles.metricSub}>
                {result.breach_date ? result.breach_date : 'Safe > 90d'}
              </Text>
            </View>
          </View>

          {result.breach_date && (
            <View style={styles.alertBanner}>
              <Text style={styles.alertBannerText}>
                Warning: Under this scenario, cash balance is projected to breach safe operating thresholds around {result.breach_date}. Consider extending supplier payment terms or securing bridge financing.
              </Text>
            </View>
          )}

          <View style={styles.comparisonTable}>
            <Text style={styles.comparisonHeader}>Baseline vs. Simulated Comparison</Text>
            <View style={styles.compRow}>
              <Text style={styles.compColLabel}>Opening Cash</Text>
              <Text style={styles.compColVal}>{formatCurrency(openingCash)}</Text>
            </View>
            <View style={styles.compRow}>
              <Text style={styles.compColLabel}>One-off Capex Outflow</Text>
              <Text style={styles.compColVal}>-{formatCurrency(oneOffCapex)}</Text>
            </View>
            <View style={styles.compRow}>
              <Text style={styles.compColLabel}>Net Delta vs Baseline</Text>
              <Text style={[styles.compColVal, result.net_cash_delta >= 0 ? styles.green : styles.red]}>
                {result.net_cash_delta >= 0 ? '+' : ''}{formatCurrency(result.net_cash_delta)}
              </Text>
            </View>
          </View>
        </View>
      )}

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
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#64748B',
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
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  presetsRow: {
    marginBottom: 16,
  },
  presetChip: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
  },
  presetText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 14,
  },
  sliderGroup: {
    marginBottom: 16,
  },
  sliderLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sliderLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#475569',
  },
  sliderValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  stepperRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  stepBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  stepBtnActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  stepBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  stepBtnTextActive: {
    color: '#FFFFFF',
  },
  inputGroup: {
    marginTop: 4,
  },
  textInput: {
    height: 42,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
    marginTop: 6,
  },
  outcomeCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    marginBottom: 20,
  },
  outcomeTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 12,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 14,
  },
  metricItem: {
    width: '47%',
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: 4,
  },
  metricVal: {
    fontSize: 18,
    fontWeight: '700',
  },
  metricSub: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
  green: {
    color: '#059669',
  },
  red: {
    color: '#DC2626',
  },
  navy: {
    color: '#0F172A',
  },
  alertBanner: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 8,
    padding: 12,
    marginBottom: 14,
  },
  alertBannerText: {
    fontSize: 12,
    color: '#991B1B',
    lineHeight: 18,
  },
  comparisonTable: {
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: 12,
  },
  comparisonHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 8,
  },
  compRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  compColLabel: {
    fontSize: 13,
    color: '#64748B',
  },
  compColVal: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F172A',
  },
  bottomSpace: {
    height: 32,
  },
});
