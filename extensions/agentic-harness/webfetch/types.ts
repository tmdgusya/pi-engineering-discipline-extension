export type ExtractionMethod = "full" | "raw";

export interface CacheEntry {
  content: string;
  bytes: number;
  code: number;
  codeText: string;
  contentType: string;
  extractionMethod: ExtractionMethod;
  url: string;
  cachedAt: number;
}

export interface WebFetchDetails {
  url: string;
  method: ExtractionMethod;
  bytes: number;
  contentType: string;
  cached: boolean;
  duration: number;
}
