/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Absolute API origin for the Android build, e.g. https://tournaments.example.com. Empty on the web. */
  readonly VITE_API_BASE?: string;
  /** "1" in Android builds that include Firebase (google-services.json). */
  readonly VITE_PUSH?: string;
}
