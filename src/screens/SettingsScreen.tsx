// ============================================
// SETTINGS SCREEN
// ============================================
// App settings and configuration including:
// - Notification preferences
// - Theme/display settings
// - About/help

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
  Linking,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import {
  Bell,
  Palette,
  HelpCircle,
  ChevronRight,
  CheckCircle,
  AlertCircle,
} from 'lucide-react-native';

import { COLORS, ThemeColors } from '../constants/colors';
import { SPACING, BORDER_RADIUS, SHADOWS } from '../constants/theme';
import { useSettingsStore } from '../store/useSettingsStore';
import { useThemeColors } from '../hooks/useTheme';
import { useNotifications, useNotificationStatus } from '../hooks/useNotifications';

/**
 * SettingsScreen - App configuration
 */
export function SettingsScreen() {
  // Theme colors
  const colors = useThemeColors();
  const styles = createStyles(colors);

  // Settings store
  const {
    notifications,
    colorScheme,
    toggleNotifications,
    setNotificationThreshold,
    setColorScheme,
  } = useSettingsStore();

  // Push notification hooks
  const {
    isEnabled: pushEnabled,
    isLoading: pushLoading,
    error: pushError,
    requestPermissions,
  } = useNotifications();
  const { isPhysicalDevice } = useNotificationStatus();

  /**
   * Open external link
   */
  const openLink = (url: string) => {
    Linking.openURL(url);
  };

  /**
   * Handle enabling notifications - request permissions first
   */
  const handleEnableNotifications = async () => {
    if (!pushEnabled) {
      // Need to request permissions first
      const granted = await requestPermissions();
      if (granted) {
        toggleNotifications();
      } else {
        Alert.alert(
          'Notifications Disabled',
          'Please enable notifications in your device settings to receive deal alerts.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]
        );
      }
    } else {
      // Already have permissions, just toggle
      toggleNotifications();
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Notifications Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Bell size={20} color={colors.legoRed} />
            <Text style={styles.sectionTitle}>Notifications</Text>
          </View>

          <View style={styles.card}>
            {/* Push notification status */}
            <View style={styles.statusRow}>
              {pushLoading ? (
                <ActivityIndicator size="small" color={colors.legoRed} />
              ) : pushEnabled ? (
                <>
                  <CheckCircle size={18} color={colors.dealGood} />
                  <Text style={[styles.statusText, { color: colors.dealGood }]}>
                    Push notifications enabled
                  </Text>
                </>
              ) : (
                <>
                  <AlertCircle size={18} color={colors.warning} />
                  <Text style={[styles.statusText, { color: colors.warning }]}>
                    {!isPhysicalDevice
                      ? 'Push notifications require a physical device'
                      : 'Push notifications not enabled'}
                  </Text>
                </>
              )}
            </View>

            {/* Show error if any */}
            {pushError && (
              <Text style={styles.errorText}>{pushError}</Text>
            )}

            <View style={styles.divider} />

            {/* Enable notifications toggle */}
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Deal Alerts</Text>
                <Text style={styles.settingDescription}>
                  Get notified about new deals
                </Text>
              </View>
              {pushLoading ? (
                <ActivityIndicator size="small" color={colors.legoRed} />
              ) : (
                <Switch
                  value={notifications.enabled && pushEnabled}
                  onValueChange={handleEnableNotifications}
                  trackColor={{ false: colors.border, true: colors.legoRed }}
                  thumbColor="#FFFFFF"
                  disabled={!isPhysicalDevice}
                />
              )}
            </View>

            {/* Threshold slider */}
            {notifications.enabled && (
              <View style={styles.thresholdSection}>
                <View style={styles.thresholdHeader}>
                  <Text style={styles.settingLabel}>Minimum Discount</Text>
                  <Text style={styles.thresholdValue}>
                    {notifications.minDiscountThreshold}%
                  </Text>
                </View>
                <Text style={styles.settingDescription}>
                  Only notify for deals {notifications.minDiscountThreshold}% off or more
                </Text>
                <View style={styles.sliderContainer}>
                  <Text style={styles.sliderLabel}>10%</Text>
                  <Slider
                    style={styles.slider}
                    minimumValue={10}
                    maximumValue={80}
                    step={5}
                    value={notifications.minDiscountThreshold}
                    onValueChange={(value) => setNotificationThreshold(value)}
                    minimumTrackTintColor={colors.legoRed}
                    maximumTrackTintColor={colors.border}
                    thumbTintColor={colors.legoRed}
                  />
                  <Text style={styles.sliderLabel}>80%</Text>
                </View>
              </View>
            )}
          </View>
        </View>

        {/* Appearance Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Palette size={20} color={colors.legoRed} />
            <Text style={styles.sectionTitle}>Appearance</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.settingLabel}>Theme</Text>
            <View style={styles.themeButtons}>
              {(['light', 'dark', 'system'] as const).map((theme) => (
                <Pressable
                  key={theme}
                  style={[
                    styles.themeButton,
                    colorScheme === theme && styles.themeButtonActive,
                  ]}
                  onPress={() => setColorScheme(theme)}
                >
                  <Text
                    style={[
                      styles.themeButtonText,
                      colorScheme === theme && styles.themeButtonTextActive,
                    ]}
                  >
                    {theme.charAt(0).toUpperCase() + theme.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>

        {/* Help & About Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <HelpCircle size={20} color={colors.legoRed} />
            <Text style={styles.sectionTitle}>Help & About</Text>
          </View>

          <View style={styles.card}>
            <Pressable
              style={styles.linkRow}
              onPress={() => openLink('https://forms.gle/uBTxWtbtRdncMge46')}
            >
              <Text style={styles.linkRowText}>Send Feedback</Text>
              <ChevronRight size={20} color={colors.textTertiary} />
            </Pressable>

            <View style={styles.divider} />

            <Pressable
              style={styles.linkRow}
              onPress={() => openLink('https://dealhuntermad.github.io/Brick-Deal-Hunter/privacy.html')}
            >
              <Text style={styles.linkRowText}>Privacy Policy</Text>
              <ChevronRight size={20} color={colors.textTertiary} />
            </Pressable>

            <View style={styles.divider} />

            <Pressable
              style={styles.linkRow}
              onPress={() => openLink('https://dealhuntermad.github.io/Brick-Deal-Hunter/terms.html')}
            >
              <Text style={styles.linkRowText}>Terms of Service</Text>
              <ChevronRight size={20} color={colors.textTertiary} />
            </Pressable>

            <View style={styles.divider} />

            <View style={styles.aboutRow}>
              <Text style={styles.aboutLabel}>Version</Text>
              <Text style={styles.aboutValue}>1.0.0</Text>
            </View>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Brick Deal Hunter</Text>
          <Text style={styles.footerSubtext}>
            Made with bricks and code
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    backgroundColor: colors.legoRed,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: SPACING.xxxl,
  },
  section: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xl,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    ...SHADOWS.sm,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '500',
  },
  errorText: {
    fontSize: 12,
    color: '#EF4444',
    marginTop: SPACING.xs,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  settingInfo: {
    flex: 1,
  },
  settingLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  settingDescription: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  thresholdSection: {
    marginTop: SPACING.lg,
    paddingTop: SPACING.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  thresholdHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  thresholdValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.legoRed,
  },
  sliderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SPACING.md,
    gap: SPACING.sm,
  },
  slider: {
    flex: 1,
    height: 40,
  },
  sliderLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
    minWidth: 30,
  },
  themeButtons: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.md,
  },
  themeButton: {
    flex: 1,
    paddingVertical: SPACING.sm,
    backgroundColor: colors.surfaceLight,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
  },
  themeButtonActive: {
    backgroundColor: colors.legoRed,
  },
  themeButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  themeButtonTextActive: {
    color: '#FFFFFF',
  },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
  },
  linkRowText: {
    fontSize: 15,
    color: colors.textPrimary,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: SPACING.sm,
  },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
  },
  aboutLabel: {
    fontSize: 15,
    color: colors.textPrimary,
  },
  aboutValue: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  footer: {
    alignItems: 'center',
    padding: SPACING.xl,
    marginTop: SPACING.lg,
  },
  footerText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  footerSubtext: {
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 4,
  },
});

export default SettingsScreen;
