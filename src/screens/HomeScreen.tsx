// ============================================
// HOME SCREEN
// ============================================
// The main screen showing all current LEGO deals.
// Features:
// - Pull to refresh
// - Filter button
// - Sort options
// - Deal cards list

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  SlidersHorizontal,
  RefreshCw,
  TrendingDown,
  AlertCircle,
} from 'lucide-react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';

import { COLORS } from '../constants/colors';
import { SPACING, SHADOWS } from '../constants/theme';
import { Deal, RootStackParamList } from '../types';
import { useDealsStore } from '../store/useDealsStore';
import { useFiltersStore, useFilterState, useActiveFilterCount } from '../store/useFiltersStore';
import { filterDeals } from '../utils/priceCalculations';
import { formatRelativeTime, getTimeBasedGreeting } from '../utils/formatters';

import { DealCard } from '../components/DealCard';
import { DealListSkeleton } from '../components/LoadingSkeleton';
import { FilterModal } from '../components/FilterModal';
import { fetchCurrentSets } from '../services/rebrickableApi';
import { getDeals as getFirebaseDeals, initializeFirebase } from '../services/firebaseService';
import { RETAILERS, ALL_RETAILER_IDS } from '../constants/retailers';
import { RetailerId } from '../types';

// Rebrickable API key from environment
const REBRICKABLE_API_KEY = process.env.EXPO_PUBLIC_REBRICKABLE_API_KEY || '';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

/**
 * HomeScreen - Main deals list
 */
export function HomeScreen() {
  const navigation = useNavigation<NavigationProp>();

  // Store state
  const {
    deals,
    dealsLoadingState,
    dealsError,
    lastUpdated,
    setDeals,
    setDealsLoading,
    setDealsError,
  } = useDealsStore();

  // Filter state
  const filters = useFilterState();
  const activeFilterCount = useActiveFilterCount();
  const { isFilterModalOpen, setFilterModalOpen } = useFiltersStore();

  // Local state
  const [refreshing, setRefreshing] = useState(false);

  // Filter deals based on current filters
  const filteredDeals = filterDeals(deals, {
    minDiscount: filters.minDiscount,
    maxDiscount: filters.maxDiscount,
    themes: filters.themes.length > 0 ? filters.themes : undefined,
    retailers: filters.retailers.length > 0 ? filters.retailers : undefined,
    minPrice: filters.minPrice > 0 ? filters.minPrice : undefined,
    maxPrice: filters.maxPrice < 1000 ? filters.maxPrice : undefined,
    inStockOnly: filters.inStockOnly,
  });

  /**
   * Load deals - first try Firebase, fall back to Rebrickable
   */
  const loadDeals = useCallback(async () => {
    setDealsLoading('loading');

    try {
      // Initialize Firebase
      initializeFirebase();

      // Try to get deals from Firebase first
      try {
        const firebaseDeals = await getFirebaseDeals(10, 100);
        if (firebaseDeals.length > 0) {
          console.log(`Loaded ${firebaseDeals.length} deals from Firebase`);
          setDeals(firebaseDeals);
          return;
        }
      } catch (firebaseError) {
        console.log('Firebase not available, falling back to Rebrickable:', firebaseError);
      }

      // Fallback: Fetch real LEGO sets from Rebrickable
      const sets = await fetchCurrentSets(REBRICKABLE_API_KEY, {
        minYear: 2022, // Recent sets
        maxYear: new Date().getFullYear() + 1,
        pageSize: 100,
        maxPages: 2, // Limit to ~200 sets for performance
      });

      // Generate simulated deals from real sets
      const generatedDeals: Deal[] = sets
        .filter(set => set.imageUrl) // Only sets with images
        .slice(0, 50) // Limit to 50 deals for performance
        .map(set => {
          // Estimate MSRP based on piece count (~$0.10-0.15 per piece)
          const estimatedMsrp = set.msrp || Math.round(set.numParts * 0.12);

          // Generate a random discount (10-60%)
          const discountPercent = Math.floor(Math.random() * 51) + 10;
          const currentPrice = Math.round(estimatedMsrp * (1 - discountPercent / 100) * 100) / 100;

          // Pick a random retailer
          const retailer: RetailerId = ALL_RETAILER_IDS[Math.floor(Math.random() * ALL_RETAILER_IDS.length)];

          return {
            set: {
              ...set,
              msrp: estimatedMsrp,
            },
            price: {
              setNumber: set.setNumber,
              retailer: retailer,
              currentPrice: currentPrice,
              originalPrice: estimatedMsrp,
              url: RETAILERS[retailer].baseUrl,
              lastUpdated: new Date(),
              inStock: Math.random() > 0.2, // 80% in stock
            },
            percentOff: discountPercent,
            savings: Math.round((estimatedMsrp - currentPrice) * 100) / 100,
          };
        })
        .sort((a, b) => b.percentOff - a.percentOff); // Sort by discount

      setDeals(generatedDeals);
    } catch (error) {
      console.error('Failed to load deals:', error);
      setDealsError('Failed to load deals. Please check your internet connection.');
    }
  }, [setDeals, setDealsLoading, setDealsError]);

  /**
   * Handle pull-to-refresh
   */
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadDeals();
    setRefreshing(false);
  }, [loadDeals]);

  // Load deals on mount
  useEffect(() => {
    if (deals.length === 0) {
      loadDeals();
    }
  }, [deals.length, loadDeals]);

  /**
   * Navigate to set detail
   */
  const handleDealPress = (deal: Deal) => {
    navigation.navigate('SetDetail', { setNumber: deal.set.setNumber });
  };

  /**
   * Render a deal card
   */
  const renderDealCard = ({ item }: { item: Deal }) => (
    <DealCard deal={item} onPress={() => handleDealPress(item)} />
  );

  /**
   * Render list header
   */
  const renderHeader = () => (
    <View style={styles.header}>
      {/* Greeting and last updated */}
      <View style={styles.headerTop}>
        <View>
          <Text style={styles.greeting}>{getTimeBasedGreeting()}</Text>
          <Text style={styles.subtitle}>Find the best LEGO deals</Text>
        </View>
        {lastUpdated && (
          <Text style={styles.lastUpdated}>
            Updated {formatRelativeTime(lastUpdated)}
          </Text>
        )}
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <TrendingDown size={20} color={COLORS.dealGood} />
          <Text style={styles.statValue}>{deals.length}</Text>
          <Text style={styles.statLabel}>Deals</Text>
        </View>
      </View>

      {/* Filter bar */}
      <View style={styles.filterBar}>
        <Pressable
          style={[
            styles.filterButton,
            activeFilterCount > 0 && styles.filterButtonActive,
          ]}
          onPress={() => setFilterModalOpen(true)}
        >
          <SlidersHorizontal
            size={18}
            color={activeFilterCount > 0 ? '#FFFFFF' : COLORS.textPrimary}
          />
          <Text
            style={[
              styles.filterButtonText,
              activeFilterCount > 0 && styles.filterButtonTextActive,
            ]}
          >
            Filters
            {activeFilterCount > 0 && ` (${activeFilterCount})`}
          </Text>
        </Pressable>

        <Text style={styles.resultsText}>
          {filteredDeals.length} result{filteredDeals.length !== 1 && 's'}
        </Text>
      </View>
    </View>
  );

  /**
   * Render empty state
   */
  const renderEmpty = () => {
    if (dealsLoadingState === 'loading') {
      return <DealListSkeleton count={5} />;
    }

    if (dealsError) {
      return (
        <View style={styles.emptyState}>
          <AlertCircle size={48} color={COLORS.error} />
          <Text style={styles.emptyTitle}>Oops!</Text>
          <Text style={styles.emptyText}>{dealsError}</Text>
          <Pressable style={styles.retryButton} onPress={loadDeals}>
            <RefreshCw size={18} color="#FFFFFF" />
            <Text style={styles.retryButtonText}>Try Again</Text>
          </Pressable>
        </View>
      );
    }

    if (filteredDeals.length === 0 && deals.length > 0) {
      return (
        <View style={styles.emptyState}>
          <SlidersHorizontal size={48} color={COLORS.textTertiary} />
          <Text style={styles.emptyTitle}>No matches</Text>
          <Text style={styles.emptyText}>
            Try adjusting your filters to see more deals.
          </Text>
          <Pressable
            style={styles.retryButton}
            onPress={() => setFilterModalOpen(true)}
          >
            <Text style={styles.retryButtonText}>Adjust Filters</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View style={styles.emptyState}>
        <TrendingDown size={48} color={COLORS.textTertiary} />
        <Text style={styles.emptyTitle}>No deals yet</Text>
        <Text style={styles.emptyText}>
          Pull down to refresh and check for new deals.
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* App header/logo area */}
      <View style={styles.logoHeader}>
        <Text style={styles.logoText}>Brick Deal Hunter</Text>
      </View>

      <FlatList
        data={filteredDeals}
        renderItem={renderDealCard}
        keyExtractor={(item) => `${item.set.setNumber}-${item.price.retailer}`}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={COLORS.legoRed}
            colors={[COLORS.legoRed]}
          />
        }
        showsVerticalScrollIndicator={false}
      />

      {/* Filter Modal */}
      <FilterModal
        visible={isFilterModalOpen}
        onClose={() => setFilterModalOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  logoHeader: {
    backgroundColor: COLORS.legoRed,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  logoText: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  header: {
    padding: SPACING.lg,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACING.lg,
  },
  greeting: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  lastUpdated: {
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  statsRow: {
    flexDirection: 'row',
    marginBottom: SPACING.lg,
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.cardBackground,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 20,
    gap: 6,
    ...SHADOWS.sm,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  statLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  filterBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.cardBackground,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 20,
    gap: 6,
    ...SHADOWS.sm,
  },
  filterButtonActive: {
    backgroundColor: COLORS.legoRed,
  },
  filterButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textPrimary,
  },
  filterButtonTextActive: {
    color: '#FFFFFF',
  },
  resultsText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  listContent: {
    paddingBottom: SPACING.xxxl,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xxxl,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginTop: SPACING.lg,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.legoRed,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: 20,
    gap: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default HomeScreen;
