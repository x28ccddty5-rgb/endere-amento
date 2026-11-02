interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly PROD: boolean;
  readonly DEV: boolean;
  readonly VITE_PERMISSION_ADMIN_MODE?: "off" | "preview" | "live";
  readonly VITE_PERMISSION_ENFORCEMENT_MODE?: "off" | "live";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
