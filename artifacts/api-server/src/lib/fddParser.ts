export type FranchisorCandidate = {
  documentId: string;
  franchiseName: string;
  franchisor: string;
  status: "Current" | "Former" | "Planning";
  franchiseeEntity: string | null;
  address: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string | null;
  email: string | null;
  sourcePage: number;
  rawSourceText: string;
  confidence: number;
  reviewStatus: string;
  reviewReason: string;
  /** FDD-native citations, when the caller has source-discovery information. */
  sourceExhibit?: string | null;
  sourceSection?: string | null;
  sourcePrintedPage?: number | null;
};

export type FranchiseeListKind = "current" | "former" | "signed-but-not-open";

export type FddTocEntry = {
  title: string;
  itemNumber: number | null;
  exhibit: string | null;
  printedPageStart: number | null;
  printedPageEnd: number | null;
  hasExplicitPrintedPageRange: boolean;
  listKind: FranchiseeListKind | null;
};

export type PdfTextPage = {
  pdfPage: number;
  text: string;
  ocr?: boolean;
  ocrConfidence?: number | null;
};

export type FranchiseeSection = {
  heading: string;
  kind: FranchiseeListKind;
  status: "Current" | "Former" | "Planning";
  exhibit: string | null;
  printedPageStart: number | null;
  printedPageEnd: number | null;
  pdfPageStart: number | null;
  pdfPageEnd: number | null;
};

export type FranchiseeSourceDiscovery = {
  tocEntries: FddTocEntry[];
  sections: FranchiseeSection[];
  printedPageToPdfPage: Map<number, number>;
};

export type CandidateSourceMetadata = {
  exhibit?: string | null;
  section?: string | null;
  printedPage?: number | null;
};

function listKindFromText(text: string): FranchiseeListKind | null {
  const value = text.replace(/\s+/g, " ").trim();
  if (/(?:signed but not open|signed agreements? but (?:have )?not yet opened|not yet opened(?: for business)?|franchises sold but not yet opened|franchise agreements signed but outlet not yet opened)/i.test(value)) return "signed-but-not-open";
  if (/(?:former franchisees|former franchisee|ceased operations|franchisees who (?:have )?left|terminated franchisees|terminated franchise agreements|exited domestic franchisees)/i.test(value)) return "former";
  if (/(?:current franchisees|list of (?:open |current )?franchisees|franchisees with outlets open|below is a list of our current franchisees)/i.test(value)) return "current";
  return null;
}

function headingListKind(text: string): FranchiseeListKind | null {
  const compact = text.replace(/\s+/g, " ").trim();
  if (
    !compact
    || compact.length > 180
    || /^[a-z]/.test(compact)
    || /^\d+\s+[A-Za-z]/.test(compact)
    || /\.{2,}\s*\d+(?:\s*(?:-|–|—|to)\s*\d+)?\s*$/i.test(compact)
    || /(?:table of contents|item 20\s*[-–—:]?\s*$)/i.test(compact)
  ) return null;
  const core = compact
    .replace(/^(?:(?:EXHIBIT|EX\.)\s*[A-Z0-9-]+\s*[-–—:]?\s*)/i, "")
    .replace(/^[A-Z]\d?\s*[-.)–—:]\s*/i, "")
    .replace(/^[A-Z]\d?\s+(?=LIST\b)/i, "")
    .trim();
  if (/^(?:LIST OF FRANCHISE(?:S|ES| AGREEMENTS)|LIST OF TERMINATED FRANCHISE AGREEMENTS|LIST OF EXITED DOMESTIC FRANCHISEES|CONTACT INFORMATION FOR|CURRENT FRANCHISEES|FORMER FRANCHISEES|FRANCHISEES WHO (?:HAVE )?LEFT|FRANCHISEES WITH OUTLETS OPEN|SIGNED BUT NOT OPEN|CEASED OPERATIONS|TERMINATED FRANCHISEES|FORMER STUDIO\b)/i.test(core)) {
    return listKindFromText(core);
  }
  return null;
}

function statusFromListKind(kind: FranchiseeListKind) {
  return kind === "current" ? "Current" : kind === "former" ? "Former" : "Planning";
}

function printedPageRange(text: string) {
  const match = text.match(/(?:\.{2,}|\s)(\d{1,4})(?:\s*(?:-|–|—|to)\s*(\d{1,4}))?\s*$/i);
  return match ? { start: Number(match[1]), end: Number(match[2] ?? match[1]) } : null;
}

/**
 * Reads Item 20 and exhibit entries from extracted table-of-contents text.
 * The parser intentionally only emits entries whose title identifies a
 * franchisee list, avoiding page-number-only TOC noise.
 */
export function parseFddTocEntries(text: string): FddTocEntry[] {
  return text.split(/\r?\n/).flatMap((rawLine) => {
    const line = rawLine.replace(/\s+/g, " ").trim();
    const kind = listKindFromText(line);
    const item = line.match(/\bITEM\s*(20)\b/i);
    if (!kind && !item) return [];
    const tocShaped = Boolean(
      item && /^ITEM\s*20\b/i.test(line)
      || /\.{2,}/.test(line)
      || /^(?:(?:EXHIBIT|EX\.)\s*[A-Z0-9-]+|[A-Z]\d)\b/i.test(line)
      || headingListKind(line),
    );
    if (!tocShaped) return [];
    const range = printedPageRange(line);
    const exhibit = line.match(/\b(?:EXHIBIT|EX\.)\s*([A-Z0-9-]+)\b/i);
    return [{
      title: line.replace(/(?:\.{2,}|\s)\d{1,4}(?:\s*(?:-|–|—|to)\s*\d{1,4})?\s*$/i, "").trim(),
      itemNumber: item ? Number(item[1]) : null,
      exhibit: exhibit?.[1] ?? null,
      printedPageStart: range?.start ?? null,
      printedPageEnd: range?.end ?? null,
      hasExplicitPrintedPageRange: Boolean(range && range.start !== range.end),
      listKind: kind,
    }];
  });
}

/** Returns true only for headings that actually identify an Item 20 list. */
export function isFranchiseeSectionHeading(text: string): boolean {
  return headingListKind(text) !== null;
}

/**
 * Maps FDD printed page labels to PDF page indexes. Footer labels are read
 * from the final lines of each page so incidental numbers in table data are
 * not mistaken for printed page numbers.
 */
export function mapPrintedPagesToPdfPages(pages: PdfTextPage[]): Map<number, number> {
  const mappings = new Map<number, number>();
  for (const { pdfPage, text } of pages) {
    const footer = text.split(/\r?\n/).slice(-6).join(" ");
    const labels = [...footer.matchAll(/(?:\bpage\s*)?(?:[A-Z][A-Z -]{0,16}[-–—]\s*)?(\d{1,4})\b/gi)];
    const label = labels.at(-1);
    if (label) mappings.set(Number(label[1]), pdfPage);
  }
  return mappings;
}

/** Discovers validated list headings and resolves their printed-page ranges. */
export function discoverFranchiseeSources(pages: PdfTextPage[]): FranchiseeSourceDiscovery {
  const orderedPages = [...pages].sort((a, b) => a.pdfPage - b.pdfPage);
  const printedPageToPdfPage = mapPrintedPagesToPdfPages(orderedPages);
  const tocEntries = parseFddTocEntries(
    orderedPages
      .filter(({ pdfPage }) => pdfPage <= 25)
      .map(({ text }) => text)
      .join("\n"),
  );
  const sections: FranchiseeSection[] = [];
  const printedPageByPdfPage = new Map<number, number>();
  for (const [printedPage, pdfPage] of printedPageToPdfPage) printedPageByPdfPage.set(pdfPage, printedPage);
  const headingOccurrences: Array<{ pdfPage: number; heading: string; kind: FranchiseeListKind; exhibit: string | null }> = [];
  const exhibitStarts: Array<{ pdfPage: number; exhibit: string }> = [];
  let exhibit: string | null = null;
  for (const { pdfPage, text } of orderedPages) {
    const evidenceCount = [
      ...text.matchAll(new RegExp(`(?:\\b(?:[A-Z]{2}|${STATE_NAME_PATTERN})\\s+\\d{5}\\b|\\b\\d{3}[-.)\\s]+\\d{3}[-.\\s]+\\d{4}\\b|\\b[A-Z]{2}\\d{4}\\b|@[A-Z0-9.-]+\\.[A-Z]{2,})`, "gi")),
    ].length;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.replace(/\s+/g, " ").trim();
      const exhibitMatch = line.match(/^(?:EXHIBIT\b|EX\.)\s*([A-Z0-9-]+)\b/i);
      if (exhibitMatch) {
        exhibit = exhibitMatch[1];
        exhibitStarts.push({ pdfPage, exhibit });
      }
      if (!isFranchiseeSectionHeading(line) || (pdfPage <= 25 && evidenceCount < 1)) continue;
      const kind = headingListKind(line)!;
      headingOccurrences.push({ pdfPage, heading: line, kind, exhibit });
    }
  }

  for (let index = 0; index < headingOccurrences.length; index += 1) {
    const occurrence = headingOccurrences[index];
    // A repeated header is a continuation marker, not a separate list.
    if (headingOccurrences.slice(0, index).some((previous) =>
      previous.kind === occurrence.kind && previous.exhibit === occurrence.exhibit,
    )) continue;

    const toc = tocEntries.find((entry) =>
      entry.listKind === occurrence.kind
      && (entry.exhibit === occurrence.exhibit || (entry.exhibit === null && occurrence.exhibit === null)),
    );
    const nextBoundary = headingOccurrences.slice(index + 1).find((next) =>
      next.kind !== occurrence.kind || next.exhibit !== occurrence.exhibit,
    );
    const nextExhibit = exhibitStarts.find((next) =>
      next.pdfPage > occurrence.pdfPage && next.exhibit !== occurrence.exhibit,
    );
    const startPageIndex = orderedPages.findIndex(({ pdfPage }) => pdfPage === occurrence.pdfPage);
    const boundaryPdfPage = [nextBoundary?.pdfPage, nextExhibit?.pdfPage]
      .filter((value): value is number => value !== undefined)
      .reduce<number | null>((closest, value) => closest === null || value < closest ? value : closest, null);
    const endPageIndex = boundaryPdfPage
      ? orderedPages.findIndex(({ pdfPage }) => pdfPage === boundaryPdfPage) - 1
      : orderedPages.length - 1;
    const continuationPdfPageEnd = orderedPages[Math.max(startPageIndex, endPageIndex)]?.pdfPage ?? occurrence.pdfPage;
    const printedPageStart = toc?.printedPageStart ?? printedPageByPdfPage.get(occurrence.pdfPage) ?? null;
    const printedPageEnd = toc?.hasExplicitPrintedPageRange
      ? toc.printedPageEnd
      : printedPageByPdfPage.get(continuationPdfPageEnd) ?? printedPageStart;
    const mappedExplicitEnd = toc?.hasExplicitPrintedPageRange
      ? printedPageToPdfPage.get(toc.printedPageEnd ?? -1)
      : undefined;
    sections.push({
      heading: occurrence.heading, kind: occurrence.kind, status: statusFromListKind(occurrence.kind), exhibit: occurrence.exhibit,
      printedPageStart,
      printedPageEnd,
      pdfPageStart: printedPageStart ? printedPageToPdfPage.get(printedPageStart) ?? occurrence.pdfPage : occurrence.pdfPage,
      pdfPageEnd: toc?.hasExplicitPrintedPageRange
        ? mappedExplicitEnd && mappedExplicitEnd >= occurrence.pdfPage
          ? mappedExplicitEnd
          : continuationPdfPageEnd
        : continuationPdfPageEnd,
    });
  }
  return { tocEntries, sections, printedPageToPdfPage };
}

export function statusFromHeading(
  text: string,
  current: "Current" | "Former" | "Planning",
): "Current" | "Former" | "Planning" {
  const heading = text.replace(/\s+/g, " ").trim().toUpperCase();
  if (/^(?:(?:FRANCHISEES\s+)?SIGNED BUT NOT OPEN|FRANCHISEES WHO HAVE SIGNED AGREEMENTS BUT HAVE NOT YET OPENED|LIST OF FRANCHISES SOLD BUT NOT YET OPENED|LIST OF FRANCHISE AGREEMENTS SIGNED BUT OUTLET NOT YET OPENED)\b/.test(heading)) return "Planning";
  if (/^(?:CEASED OPERATIONS|FRANCHISEES WHO (?:HAVE )?LEFT|FORMER FRANCHISEES|TERMINATED FRANCHISEES|LIST OF TERMINATED FRANCHISE AGREEMENTS|LIST OF EXITED DOMESTIC FRANCHISEES)\b/.test(heading)) return "Former";
  if (/^(?:CURRENT FRANCHISEES|LIST OF (?:OPEN|CURRENT) FRANCHISEES|FRANCHISEES WITH OUTLETS OPEN)\b/.test(heading)) return "Current";
  return current;
}

export function inferStatus(pageText: string): "Current" | "Former" | "Planning" {
  return pageText
    .split(/\r?\n/)
    .reduce<"Current" | "Former" | "Planning">(
      (status, line) => statusFromHeading(line, status),
      "Current",
    );
}

const KNOWN_FRANCHISORS = [
  { pattern: /\bHOTWORX\b/i, normalized: "HOTWORX" },
  { pattern: /\bElements\s+Massage\b/i, normalized: "Elements Massage" },
  { pattern: /\bMassage\s+Envy\b/i, normalized: "Massage Envy" },
  { pattern: /\bGYMGUYZ\b/i, normalized: "GYMGUYZ" },
  { pattern: /\bGold(?:'|’)?s\s+Gym\b/i, normalized: "Gold’s Gym" },
  { pattern: /\bPure\s+Barre\b/i, normalized: "Pure Barre" },
  { pattern: /\bModo\s+Yoga\b/i, normalized: "Modo Yoga" },
  { pattern: /\bPvolve\b/i, normalized: "Pvolve" },
  { pattern: /\bVIO\s+Med\s+Spa\b/i, normalized: "VIO Med Spa" },
  { pattern: /\bdermani\s+MEDSPA\b/i, normalized: "dermani MEDSPA" },
] as const;

const INVALID_FRANCHISOR_VALUES = /^(?:unknown|n\/a|none|not\s+(?:provided|available|disclosed)|tbd)$/i;
const GENERIC_UPLOAD_NAMES = /^(?:uploaded\s+fdd|fdd|document|franchise\s+disclosure\s+document)$/i;
const LEGAL_ENTITY_SUFFIX = /\b(?:L\.?\s*L\.?\s*C\.?|LLC|L\.?\s*P\.?|LP|L\.?\s*L\.?\s*P\.?|LLP|I\.?\s*N\.?\s*C\.?|INCORPORATED|CORP(?:ORATION)?|LTD|LIMITED)\b/i;
const US_STATES: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA",
  Colorado: "CO", Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA",
  Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
  Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
  Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS",
  Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH",
  "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC",
  "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA",
  "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN",
  Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA", Washington: "WA",
  "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY", "District of Columbia": "DC",
};
const STATE_NAME_PATTERN = Object.keys(US_STATES)
  .sort((a, b) => b.length - a.length)
  .map((state) => state.replace(/\s+/g, "\\s+"))
  .join("|");

function normalizeFranchisorValue(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim().replace(/[.,;:]+$/, "").trim();
  if (!normalized || INVALID_FRANCHISOR_VALUES.test(normalized)) return "";

  const knownFranchisor = KNOWN_FRANCHISORS.find(({ pattern }) => pattern.test(normalized));
  return knownFranchisor?.normalized ?? normalized;
}

function genericFranchisorFromLabel(pageText: string) {
  const labelMatch = pageText.match(
    /\bfranchisor\b\s*(?::|-|\bis\b|\bmeans\b)\s*([^\r\n]+)/i,
  );
  if (!labelMatch?.[1]) return "";

  let value = labelMatch[1]
    .replace(/\s+(?:a|an)\s+(?:Delaware|[A-Z][a-z]+)\b.*$/i, "")
    .trim();

  const legalEntityEnd = value.search(LEGAL_ENTITY_SUFFIX);
  if (legalEntityEnd >= 0) {
    const suffix = value.slice(legalEntityEnd).match(LEGAL_ENTITY_SUFFIX)?.[0] ?? "";
    value = value.slice(0, legalEntityEnd + suffix.length);
  } else {
    value = value.split(/[.;](?:\s|$)/, 1)[0] ?? value;
  }

  if (!/^[A-Za-z0-9]/.test(value)) return "";
  const normalized = normalizeFranchisorValue(value);
  if (!normalized || /^(?:at|a|an|the|we|us|our|it|its)$/i.test(normalized)) return "";
  return normalized;
}

export function detectFranchisor(pageText: string, fallback: string) {
  const fallbackValue = normalizeFranchisorValue(fallback);
  const knownFallback = KNOWN_FRANCHISORS.find(({ pattern }) => pattern.test(fallbackValue));
  if (knownFallback) return knownFallback.normalized;

  const knownFranchisor = KNOWN_FRANCHISORS.find(({ pattern }) => pattern.test(pageText));
  if (knownFranchisor) return knownFranchisor.normalized;

  if (fallbackValue && !GENERIC_UPLOAD_NAMES.test(fallbackValue)) return fallbackValue;
  return genericFranchisorFromLabel(pageText) || fallbackValue || fallback;
}

export function franchisorFromFilename(filename: string) {
  const withoutExtension = filename.replace(/\.pdf$/i, "");
  const beforeYear = withoutExtension.split(/(?:[-_\s]+)20\d{2}(?:[-_\s]+|$)/, 1)[0] ?? "";
  const cleaned = beforeYear
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalizeFranchisorValue(cleaned) || "Uploaded FDD";
}

export function rowsFromItems(items: any[]) {
  const lines = new Map<number, Array<{ x: number; width: number; text: string }>>();
  for (const item of items) {
    if (!item?.str?.trim() || !Array.isArray(item.transform)) continue;
    const y = Math.round(Number(item.transform[5]) / 2) * 2;
    const line = lines.get(y) ?? [];
    line.push({ x: Number(item.transform[4]), width: Number(item.width ?? 0), text: item.str.trim() });
    lines.set(y, line);
  }
  return [...lines.entries()]
    .sort(([a], [b]) => b - a)
    .map(([, line]) => {
      const ordered = line.sort((a, b) => a.x - b.x);
      const cells: string[] = [];
      let rightEdge = Number.NEGATIVE_INFINITY;
      for (const item of ordered) {
        if (cells.length && item.x - rightEdge > 18) cells.push(item.text);
        else if (cells.length) cells[cells.length - 1] = `${cells[cells.length - 1]} ${item.text}`.trim();
        else cells.push(item.text);
        rightEdge = Math.max(rightEdge, item.x + item.width);
      }
      return cells;
    });
}

export function candidateFromCells(
  cells: string[],
  documentId: string,
  franchisor: string,
  pageNumber: number,
  status: "Current" | "Former" | "Planning",
  source: CandidateSourceMetadata = {},
): FranchisorCandidate | null {
  const normalized = cells.map((cell) => cell.replace(/\s+/g, " ").trim()).filter(Boolean);
  const stateOnlyPattern = new RegExp(`^(?:[A-Z]{2}|${STATE_NAME_PATTERN})$`, "i");
  const stateZipPattern = new RegExp(`\\b([A-Z]{2}|${STATE_NAME_PATTERN})\\s+(\\d{5}(?:-\\d{4})?)\\b`, "i");
  let stateIndex = normalized.findIndex((cell) => stateOnlyPattern.test(cell));
  if (stateIndex < 2) {
    stateIndex = normalized.findIndex((cell) => stateZipPattern.test(cell));
  }
  if (stateIndex < 2) {
    return candidateFromContactDirectoryCells(
      normalized,
      documentId,
      franchisor,
      pageNumber,
      status,
      source,
    );
  }

  const combinedState = normalized[stateIndex].match(stateZipPattern);
  const combinedCityState = normalized[stateIndex].match(
    new RegExp(`^(.+?),\\s*([A-Z]{2}|${STATE_NAME_PATTERN})\\s+(\\d{5}(?:-\\d{4})?)\\b`, "i"),
  );
  const rawState = combinedState?.[1] ?? normalized[stateIndex];
  const state = /^[A-Z]{2}$/i.test(rawState)
    ? rawState.toUpperCase()
    : US_STATES[Object.keys(US_STATES).find((name) => name.toLowerCase() === rawState.toLowerCase()) ?? ""] ?? rawState;
  const zip = combinedCityState?.[3] ?? combinedState?.[2]
    ?? normalized
      .slice(stateIndex + 1)
      .map((cell) => cell.match(/^(\d{5}(?:-\d{4})?)(?:\s|$)/)?.[1])
      .find(Boolean);
  const city = combinedCityState?.[1].trim() ?? normalized[stateIndex - 1] ?? null;
  const address = combinedCityState ? normalized[stateIndex - 1] ?? null : normalized[stateIndex - 2] ?? null;
  if (!address || !/\d/.test(address) || !city || !zip) {
    return candidateFromContactDirectoryCells(
      normalized,
      documentId,
      franchisor,
      pageNumber,
      status,
      source,
    );
  }

  const beforeAddress = normalized.slice(0, combinedCityState ? stateIndex - 1 : stateIndex - 2);
  const franchiseeEntity = beforeAddress.filter((cell) => !/^(store|location|number|no\.?|#)$/i.test(cell)).join(" ") || null;
  const rawSourceText = normalized.join(" | ");
  const email = rawSourceText.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] ?? null;
  const phone = rawSourceText.match(/(?<!\d)(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\d)/)?.[0] ?? null;
  const normalizedFranchisor = normalizeFranchisorValue(franchisor) || franchisor.trim();

  return {
    documentId,
    franchiseName: normalizedFranchisor,
    franchisor: normalizedFranchisor,
    status: /(?:not yet opened|\bTBD\b)/i.test(rawSourceText) ? "Planning" : status,
    franchiseeEntity,
    address,
    city,
    state,
    zip,
    country: "United States",
    phone,
    email,
    sourcePage: pageNumber,
    rawSourceText,
    confidence: 0.64,
    reviewStatus: "Needs review",
    reviewReason: "Automatically extracted from PDF layout",
    sourceExhibit: source.exhibit ?? null,
    sourceSection: source.section ?? null,
    sourcePrintedPage: source.printedPage ?? null,
  };
}

export function candidateFromContactDirectoryCells(
  cells: string[],
  documentId: string,
  franchisor: string,
  pageNumber: number,
  status: "Current" | "Former" | "Planning",
  source: CandidateSourceMetadata = {},
): FranchisorCandidate | null {
  const normalized = cells.map((cell) => cell.replace(/\s+/g, " ").trim()).filter(Boolean);
  const stateOnlyPattern = new RegExp(`^(?:[A-Z]{2}|${STATE_NAME_PATTERN})$`, "i");
  const stateIndex = normalized.findIndex((cell) => stateOnlyPattern.test(cell));
  if (stateIndex < 0 || stateIndex > 2 || normalized.length < 3) return null;
  const rawState = normalized[stateIndex];
  const state = /^[A-Z]{2}$/i.test(rawState)
    ? rawState.toUpperCase()
    : US_STATES[Object.keys(US_STATES).find((name) => name.toLowerCase() === rawState.toLowerCase()) ?? ""] ?? rawState;
  const entityIndex = stateIndex === 2 ? 0 : stateIndex + 1;
  const franchiseeEntity = normalized[entityIndex] ?? null;
  if (
    !franchiseeEntity
    || /^(?:former studio|studio territory|state|franchisee|primary contact|phone|location)$/i.test(franchiseeEntity)
  ) return null;
  const rawSourceText = normalized.join(" | ");
  const email = rawSourceText.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] ?? null;
  const phone = rawSourceText.match(/(?<!\d)(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\d)/)?.[0] ?? null;
  if (!phone && !email) return null;
  const normalizedFranchisor = normalizeFranchisorValue(franchisor) || franchisor.trim();
  return {
    documentId,
    franchiseName: normalizedFranchisor,
    franchisor: normalizedFranchisor,
    status,
    franchiseeEntity,
    address: "Address not disclosed",
    city: stateIndex === 0 ? "Not disclosed" : normalized[stateIndex - 1],
    state,
    zip: "",
    country: "United States",
    phone,
    email,
    sourcePage: pageNumber,
    rawSourceText,
    confidence: 0.58,
    reviewStatus: "Needs review",
    reviewReason: "The FDD identifies a franchisee or territory but does not disclose a street address",
    sourceExhibit: source.exhibit ?? null,
    sourceSection: source.section ?? null,
    sourcePrintedPage: source.printedPage ?? null,
  };
}

export function candidatesFromTerritoryDirectoryLines(
  lines: string[],
  documentId: string,
  franchisor: string,
  pageNumber: number,
  source: CandidateSourceMetadata = {},
): FranchisorCandidate[] {
  const candidates: FranchisorCandidate[] = [];
  let block: string[] = [];
  let activePageNumber = pageNumber;
  let status: "Current" | "Former" | "Planning" = "Current";
  let state: string | null = null;
  const stateOnlyPattern = new RegExp(`^(?:[A-Z]{2}|${STATE_NAME_PATTERN})$`, "i");
  const normalizedFranchisor = normalizeFranchisorValue(franchisor) || franchisor.trim();

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const pageMatch = line.match(/^\[\[PAGE:(\d+)]]$/);
    if (pageMatch) {
      activePageNumber = Number(pageMatch[1]);
      block = [];
      continue;
    }
    const statusMatch = line.match(/^\[\[STATUS:(Current|Former|Planning)]]$/);
    if (statusMatch) {
      status = statusMatch[1] as typeof status;
      block = [];
      continue;
    }
    const headingStatus = statusFromHeading(line, status);
    if (headingStatus !== status) {
      status = headingStatus;
      block = [];
      continue;
    }
    if (stateOnlyPattern.test(line)) {
      const rawState = line;
      state = /^[A-Z]{2}$/i.test(rawState)
        ? rawState.toUpperCase()
        : US_STATES[Object.keys(US_STATES).find((name) => name.toLowerCase() === rawState.toLowerCase()) ?? ""] ?? rawState;
      block = [];
      continue;
    }
    block.push(line);
    const locationCodes = [...line.matchAll(/\b([A-Z]{2}\d{4})\b/g)].map((match) => match[1]);
    if (!locationCodes.length || !state) continue;
    const rawBlock = block.join(" | ");
    const repairedBlock = rawBlock
      .replace(/(\.[A-Z])\s+([A-Z]{1,2})(?=\b|[;|])/gi, "$1$2")
      .replace(/\s+@\s*/g, "@");
    const email = repairedBlock.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] ?? null;
    const phone = repairedBlock.match(/(?<!\d)(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\d)/)?.[0] ?? null;
    const territory = [...block].reverse().find((entry) => /\bDMA\b/i.test(entry))
      ?.replace(/\s+DMA\b.*$/i, "")
      .trim() ?? "Territory not disclosed";
    const entity = block.find((entry) => /\b(?:LLC|L\.L\.C\.?|INC\.?|CORP\.?|LTD\.?|LP|LLP)\b/i.test(entry))
      ?? block.find((entry) =>
        /^[A-Za-z][A-Za-z&'’. -]{2,}$/.test(entry)
        && !/(?:franchise|disclosure|document|location|code|email|phone|outlet|note|DMA)/i.test(entry),
      )
      ?? null;
    for (const locationCode of locationCodes) {
      candidates.push({
        documentId,
        franchiseName: normalizedFranchisor,
        franchisor: normalizedFranchisor,
        status,
        franchiseeEntity: entity,
        address: "Address not disclosed",
        city: territory,
        state,
        zip: "",
        country: "United States",
        phone,
        email,
        sourcePage: activePageNumber,
        rawSourceText: `${rawBlock} | Location code: ${locationCode}`,
        confidence: 0.52,
        reviewStatus: "Needs review",
        reviewReason: "The FDD identifies a franchise territory or agreement code without a normalized street address",
        sourceExhibit: source.exhibit ?? null,
        sourceSection: source.section ?? null,
        sourcePrintedPage: source.printedPage ?? null,
      });
    }
    block = [];
  }
  return candidates;
}

export function columnLinesFromItems(items: any[], pageWidth: number) {
  const columns = [new Map<number, Array<{ x: number; text: string }>>(), new Map<number, Array<{ x: number; text: string }>>()];
  for (const item of items) {
    if (!item?.str?.trim() || !Array.isArray(item.transform)) continue;
    const x = Number(item.transform[4]);
    const y = Math.round(Number(item.transform[5]) / 2) * 2;
    const columnIndex = x >= pageWidth / 2 ? 1 : 0;
    const line = columns[columnIndex].get(y) ?? [];
    line.push({ x, text: item.str.trim() });
    columns[columnIndex].set(y, line);
  }
  return columns.map((column) =>
    [...column.entries()]
      .sort(([a], [b]) => b - a)
      .map(([, line]) => line.sort((a, b) => a.x - b.x).map(({ text }) => text).join(" ").replace(/\s+/g, " ").trim())
      .filter(Boolean),
  );
}

const CITY_STATE_ZIP = /^(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/;
const TERRITORY = /^(.+?),\s*([A-Z]{2})(?:\s+(?:\(.*\)|[-–—].*))?$/;
const ADDRESS_CITY_STATE_ZIP = new RegExp(
  `^(?:(.+?),\\s*)?([^,]+),\\s*([A-Z]{2}|${STATE_NAME_PATTERN})\\s*,?\\s*(\\d{5}(?:-\\d{4})?)(?:\\s+.*)?$`,
  "i",
);

function findLastMatchingIndex(values: string[], predicate: (entry: string, index: number) => boolean) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index], index)) return index;
  }
  return -1;
}

export function candidatesFromUnitBlockLines(
  lines: string[],
  documentId: string,
  franchisor: string,
  pageNumber: number,
  source: CandidateSourceMetadata = {},
): FranchisorCandidate[] {
  const candidates: FranchisorCandidate[] = [];
  let block: string[] = [];
  let status: "Current" | "Former" | "Planning" = "Current";
  let activePageNumber = pageNumber;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (line === "[[STATUS:Former]]") {
      status = "Former";
      continue;
    }
    if (line === "[[STATUS:Planning]]") {
      status = "Planning";
      continue;
    }
    if (line === "[[STATUS:Current]]") {
      status = "Current";
      continue;
    }
    const pageMatch = line.match(/^\[\[PAGE:(\d+)]]$/);
    if (pageMatch) {
      activePageNumber = Number(pageMatch[1]);
      continue;
    }
    const nextStatus = statusFromHeading(line, status);
    if (nextStatus !== status) {
      status = nextStatus;
      block = [];
      continue;
    }

    const unitMatch = line.match(/^#\s*of\s+units:\s*(\d+)$/i);
    if (!unitMatch) {
      block.push(line);
      continue;
    }

    const unitCount = Number(unitMatch[1]);
    const mailingIndex = findLastMatchingIndex(block, (entry) => CITY_STATE_ZIP.test(entry));
    if (mailingIndex >= 0) {
      const mailing = block[mailingIndex].match(CITY_STATE_ZIP)!;
      const addressIndex = findLastMatchingIndex(
        block,
        (entry, index) => index < mailingIndex && /\d/.test(entry) && !/^\d{3}[-.\s]\d{3}/.test(entry),
      );
      const ownerIndex = findLastMatchingIndex(
        block,
        (entry, index) =>
          index < addressIndex
          && !TERRITORY.test(entry)
          && !CITY_STATE_ZIP.test(entry)
          && !/^(?:Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)$/i.test(entry),
      );
      const territories = block
        .slice(0, ownerIndex >= 0 ? ownerIndex : addressIndex)
        .map((entry) => entry.match(TERRITORY))
        .filter((match): match is RegExpMatchArray => Boolean(match));
      const locations = territories.length
        ? territories.slice(-unitCount)
        : [[mailing[0], mailing[1], mailing[2]] as unknown as RegExpMatchArray];
      const owner = ownerIndex >= 0 ? block[ownerIndex] : null;
      const address = addressIndex >= 0 ? block[addressIndex] : "Address not listed";
      const normalizedFranchisor = normalizeFranchisorValue(franchisor) || franchisor.trim();

      for (const territory of locations) {
        candidates.push({
          documentId,
          franchiseName: normalizedFranchisor,
          franchisor: normalizedFranchisor,
          status,
          franchiseeEntity: owner,
          address,
          city: territory[1].trim(),
          state: territory[2].toUpperCase(),
          zip: mailing[3],
          country: "United States",
          phone: null,
          email: null,
          sourcePage: activePageNumber,
          rawSourceText: [...block, line, `Territory: ${territory[0]}`].join(" | "),
          confidence: 0.68,
          reviewStatus: "Needs review",
          reviewReason: "Automatically extracted from a franchise territory block",
          sourceExhibit: source.exhibit ?? null,
          sourceSection: source.section ?? null,
          sourcePrintedPage: source.printedPage ?? null,
        });
      }
    }
    block = [];
  }
  return candidates;
}

function isLocationListHeading(line: string) {
  return /(?:LIST OF (?:OPEN |CURRENT )?FRANCHISEES|CURRENT FRANCHISEES|FRANCHISEES WITH OUTLETS OPEN|FRANCHISEES WHO (?:HAVE )?LEFT|FORMER FRANCHISEES|SIGNED BUT NOT OPEN|LIST OF CURRENT .+ FORMER FRANCHISEES|BELOW IS A LIST OF OUR CURRENT FRANCHISEES)/i.test(line);
}

function stateAbbreviation(value: string) {
  if (/^[A-Z]{2}$/i.test(value)) return value.toUpperCase();
  const name = Object.keys(US_STATES).find((state) => state.toLowerCase() === value.toLowerCase());
  return name ? US_STATES[name] : value;
}

export function candidatesFromAddressBlockLines(
  lines: string[],
  documentId: string,
  franchisor: string,
  pageNumber: number,
  source: CandidateSourceMetadata = {},
): FranchisorCandidate[] {
  const candidates: FranchisorCandidate[] = [];
  const history: string[] = [];
  let activePageNumber = pageNumber;
  let status: "Current" | "Former" | "Planning" = "Current";
  let inLocationSection = false;
  let lastCandidate: FranchisorCandidate | null = null;
  const normalizedFranchisor = normalizeFranchisorValue(franchisor) || franchisor.trim();

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;

    const pageMatch = line.match(/^\[\[PAGE:(\d+)]]$/);
    if (pageMatch) {
      activePageNumber = Number(pageMatch[1]);
      continue;
    }
    const markerMatch = line.match(/^\[\[STATUS:(Current|Former|Planning)]]$/);
    if (markerMatch) {
      status = markerMatch[1] as "Current" | "Former" | "Planning";
      continue;
    }
    if (/^EXHIBIT\s+[A-Z0-9-]+\b/i.test(line)) {
      inLocationSection = false;
      history.length = 0;
      lastCandidate = null;
      continue;
    }

    const nextStatus = statusFromHeading(line, status);
    if (nextStatus !== status) status = nextStatus;
    if (isLocationListHeading(line)) {
      inLocationSection = true;
      history.length = 0;
      lastCandidate = null;
      continue;
    }
    if (!inLocationSection) continue;

    const location = line.match(ADDRESS_CITY_STATE_ZIP);
    const phone = line.match(/(?<!\d)(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\d)/)?.[0] ?? null;
    const email = line.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] ?? null;
    if ((phone || email) && !location) {
      if (lastCandidate && lastCandidate.sourcePage === activePageNumber) {
        if (phone) lastCandidate.phone = phone;
        if (email) lastCandidate.email = email;
        lastCandidate.rawSourceText = `${lastCandidate.rawSourceText} | ${line}`;
        continue;
      }
      const territoryIndex = findLastMatchingIndex(history, (entry) => TERRITORY.test(entry));
      const territory = territoryIndex >= 0 ? history[territoryIndex].match(TERRITORY) : null;
      const trailingLines = territory ? history.slice(territoryIndex + 1) : [];
      const owner = trailingLines.find((entry) => !TERRITORY.test(entry)) ?? null;
      const hasStreetAddress = trailingLines.length > 1;
      if (territory && owner && !hasStreetAddress) {
        candidates.push({
          documentId,
          franchiseName: normalizedFranchisor,
          franchisor: normalizedFranchisor,
          status,
          franchiseeEntity: owner.replace(/\*+$/, "").trim(),
          address: "Address not disclosed",
          city: territory[1].trim(),
          state: territory[2].toUpperCase(),
          zip: "",
          country: "United States",
          phone,
          email,
          sourcePage: activePageNumber,
          rawSourceText: [...history.slice(territoryIndex), line].join(" | "),
          confidence: 0.58,
          reviewStatus: "Needs review",
          reviewReason: "FDD lists the franchise territory but does not disclose a street address",
          sourceExhibit: source.exhibit ?? null,
          sourceSection: source.section ?? null,
          sourcePrintedPage: source.printedPage ?? null,
        });
        lastCandidate = candidates.at(-1) ?? null;
        history.length = 0;
      }
      continue;
    }
    if (!location) {
      history.push(line);
      if (history.length > 8) history.shift();
      continue;
    }

    const inlineAddress = location[1]?.trim();
    const previousAddressIndex = findLastMatchingIndex(
      history,
      (entry) => /\d/.test(entry) && !/^\(?\d{3}\)?[-.\s]\d{3}/.test(entry),
    );
    const address = (inlineAddress && /\d/.test(inlineAddress)
      ? inlineAddress
      : previousAddressIndex >= 0
        ? history[previousAddressIndex]
        : "")
      .replace(/^[A-Z]{2}\s+(?=\d)/, "")
      .trim();
    if (!address) {
      history.push(line);
      continue;
    }

    const ownerSearchEnd = inlineAddress ? history.length : previousAddressIndex;
    const ownerIndex = findLastMatchingIndex(
      history,
      (entry, index) =>
        index < ownerSearchEnd
        && !/\d/.test(entry)
        && !TERRITORY.test(entry)
        && !isLocationListHeading(entry)
        && !Object.keys(US_STATES).some((state) => state.toLowerCase() === entry.toLowerCase()),
    );
    const franchiseeEntity = ownerIndex >= 0 ? history[ownerIndex].replace(/\*+$/, "").trim() : null;
    const rawSourceText = [...history.slice(Math.max(0, ownerIndex)), line].join(" | ");

    candidates.push({
      documentId,
      franchiseName: normalizedFranchisor,
      franchisor: normalizedFranchisor,
      status,
      franchiseeEntity,
      address,
      city: location[2].trim(),
      state: stateAbbreviation(location[3]),
      zip: location[4],
      country: "United States",
      phone,
      email,
      sourcePage: activePageNumber,
      rawSourceText,
      confidence: 0.66,
      reviewStatus: "Needs review",
      reviewReason: "Automatically extracted from a multiline franchisee address block",
      sourceExhibit: source.exhibit ?? null,
      sourceSection: source.section ?? null,
      sourcePrintedPage: source.printedPage ?? null,
    });
    lastCandidate = candidates.at(-1) ?? null;
    history.length = 0;
  }
  return candidates;
}