# Wiki-Spy API Documentation

Base URL: `https://wiki-spy-uaew8.ondigitalocean.app`

A dataset of ~43,815 Wikipedia/Commons image cutouts (background-removed via BiRefNet) with article metadata, licensing info, and low-res binary silhouette masks.

---

## Shared Types

```typescript
/** Low-res binary silhouette mask of the cutout (downscaled to ~40px max dimension) */
interface Mask {
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
interface WikiObject {
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
  mask: Mask; // silhouette mask (see above)
  /**
   * Stable pseudo-random value in [0, 1). Defines the global "shuffled"
   * ordering of the dataset. Used as the cursor key for /objects pagination.
   */
  shuffle: number;
}
```

---

## `GET /search`

Full-text search over objects (matches title/description/extract — fuzzy, e.g. `buba` matches "Bombus"/bumblebee and "Songkok"). Offset pagination.

```typescript
interface SearchParams {
  q: string; // required — search query
  offset?: number; // optional — items to skip (default: 0)
  limit?: number; // optional — max items returned
}

interface SearchResponse {
  query: string; // echoed query
  offset: number; // echoed offset
  results: WikiObject[]; // relevance-ordered
  // No total count — page until results.length < limit.
}
```

**Sample:** `GET /search?q=buba&offset=2&limit=3`

```json
{
  "query": "buba",
  "offset": 2,
  "results": [
    {
      "url": "https://wiki-spy.neal.fun/optimized/birefnet-general/f839d0...webp",
      "title": "scarlet-tailed bumble bee",
      "imageTitle": "Bombus coccineus cerca de la laguna Rajucolta 02 (cropped)",
      "pageUrl": "https://en.wikipedia.org/wiki/Bombus_coccineus",
      "articleUrl": "https://en.wikipedia.org/wiki/Bombus_coccineus",
      "description": "Species of bumblebee",
      "extract": "Bombus coccineus, also known by its common name...",
      "license": "CC BY-SA 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0",
      "artist": "Carlo Brescia",
      "imageDescUrl": "https://commons.wikimedia.org/wiki/File:Bombus...jpg",
      "width": 452,
      "height": 520,
      "cutoutId": 5754,
      "mask": { "w": 35, "h": 40, "b": "AAAAAAAA...==" },
      "shuffle": 0.796343749302334
    }
  ]
}
```

---

## `GET /objects`

Paginates the entire dataset in a fixed shuffled order, keyed by `shuffle`. Cursor-based (keyset) pagination.

```typescript
interface ObjectsParams {
  /**
   * Fractional cursor in [0, 1). Returns objects with shuffle > cursor,
   * ascending by shuffle. Omit (or use 0) to start from the beginning.
   * A random cursor = random sampling.
   */
  cursor?: number;
  limit?: number; // optional — max items returned
}

interface ObjectsResponse {
  nextCursor: number; // = shuffle of last object; pass back as ?cursor=
  wrap: boolean; // true when pagination wrapped past 1.0 back to 0 (end reached)
  total: number; // total objects in dataset (e.g. 43815)
  objects: WikiObject[]; // ascending by shuffle
}
```

**Sample:** `GET /objects?cursor=0.215&limit=3`

```json
{
  "nextCursor": 0.2150204276552501,
  "wrap": false,
  "total": 43815,
  "objects": [
    {
      "url": "https://wiki-spy.neal.fun/optimized/birefnet-general/bd447b...webp",
      "title": "Toy",
      "imageTitle": "Making toys, Digby, Nova Scotia. 2008",
      "pageUrl": "https://en.wikipedia.org/wiki/Toy",
      "articleUrl": "https://en.wikipedia.org/wiki/Toy",
      "description": "Entertaining object primarily used by children",
      "extract": "A toy or plaything is an object that is used primarily...",
      "license": "CC BY-SA 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0",
      "artist": "John Hill",
      "imageDescUrl": "https://commons.wikimedia.org/wiki/File:Making%20toys...jpg",
      "width": 621,
      "height": 495,
      "cutoutId": 27877,
      "mask": { "w": 40, "h": 32, "b": "DwAAAAAf...==" },
      "shuffle": 0.21500771444801825
    }
  ]
}
```

---

## `GET /similar`

Visual/semantic similarity search: given a `cutoutId`, returns the most similar objects (embedding-based nearest neighbors — e.g. a meteorite seed returns other meteorites). Offset pagination. The seed itself is excluded from results.

```typescript
interface SimilarParams {
  id: number; // required — cutoutId of the seed object
  offset?: number; // optional — items to skip (default: 0)
  limit?: number; // optional — max items returned
}

/** Compact summary of the seed object (not a full WikiObject) */
interface SeedSummary {
  title: string; // seed article/object title
  imageTitle: string; // seed source image title
  pageUrl: string; // seed source page (Wikipedia or Commons)
  url: string; // seed cutout image CDN URL
}

interface SimilarResponse {
  id: number; // echoed seed cutoutId
  offset: number; // echoed offset
  seed: SeedSummary; // the reference object
  results: WikiObject[]; // similarity-ordered (most similar first)
  // No total count — page until results.length < limit.
}
```

**Sample:** `GET /similar?id=15275&offset=0&limit=3`

```json
{
  "id": 15275,
  "offset": 0,
  "seed": {
    "title": "Sericho",
    "imageTitle": "Sericho Meteorite Exterior 2 (51060422547)",
    "pageUrl": "https://commons.wikimedia.org/wiki/File:Sericho%20Meteorite...jpg",
    "url": "https://wiki-spy.neal.fun/optimized/birefnet-general/fbec08...webp"
  },
  "results": [
    {
      "url": "https://wiki-spy.neal.fun/optimized/birefnet-general/f5c298...webp",
      "title": "Blaubeuren Meteorite",
      "imageTitle": "Blaubeuren meteorite 1",
      "pageUrl": "https://commons.wikimedia.org/wiki/File:Blaubeuren%20meteorite%201.jpg",
      "articleUrl": "",
      "description": "meteorite",
      "extract": "",
      "license": "CC BY-SA 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0",
      "artist": "Thilo Parg",
      "imageDescUrl": "https://commons.wikimedia.org/wiki/File:Blaubeuren%20meteorite%201.jpg",
      "width": 847,
      "height": 935,
      "cutoutId": 11333,
      "mask": { "w": 36, "h": 40, "b": "AAPAAAAA...==" },
      "shuffle": 0.9437336936298231
    }
  ]
}
```

---

## Quick Reference

| Endpoint   | Purpose                     | Pagination                   | Key params                                     | End-of-data signal       |
| ---------- | --------------------------- | ---------------------------- | ---------------------------------------------- | ------------------------ |
| `/search`  | Fuzzy text search           | offset/limit                 | `q` (required), `offset`, `limit`              | `results.length < limit` |
| `/objects` | Enumerate all (shuffled)    | cursor (keyset on `shuffle`) | `cursor` ∈ [0,1), `limit`                      | `wrap: true`             |
| `/similar` | Nearest neighbors by cutout | offset/limit                 | `id` (required, `cutoutId`), `offset`, `limit` | `results.length < limit` |

**Notes:**

- `cutoutId` is the primary key linking endpoints: obtain from any `WikiObject`, feed into `/similar?id=`.
- `shuffle` is deterministic per object; results have their own unrelated `shuffle` values (only `/objects` sorts by it).
- Commons-only objects (no Wikipedia article) have `articleUrl: ""` and `extract: ""`; `pageUrl` then points to the Commons file page instead of an article.
- `offset` and `limit` are optional everywhere; `offset` defaults to 0.
- Images hosted on `wiki-spy.neal.fun` CDN (neal.fun's "Wiki Spy" project); all are pre-processed cutouts with transparent backgrounds and carry CC attribution requirements (`license`, `artist`, `imageDescUrl`).
