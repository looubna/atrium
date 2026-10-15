import { Capacitor, registerPlugin } from '@capacitor/core'

/**
 * Store purchases through RevenueCat. On Android (Samsung Galaxy Store) this is our own native plugin
 * (`android/.../GalaxyPurchasesPlugin.kt`), because RevenueCat's Capacitor plugin has no Galaxy Store
 * support yet; it wraps RevenueCat's Android SDK configured for Galaxy billing. On the web there is
 * nothing to buy: plans are sold in the app.
 */
export interface StorePackage {
  /** RevenueCat package id, passed back to `purchase`. */
  id: string
  productId: string
  /** The store's localized price, e.g. "$14.99". */
  price: string
}

interface GalaxyPurchases {
  configure(options: { apiKey: string; appUserId: string; testMode: boolean }): Promise<void>
  getPackages(): Promise<{ packages: StorePackage[] }>
  purchase(options: { packageId: string }): Promise<void>
  restore(): Promise<void>
  deviceId(): Promise<{ id: string | null }>
}

const Galaxy = registerPlugin<GalaxyPurchases>('GalaxyPurchases')

const isAndroid = (): boolean => Capacitor.getPlatform() === 'android'

/** Off (`VITE_STORE_PURCHASES=false`) for a free release, until the store's paid items are live. */
const storeOn = import.meta.env.VITE_STORE_PURCHASES !== 'false'

/** True where plans can be bought: the Android app, once store purchases are switched on. */
export const canPurchase = (): boolean => isAndroid() && storeOn

/** The Android app before plans are on sale: the paywall says they are coming instead of offering them. */
export const plansComingSoon = (): boolean => isAndroid() && !storeOn

let configuredFor: string | null = null

/** Log RevenueCat in as this Firebase user, so the purchase (and the webhook) is theirs. */
export async function configureStore(uid: string): Promise<void> {
  if (!canPurchase() || configuredFor === uid) return
  await Galaxy.configure({
    // "galx_…" for the Galaxy Store, or a RevenueCat Test Store key ("test_…") until the store is ready.
    apiKey: import.meta.env.VITE_REVENUECAT_KEY ?? '',
    appUserId: uid,
    testMode: import.meta.env.VITE_REVENUECAT_TEST_MODE === 'true',
  })
  configuredFor = uid
}

export async function storePackages(): Promise<StorePackage[]> {
  if (!canPurchase()) return []
  return (await Galaxy.getPackages()).packages
}

/** Android's per-app device id, for one free trial per phone; "" on the web or if unavailable. */
export async function deviceId(): Promise<string> {
  if (!isAndroid()) return ''
  try {
    return ((await Galaxy.deviceId()).id ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128)
  } catch {
    return ''
  }
}

export const purchasePackage = (packageId: string) => Galaxy.purchase({ packageId })
export const restorePurchases = () => Galaxy.restore()
