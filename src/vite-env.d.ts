/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  /** ID de medición de Google Analytics 4, ej: "G-XXXXXXXXXX". */
  readonly VITE_GA_MEASUREMENT_ID?: string;
  /**
   * Pixel de Meta de la marca. Las sedes con cuenta publicitaria propia
   * definen el suyo en el backoffice (llega por /api/public/sedes).
   */
  readonly VITE_META_PIXEL_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
