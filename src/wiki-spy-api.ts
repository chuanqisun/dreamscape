/**
 * Wiki-Spy API Client
 * Documentation based on docs/wiki-spy.md
 */

export const DEFAULT_WIKI_SPY_BASE_URL = "https://wiki-spy-uaew8.ondigitalocean.app";

/** Low-res binary silhouette mask of the cutout (downscaled to ~40px max dimension) */
export interface Mask {
  w: number; // mask width in cells (px)
  h: number; // mask height in cells (px)
  /**
   * Base64-encoded bitmap, 1 bit per cell, row-major order,
   * MSB-first within each byte. Total bits = w * h (padded to byte boundary).
   * 1 = object pixel, 0 = background.
   * Decode: bit(x, y) = (bytes[⌊(y*w+x)/8⌋] >> (7 - (y*w+x) % 8)) & 1
   */
  b: string;
}

/** A single cutout object with its source metadata */
export interface WikiObject {
  url: string; // CDN URL of the cutout image (.webp, transparent background)
  title: string; // article title, or object name for Commons-only images
  imageTitle: string; // caption/title of the source image
  /**
   * Source page URL. Either an en.wikipedia.org article OR a
   * commons.wikimedia.org file page (when no article exists).
   */
  pageUrl: string;
  articleUrl: string; // Wikipedia article URL; "" if Commons-only (no article)
  description: string; // short description (Wikidata-style)
  extract: string; // lead paragraph extract; "" if Commons-only
  license: string; // image license, e.g. "CC BY-SA 4.0"
  licenseUrl: string; // license deed URL
  artist: string; // image author/attribution
  imageDescUrl: string; // Wikimedia Commons file description page
  width: number; // cutout image width (px)
  height: number; // cutout image height (px)
  cutoutId: number; // unique numeric ID (use with /similar?id=)
  mask: Mask; // silhouette mask
  /**
   * Stable pseudo-random value in [0, 1). Defines the global "shuffled"
   * ordering of the dataset. Used as the cursor key for /objects pagination.
   */
  shuffle: number;
}

export interface SearchParams {
  q: string; // required — search query
  offset?: number; // optional — items to skip (default: 0)
  limit?: number; // optional — max items returned
}

export interface SearchResponse {
  query: string; // echoed query
  offset: number; // echoed offset
  results: WikiObject[]; // relevance-ordered
}

export interface ObjectsParams {
  /**
   * Fractional cursor in [0, 1). Returns objects with shuffle > cursor,
   * ascending by shuffle. Omit (or use 0) to start from the beginning.
   * A random cursor = random sampling.
   */
  cursor?: number;
  limit?: number; // optional — max items returned
}

export interface ObjectsResponse {
  nextCursor: number; // = shuffle of last object; pass back as ?cursor=
  wrap: boolean; // true when pagination wrapped past 1.0 back to 0 (end reached)
  total: number; // total objects in dataset (e.g. 43815)
  objects: WikiObject[]; // ascending by shuffle
}

export interface SimilarParams {
  id: number; // required — cutoutId of the seed object
  offset?: number; // optional — items to skip (default: 0)
  limit?: number; // optional — max items returned
}

/** Compact summary of the seed object (not a full WikiObject) */
export interface SeedSummary {
  title: string; // seed article/object title
  imageTitle: string; // seed source image title
  pageUrl: string; // seed source page (Wikipedia or Commons)
  url: string; // seed cutout image CDN URL
}

export interface SimilarResponse {
  id: number; // echoed seed cutoutId
  offset: number; // echoed offset
  seed: SeedSummary; // the reference object
  results: WikiObject[]; // similarity-ordered (most similar first)
}

export class WikiSpyApi {
  private baseUrl: string;

  constructor(baseUrl: string = DEFAULT_WIKI_SPY_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private buildUrl(path: string, params: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.append(key, String(value));
      }
    });
    return url.toString();
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Wiki-Spy API error: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  /**
   * GET /search
   * Full-text search over objects (matches title/description/extract — fuzzy).
   */
  async search(params: SearchParams | string, options?: { offset?: number; limit?: number }): Promise<SearchResponse> {
    const searchParams: SearchParams = typeof params === "string" ? { q: params, ...options } : params;
    const url = this.buildUrl("/search", {
      q: searchParams.q,
      offset: searchParams.offset,
      limit: searchParams.limit,
    });
    return this.fetchJson<SearchResponse>(url);
  }

  /**
   * GET /objects
   * Paginates the entire dataset in a fixed shuffled order, keyed by `shuffle`.
   */
  async listObjects(params: ObjectsParams = {}): Promise<ObjectsResponse> {
    const url = this.buildUrl("/objects", {
      cursor: params.cursor,
      limit: params.limit,
    });
    return this.fetchJson<ObjectsResponse>(url);
  }

  /**
   * GET /similar
   * Visual/semantic similarity search given a cutoutId.
   */
  async getSimilar(params: SimilarParams | number, options?: { offset?: number; limit?: number }): Promise<SimilarResponse> {
    const similarParams: SimilarParams = typeof params === "number" ? { id: params, ...options } : params;
    const url = this.buildUrl("/similar", {
      id: similarParams.id,
      offset: similarParams.offset,
      limit: similarParams.limit,
    });
    return this.fetchJson<SimilarResponse>(url);
  }
}

export default WikiSpyApi;
