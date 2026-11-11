/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Optional default backend URL baked in at build time. */
  readonly VITE_DEFAULT_SERVER_URL?: string;
}
