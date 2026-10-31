import type { CapacitorConfig } from "@capacitor/cli";

// The app bundles the built web app (../web/dist, built with VITE_API_BASE set to the API's
// public URL) and serves it from https://localhost inside the WebView.
const config: CapacitorConfig = {
  appId: process.env.ANDROID_APP_ID ?? "app.pairingdesk.android",
  appName: "Pairing Desk",
  webDir: "../web/dist",
  android: { allowMixedContent: false },
  server: { androidScheme: "https" },
  plugins: {
    PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
  },
};

export default config;
