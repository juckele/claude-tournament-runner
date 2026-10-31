// Android (Capacitor) integration. Everything here is a no-op in a normal browser.
//  - App Links: sign-up QR codes, sign-in links and report links open inside the app.
//  - Back button: goes back through the app's history, then exits.
//  - Push: registers the phone with the API after sign-in (only in builds made with Firebase,
//    VITE_PUSH=1, since registering without it crashes the app).
//  - QR scanner for sign-up codes.
import { Capacitor } from "@capacitor/core";
import { api, getToken } from "./api";

export const isNative = Capacitor.isNativePlatform();
const pushBuilt = import.meta.env.VITE_PUSH === "1";
let pushToken: string | null = null;

export async function initNative(navigate: (path: string) => void) {
  if (!isNative) return;
  const { App } = await import("@capacitor/app");
  App.addListener("appUrlOpen", ({ url }) => {
    const u = new URL(url);
    navigate(u.pathname + u.search);
  });
  App.addListener("backButton", ({ canGoBack }) => (canGoBack ? history.back() : App.exitApp()));
  if (!pushBuilt) return;
  const { PushNotifications } = await import("@capacitor/push-notifications");
  await PushNotifications.createChannel({ id: "tournament", name: "Pairings and results", importance: 4 }).catch(() => {});
  PushNotifications.addListener("registration", (t) => {
    pushToken = t.value;
    registerDevice();
  });
  PushNotifications.addListener("registrationError", (e) => console.error("push registration failed", e));
  PushNotifications.addListener("pushNotificationActionPerformed", (a) => {
    const path = a.notification.data?.path;
    if (typeof path === "string" && path.startsWith("/")) navigate(path);
  });
}

/** Ask for notification permission (Android 13+) and register. Call once signed in. */
export async function enablePush() {
  if (!isNative || !pushBuilt) return;
  const { PushNotifications } = await import("@capacitor/push-notifications");
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") perm = await PushNotifications.requestPermissions();
  if (perm.receive === "granted") await PushNotifications.register();
}

async function registerDevice() {
  if (pushToken && getToken()) await api("POST", "/me/devices", { token: pushToken, platform: "android" }).catch(() => {});
}

/** On sign-out: stop notifications to this phone. */
export async function unregisterDevice() {
  if (pushToken && getToken()) await api("DELETE", "/me/devices", { token: pushToken }).catch(() => {});
}

/** Scan a QR code with the camera; returns its text, or null if cancelled. */
export async function scanQr(): Promise<string | null> {
  const { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } = await import("@capacitor/barcode-scanner");
  const r = await CapacitorBarcodeScanner.scanBarcode({ hint: CapacitorBarcodeScannerTypeHint.QR_CODE, scanInstructions: "Point at the tournament's sign-up code" });
  return r?.ScanResult || null;
}

/** A scanned sign-up code → the in-app path, if it's one of ours. */
export function pathFromScan(text: string, origin: string): string | null {
  try {
    const u = new URL(text);
    if (u.origin !== new URL(origin).origin || !u.pathname.startsWith("/t/")) return null;
    return u.pathname + u.search;
  } catch {
    return null;
  }
}
