import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The iOS app is the existing web app in a native shell. Native plugins provide
 * what a WebView can't: Sign in with Apple / Google, App Attest for App Check,
 * keeping the screen awake during interviews, and saving downloads.
 *
 * `appId` must match the bundle ID registered in Firebase (Terraform
 * `ios_bundle_id`) and in the Apple Developer account.
 */
const config: CapacitorConfig = {
  appId: 'com.atriumcoach.app',
  appName: 'Atrium',
  webDir: 'dist',
  ios: {
    contentInset: 'never',
    backgroundColor: '#07090c',
  },
  plugins: {
    // Android lays the screen out itself (MainActivity): below the status bar in portrait, full screen in
    // landscape. Capacitor's own handling padded the notch side, leaving a grey strip in landscape rooms.
    SystemBars: {
      insetsHandling: 'disable',
    },
    FirebaseAuthentication: {
      // Sign in natively, then hand the credential to the Firebase JS SDK the app already uses.
      skipNativeAuth: true,
      providers: ['apple.com', 'google.com'],
    },
  },
}

export default config
