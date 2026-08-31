import { count, eq, ilike, inArray, sql } from "drizzle-orm";
import { execFile } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  contactsTable,
  type FddExtractionManifest,
  fddDocumentsTable,
  franchiseLocationsTable,
  processingStagesTable,
} from "@workspace/db/schema";
import { getObjectFile } from "./objectStorage.ts";
import {
  candidateFromCells,
  candidatesFromAddressBlockLines,
  candidatesFromTerritoryDirectoryLines,
  candidatesFromUnitBlockLines,
  columnLinesFromItems,
  detectFranchisor,
  discoverFranchiseeSources,
  franchisorFromFilename,
  type FranchiseeSection,
  type FranchisorCandidate,
  type PdfTextPage,
  rowsFromItems,
  statusFromHeading,
} from "./fddParser.ts";
type Candidate = typeof franchiseLocationsTable.$inferInsert;
type Contact = Omit<typeof contactsTable.$inferInsert, "locationId">;
type ExistingLocation = typeof franchiseLocationsTable.$inferSelect;
type ExistingContact = typeof contactsTable.$inferSelect;

type ProductionDb = (typeof import("@workspace/db"))["db"];
type ProcessorDb = Pick<ProductionDb, "select" | "insert" | "update" | "delete" | "execute" | "transaction">;
type ObjectFile = {
  download(): Promise<[Buffer | Uint8Array]>;
};
type ProcessorDependencies = {
  db?: ProcessorDb;
  getObjectFile?: (objectPath: string) => ObjectFile;
  ocrPage?: (pdfData: Uint8Array, pageNumber: number) => Promise<OcrPageResult>;
};

export type ExtractedCandidate = {
  location: Candidate;
  contacts: Contact[];
};

type OcrWord = {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  confidence: number;
};

type WorkingRecord = {
  existingId?: string;
  location: Candidate;
  contacts: Contact[];
  contactsChanged: boolean;
  writeChanged: boolean;
};

export type ReconciliationResult = {
  records: WorkingRecord[];
  deleteLocationIds: string[];
  addedRows: number;
  matchedRows: number;
  updatedRows: number;
  unchangedRows: number;
  ambiguousRows: number;
  collapsedRows: number;
  removedRows: number;
};

function uniqueNumbers(values: number[]) {
  return [...new Set(values)].sort((a, b) => a - b);
}

const PLACEHOLDER_VALUE = /^(?:n\/?a|none|unknown|not (?:listed|disclosed|available|provided)|—|-)$/i;

function meaningful(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !PLACEHOLDER_VALUE.test(value.trim());
}

const PHONE_PATTERN = /(?<!\d)(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\d)/;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const ENTITY_END_PATTERN = /\b(?:L\.?\s*L\.?\s*C\.?|I\.?\s*N\.?\s*C\.?|INCORPORATED|CORP(?:ORATION)?\.?|LTD\.?|LIMITED|L\.?\s*P\.?|L\.?\s*L\.?\s*P\.?|LLP|COMPANY|CO\.?)\b/i;
const HEADER_OR_NOTE_PATTERN = /^(?:current|former|planning|franchisees?|franchisee name|owner|primary contact|phone|email|address|city|state|zip|location|store|studio|territory|total|notes?|continued|exhibit|item\s*20)\b/i;

/**
 * Cleans extraction artifacts before a row is persisted. In particular, PDF
 * cells often concatenate a legal entity, contact name, and phone number.
 */
export function sanitizeCandidate(candidate: FranchisorCandidate): FranchisorCandidate {
  const next = { ...candidate };
  const source = next.rawSourceText ?? "";
  next.phone ??= source.match(PHONE_PATTERN)?.[0] ?? null;
  next.email ??= source.match(EMAIL_PATTERN)?.[0] ?? null;

  let entity = next.franchiseeEntity
    ?.replace(/^\s*\d+[.)]?\s*/, "")
    .replace(EMAIL_PATTERN, " ")
    .replace(PHONE_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim() ?? "";
  const entityEnd = entity.match(ENTITY_END_PATTERN);
  if (entityEnd?.index !== undefined) {
    entity = entity.slice(0, entityEnd.index + entityEnd[0].length).trim();
  }
  if (
    !entity
    || HEADER_OR_NOTE_PATTERN.test(entity)
    || entity.length > 160
    || /(?:table of contents|franchise disclosure document|see notes? below)/i.test(entity)
  ) {
    next.franchiseeEntity = null;
  } else {
    next.franchiseeEntity = entity.replace(/[|;,]+$/, "").trim() || null;
  }
  return next;
}

/** Scores field-level evidence instead of trusting one parser-wide constant. */
export function scoreCandidate(candidate: FranchisorCandidate) {
  const hasAddress = meaningful(candidate.address) && /^\d+\s+\S+/.test(candidate.address.trim());
  const hasGeo = meaningful(candidate.city) && /^[A-Z]{2}$/.test(candidate.state ?? "");
  const hasZip = /^\d{5}(?:-\d{4})?$/.test(candidate.zip ?? "");
  const hasEntity = meaningful(candidate.franchiseeEntity);
  const hasContact = Boolean(candidate.phone || candidate.email);
  const hasCitation = Boolean(candidate.sourceSection || candidate.sourceExhibit);

  let confidence = 0.15;
  if (hasAddress) confidence += 0.3;
  if (hasGeo) confidence += 0.15;
  if (hasZip) confidence += 0.1;
  if (hasEntity) confidence += 0.15;
  if (hasContact) confidence += 0.05;
  if (hasCitation) confidence += 0.05;
  if (!hasAddress) confidence = Math.min(confidence, 0.58);
  if (!hasEntity) confidence = Math.min(confidence, 0.68);

  const issues: string[] = [];
  if (!hasAddress) issues.push("street address was not disclosed or could not be normalized");
  if (!hasGeo) issues.push("city/state is incomplete");
  if (!hasEntity) issues.push("franchisee or legal entity was not confidently identified");
  if (!hasZip && hasAddress) issues.push("ZIP code is missing or malformed");
  return { confidence: Number(Math.max(0.05, Math.min(0.95, confidence)).toFixed(3)), issues };
}

function normalizeIdentityText(value: string | null | undefined) {
  if (!value) return "";
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeAddress(value: string | null | undefined) {
  return normalizeIdentityText(value)
    .replace(/\b(street|str)\b/g, "st")
    .replace(/\b(avenue|ave)\b/g, "ave")
    .replace(/\b(road|rd)\b/g, "rd")
    .replace(/\b(boulevard|blvd)\b/g, "blvd")
    .replace(/\b(drive|dr)\b/g, "dr")
    .replace(/\b(lane|ln)\b/g, "ln")
    .replace(/\b(highway|hwy)\b/g, "hwy")
    .replace(/\b(suite|ste)\b/g, "ste")
    .replace(/\b(north)\b/g, "n")
    .replace(/\b(south)\b/g, "s")
    .replace(/\b(east)\b/g, "e")
    .replace(/\b(west)\b/g, "w");
}

function normalizedLocationCode(location: Candidate) {
  const explicit = normalizeIdentityText(location.locationCode).replace(/\s/g, "");
  if (explicit) return explicit;
  const rawCode = location.rawSourceText?.match(
    /(?:location|studio|store|territory|agreement)\s*(?:code|number|no\.?|#)?\s*[:#-]?\s*([a-z]{0,4}\d{2,8})\b/i,
  )?.[1];
  return normalizeIdentityText(rawCode).replace(/\s/g, "");
}

export function locationIdentityKeys(location: Candidate) {
  const code = normalizedLocationCode(location);
  const address = meaningful(location.address)
    && meaningful(location.city)
    && meaningful(location.state)
    ? [
        normalizeAddress(location.address),
        normalizeIdentityText(location.city),
        normalizeIdentityText(location.state),
      ].join("|")
    : "";
  const entityValue = normalizeIdentityText(location.franchiseeEntity);
  const entity = entityValue.length >= 5
    && meaningful(location.city)
    && meaningful(location.state)
    ? [
        entityValue,
        normalizeIdentityText(location.city),
        normalizeIdentityText(location.state),
      ].join("|")
    : "";
  const rawSource = normalizeIdentityText(location.rawSourceText);
  const exact = rawSource && entityValue
    ? [
        normalizeIdentityText(location.status),
        entityValue,
        normalizeAddress(location.address),
        normalizeIdentityText(location.city),
        normalizeIdentityText(location.state),
        normalizeIdentityText(location.zip),
        rawSource,
      ].join("|")
    : "";
  return { code, address, entity, exact };
}

function fieldQuality(
  field: keyof Candidate,
  value: unknown,
) {
  if (!meaningful(value)) return 0;
  const text = value.trim();
  switch (field) {
    case "address":
      return /^\d+\s+\S+/.test(text) ? 4 : 2;
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? 4 : 2;
    case "phone":
      return text.replace(/\D/g, "").length >= 10 ? 4 : 2;
    case "zip":
      return /^\d{5}(?:-\d{4})?$/.test(text) ? 4 : 2;
    case "state":
      return /^[A-Z]{2}$/i.test(text) ? 4 : 2;
    case "locationCode":
      return normalizeIdentityText(text).length >= 3 ? 4 : 2;
    case "franchiseeEntity":
      return /\b(?:llc|inc|corp|company|co|ltd|lp|llp|holdings|enterprises|ventures)\b/i.test(text)
        ? 4
        : 3;
    default:
      return 2;
  }
}

const MERGEABLE_FIELDS = [
  "franchiseeEntity",
  "address",
  "city",
  "state",
  "zip",
  "country",
  "phone",
  "email",
  "locationCode",
  "exitReason",
] as const;

function mergeBusinessFields(
  existing: Candidate,
  incoming: Candidate,
  preserveReviewedValues: boolean,
) {
  const merged: Candidate = { ...existing };
  let changed = false;
  const existingConfidence = existing.confidence ?? 0.8;
  const incomingConfidence = incoming.confidence ?? 0.8;

  for (const field of MERGEABLE_FIELDS) {
    const currentValue = existing[field];
    const incomingValue = incoming[field];
    const useIncoming = !meaningful(currentValue)
      ? meaningful(incomingValue)
      : meaningful(incomingValue)
        && !preserveReviewedValues
        && (
          fieldQuality(field, incomingValue) > fieldQuality(field, currentValue)
          || (
            fieldQuality(field, incomingValue) === fieldQuality(field, currentValue)
            && normalizeIdentityText(incomingValue) !== normalizeIdentityText(currentValue)
            && incomingConfidence > existingConfidence + 0.05
          )
        );
    if (useIncoming && currentValue !== incomingValue) {
      (merged as Record<string, unknown>)[field] = incomingValue;
      changed = true;
    }
  }

  if (!preserveReviewedValues && incoming.status && existing.status !== incoming.status) {
    merged.status = incoming.status;
    changed = true;
  }
  return { merged, changed };
}

function contactIdentity(contact: Contact) {
  const email = normalizeIdentityText(contact.email).replace(/\s/g, "");
  const phoneDigits = contact.phone?.replace(/\D/g, "") ?? "";
  const phone = phoneDigits.length >= 10 ? phoneDigits.slice(-10) : phoneDigits;
  const name = normalizeIdentityText(
    contact.rawName
      ?? [contact.firstName, contact.middleName, contact.lastName, contact.suffix].filter(Boolean).join(" "),
  );
  return { email, phone, name };
}

function contactsMatch(left: Contact, right: Contact) {
  const a = contactIdentity(left);
  const b = contactIdentity(right);
  if (a.email && b.email && a.email === b.email) return true;
  if (a.name && b.name && a.phone && b.phone) {
    return a.name === b.name && a.phone === b.phone;
  }
  if (a.phone && b.phone && a.phone === b.phone) {
    return !a.name && !b.name && !a.email && !b.email;
  }
  return a.name === b.name
    && Boolean(a.name)
    && !a.email
    && !b.email
    && !a.phone
    && !b.phone;
}

function stripContact(contact: ExistingContact): Contact {
  const { id: _id, locationId: _locationId, ...value } = contact;
  return value;
}

function mergeContactLists(...lists: Contact[][]) {
  const merged: Contact[] = [];
  for (const contact of lists.flat()) {
    const matchIndex = merged.findIndex((current) => contactsMatch(current, contact));
    if (matchIndex < 0) {
      merged.push({ ...contact });
      continue;
    }
    const current = merged[matchIndex];
    const next = { ...current };
    for (const field of [
      "rawName",
      "firstName",
      "middleName",
      "lastName",
      "suffix",
      "title",
      "email",
      "phone",
    ] as const) {
      if (!meaningful(current[field]) && meaningful(contact[field])) {
        next[field] = contact[field];
      }
    }
    merged[matchIndex] = next;
  }
  const original = lists[0] ?? [];
  const changed = original.length !== merged.length
    || original.some((contact, index) =>
      JSON.stringify(contact) !== JSON.stringify(merged[index]),
    );
  return { contacts: merged, changed };
}

function candidateFromExisting(existing: ExistingLocation): Candidate {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...candidate } = existing;
  return candidate;
}

function markAmbiguous(location: Candidate, reason: string): Candidate {
  return {
    ...location,
    reviewStatus: "Needs review",
    reviewReason: reason,
  };
}

export function reconcileFranchiseCandidates(
  incomingCandidates: ExtractedCandidate[],
  existingLocations: ExistingLocation[],
  existingContacts: ExistingContact[],
): ReconciliationResult {
  const contactsByLocation = new Map<string, Contact[]>();
  for (const contact of existingContacts) {
    const contacts = contactsByLocation.get(contact.locationId) ?? [];
    contacts.push(stripContact(contact));
    contactsByLocation.set(contact.locationId, contacts);
  }
  const records: WorkingRecord[] = existingLocations.map((location) => ({
    existingId: location.id,
    location: candidateFromExisting(location),
    contacts: contactsByLocation.get(location.id) ?? [],
    contactsChanged: false,
    writeChanged: false,
  }));
  const touchedExistingIds = new Set<string>();
  const updatedExistingIds = new Set<string>();
  type IdentityKind = keyof ReturnType<typeof locationIdentityKeys>;
  const indexes: Record<IdentityKind, Map<string, WorkingRecord[]>> = {
    code: new Map(),
    address: new Map(),
    entity: new Map(),
    exact: new Map(),
  };
  const indexRecord = (record: WorkingRecord) => {
    const keys = locationIdentityKeys(record.location);
    for (const kind of Object.keys(indexes) as IdentityKind[]) {
      const key = keys[kind];
      if (!key) continue;
      const indexed = indexes[kind].get(key) ?? [];
      if (!indexed.includes(record)) indexed.push(record);
      indexes[kind].set(key, indexed);
    }
  };
  const unindexRecord = (record: WorkingRecord) => {
    const keys = locationIdentityKeys(record.location);
    for (const kind of Object.keys(indexes) as IdentityKind[]) {
      const key = keys[kind];
      if (!key) continue;
      const remaining = (indexes[kind].get(key) ?? []).filter((entry) => entry !== record);
      if (remaining.length) indexes[kind].set(key, remaining);
      else indexes[kind].delete(key);
    }
  };
  for (const record of records) indexRecord(record);
  let ambiguousRows = 0;

  for (const incoming of incomingCandidates) {
    const incomingKeys = locationIdentityKeys(incoming.location);
    const matchesFor = (kind: keyof ReturnType<typeof locationIdentityKeys>) => {
      const value = incomingKeys[kind];
      return value ? indexes[kind].get(value) ?? [] : [];
    };
    const codeMatches = matchesFor("code");
    const addressMatches = matchesFor("address");
    const entityMatches = matchesFor("entity");
    const exactMatches = matchesFor("exact");
    let ambiguityReason: string | null = null;

    if (codeMatches.length > 1) {
      ambiguityReason = "Possible duplicate: multiple records share this location or agreement code";
    } else if (!codeMatches.length && addressMatches.length > 1) {
      ambiguityReason = "Possible duplicate: multiple records share this normalized address and geography";
    } else if (!codeMatches.length && !addressMatches.length && entityMatches.length > 1) {
      if (exactMatches.length !== 1) {
        ambiguityReason = "Possible duplicate: multiple records share this franchisee/entity and geography";
      }
    } else if (codeMatches.length === 1) {
      const conflictingAddress = addressMatches.filter((record) => record !== codeMatches[0]);
      if (conflictingAddress.length) {
        ambiguityReason = "Identity conflict: location code and normalized address point to different records";
      }
    }

    let match = codeMatches[0] ?? addressMatches[0] ?? exactMatches[0] ?? (
      entityMatches.length === 1 ? entityMatches[0] : undefined
    );
    if (ambiguityReason) {
      ambiguousRows += 1;
      if (exactMatches.length === 1) {
        match = exactMatches[0];
      } else if (exactMatches.length > 1) {
        for (const record of exactMatches) {
          const reviewed = record.location.reviewStatus === "Approved"
            || record.location.reviewStatus === "Rejected";
          if (!reviewed) {
            const flagged = markAmbiguous(record.location, ambiguityReason);
            if (
              record.location.reviewStatus !== flagged.reviewStatus
              || record.location.reviewReason !== flagged.reviewReason
            ) {
              record.location = flagged;
              record.writeChanged = true;
              if (record.existingId) updatedExistingIds.add(record.existingId);
            }
          }
          if (record.existingId) touchedExistingIds.add(record.existingId);
        }
        continue;
      } else {
        const record: WorkingRecord = {
          location: markAmbiguous(incoming.location, ambiguityReason),
          contacts: incoming.contacts,
          contactsChanged: incoming.contacts.length > 0,
          writeChanged: true,
        };
        records.push(record);
        indexRecord(record);
        continue;
      }
    }

    if (!match) {
      const record: WorkingRecord = {
        location: ambiguityReason ? markAmbiguous(incoming.location, ambiguityReason) : incoming.location,
        contacts: incoming.contacts,
        contactsChanged: incoming.contacts.length > 0,
        writeChanged: true,
      };
      records.push(record);
      indexRecord(record);
      if (ambiguityReason) ambiguousRows += 1;
      continue;
    }

    const before = match.location;
    const preserveReviewedValues = before.reviewStatus === "Approved"
      || before.reviewStatus === "Rejected";
    const mergedBusiness = mergeBusinessFields(before, incoming.location, preserveReviewedValues);
    const mergedContacts = mergeContactLists(match.contacts, incoming.contacts);
    let sourceLocation: Candidate = {
      ...mergedBusiness.merged,
      documentId: incoming.location.documentId,
      franchiseName: incoming.location.franchiseName,
      franchisor: incoming.location.franchisor,
      sourcePage: incoming.location.sourcePage,
      printedPage: incoming.location.printedPage,
      sourceExhibit: incoming.location.sourceExhibit,
      sourceSection: incoming.location.sourceSection,
      rawSourceText: incoming.location.rawSourceText,
      confidence: preserveReviewedValues
        ? before.confidence
        : incoming.location.confidence,
      reviewStatus: preserveReviewedValues
        ? before.reviewStatus
        : incoming.location.reviewStatus,
      reviewReason: preserveReviewedValues
        ? before.reviewReason
        : incoming.location.reviewReason,
    };
    if (ambiguityReason && !preserveReviewedValues) {
      sourceLocation = markAmbiguous(sourceLocation, ambiguityReason);
    }
    const writeChanged = Object.entries(sourceLocation).some(
      ([key, value]) => before[key as keyof Candidate] !== value,
    );
    unindexRecord(match);
    match.location = sourceLocation;
    match.contacts = mergedContacts.contacts;
    match.contactsChanged ||= mergedContacts.changed;
    match.writeChanged ||= writeChanged || mergedContacts.changed;
    indexRecord(match);
    if (match.existingId) {
      touchedExistingIds.add(match.existingId);
      if (mergedBusiness.changed || mergedContacts.changed) {
        updatedExistingIds.add(match.existingId);
      }
    }
  }

  const incomingDocumentId = incomingCandidates[0]?.location.documentId;
  const deleteLocationIds = incomingDocumentId
    ? existingLocations
        .filter((location) =>
          location.documentId === incomingDocumentId
          && !touchedExistingIds.has(location.id),
        )
        .map((location) => location.id)
    : [];
  const finalRecords = records.filter((record) =>
    !record.existingId
    || touchedExistingIds.has(record.existingId),
  );
  return {
    records: finalRecords,
    deleteLocationIds,
    addedRows: finalRecords.filter((record) => !record.existingId).length,
    matchedRows: touchedExistingIds.size,
    updatedRows: updatedExistingIds.size,
    unchangedRows: touchedExistingIds.size - updatedExistingIds.size,
    ambiguousRows,
    collapsedRows: 0,
    removedRows: deleteLocationIds.length,
  };
}

function pagesForSection(section: FranchiseeSection, pageCount: number) {
  if (!section.pdfPageStart) return [];
  const end = Math.min(section.pdfPageEnd ?? section.pdfPageStart, pageCount);
  return Array.from(
    { length: Math.max(0, end - section.pdfPageStart + 1) },
    (_, index) => section.pdfPageStart! + index,
  );
}

function printedPageForPdfPage(
  pageNumber: number,
  section: FranchiseeSection,
  printedPageToPdfPage: Map<number, number>,
) {
  for (const [printed, pdf] of printedPageToPdfPage) {
    if (pdf === pageNumber) return printed;
  }
  if (section.printedPageStart && section.pdfPageStart) {
    return section.printedPageStart + (pageNumber - section.pdfPageStart);
  }
  return null;
}

function looksLikePersonName(value: string | null | undefined) {
  if (!value) return false;
  if (/^\s*\d+\s+[A-Za-z]/.test(value)) return false;
  const cleaned = value.replace(/^\d+[.)]?\s*/, "").replace(/\*+$/, "").trim();
  if (
    !cleaned
    || /\d|@|(?:LLC|L\.L\.C|INC|CORP|COMPANY|CO\.|LTD|LP|LLP|HOLDINGS|ENTERPRISES|VENTURES|FITNESS|STUDIO)\b/i.test(cleaned)
  ) return false;
  const words = cleaned.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 5 && words.every((word) => /^[A-Za-z.'’-]+$/.test(word));
}

function contactFromCandidate(candidate: FranchisorCandidate): Contact[] {
  const rawName = looksLikePersonName(candidate.franchiseeEntity)
    ? candidate.franchiseeEntity!.replace(/^\d+[.)]?\s*/, "").replace(/\*+$/, "").trim()
    : candidate.rawSourceText
      .split("|")
      .map((part) => part.trim())
      .find((part) => looksLikePersonName(part)) ?? null;
  if (!rawName && !candidate.phone && !candidate.email) return [];

  let firstName: string | null = null;
  let middleName: string | null = null;
  let lastName: string | null = null;
  let suffix: string | null = null;
  if (rawName) {
    const suffixMatch = rawName.match(/\b(Jr\.?|Sr\.?|II|III|IV)\s*$/i);
    suffix = suffixMatch?.[1] ?? null;
    const withoutSuffix = suffixMatch ? rawName.slice(0, suffixMatch.index).trim() : rawName;
    if (withoutSuffix.includes(",")) {
      const [last, given = ""] = withoutSuffix.split(",", 2).map((part) => part.trim());
      const givenParts = given.split(/\s+/).filter(Boolean);
      firstName = givenParts.shift() ?? null;
      middleName = givenParts.join(" ") || null;
      lastName = last || null;
    } else {
      const parts = withoutSuffix.split(/\s+/).filter(Boolean);
      firstName = parts.shift() ?? null;
      lastName = parts.pop() ?? null;
      middleName = parts.join(" ") || null;
    }
  }
  return [{
    rawName,
    firstName,
    middleName,
    lastName,
    suffix,
    title: null,
    phone: candidate.phone,
    email: candidate.email,
  }];
}

function normalizeCandidate(candidate: FranchisorCandidate): ExtractedCandidate {
  const {
    sourcePrintedPage,
    ...location
  } = candidate;
  return {
    location: {
      ...location,
      printedPage: sourcePrintedPage ? String(sourcePrintedPage) : null,
      sourceExhibit: candidate.sourceExhibit ?? null,
      sourceSection: candidate.sourceSection ?? null,
    },
    contacts: contactFromCandidate(candidate),
  };
}

export async function processFddDocument(
  documentId: string,
  objectPath: string,
  dependencies: ProcessorDependencies = {},
) {
  const processorDb = dependencies.db ?? (await import("@workspace/db")).db;
  const getProcessorObjectFile = dependencies.getObjectFile ?? getObjectFile;
  const [documentRow] = await processorDb
    .select()
    .from(fddDocumentsTable)
    .where(eq(fddDocumentsTable.id, documentId))
    .limit(1);
  if (!documentRow) return;

  let extractionStageId: number | undefined;
  let closeOcrSession: (() => Promise<void>) | undefined;
  try {
    const [stage] = await processorDb
      .insert(processingStagesTable)
      .values({ documentId, stage: "Text and table extraction", status: "Running" })
      .returning();
    extractionStageId = stage?.id;
    const [previousCountRow] = await processorDb
      .select({ value: count() })
      .from(franchiseLocationsTable)
      .where(eq(franchiseLocationsTable.documentId, documentId));
    const previousLocationCount = Number(previousCountRow?.value ?? 0);
    if (!(globalThis as any).DOMMatrix) {
      (globalThis as any).DOMMatrix = class DOMMatrix {
        constructor(_values?: unknown) {}
      };
    }
    const { getDocument, OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const [buffer] = await getProcessorObjectFile(objectPath).download();
    const pdfData = new Uint8Array(buffer);
    const pdf = await getDocument({ data: pdfData.slice() }).promise;
    const pdfPages = new Map<number, {
      text: string;
      rows: string[][];
      columns: string[][];
      ocr: boolean;
      ocrConfidence: number | null;
    }>();
    const textPages: PdfTextPage[] = [];
    const ocrPages: number[] = [];
    const incompleteOcrPages: number[] = [];
    const ocrConfidences: number[] = [];
    const ocrWarnings: string[] = [];
    let ocrAttempts = 0;
    let ocrIncomplete = false;
    const ocrStartedAt = Date.now();
    let ocrSession: Awaited<ReturnType<typeof createPdfOcrSession>> | undefined;
    const runOcrPage = dependencies.ocrPage ?? (async (data: Uint8Array, pageNumber: number) => {
      ocrSession ??= await createPdfOcrSession(data);
      closeOcrSession = ocrSession.close;
      return ocrSession.run(pageNumber);
    });
    let detectedFranchisor = franchisorFromFilename(documentRow.filename);
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      const nativeRows = rowsFromItems(content.items as any[]);
      const nativeText = nativeRows.map((row) => row.join(" ")).join("\n");
      const nativeCharacters = nativeText.replace(/\s/g, "").length;
      let rows = nativeRows;
      let text = nativeText;
      let columns = columnLinesFromItems(content.items as any[], viewport.width);
      let ocr = false;
      let ocrConfidence: number | null = null;
      let hasRasterImage = false;
      if (nativeCharacters < OCR_HYBRID_PAGE_CHARACTERS) {
        const operatorList = await page.getOperatorList();
        hasRasterImage = operatorList.fnArray.some((operation) =>
          operation === OPS.paintImageXObject
          || operation === OPS.paintInlineImageXObject
          || operation === OPS.paintImageMaskXObject
          || operation === OPS.paintSolidColorImageMask,
        );
      }
      const needsOcr = nativeCharacters < OCR_MIN_PAGE_CHARACTERS
        || (hasRasterImage && nativeCharacters < OCR_HYBRID_PAGE_CHARACTERS);
      if (needsOcr) {
        if (
          ocrAttempts >= OCR_MAX_PAGES
          || Date.now() - ocrStartedAt >= OCR_MAX_DOCUMENT_MILLISECONDS
        ) {
          ocrIncomplete = true;
          incompleteOcrPages.push(pageNumber);
          if (!ocrWarnings.some((warning) => /OCR work budget/i.test(warning))) {
            ocrWarnings.push(`OCR work budget was exhausted after ${ocrAttempts} pages`);
          }
        } else {
          ocrAttempts += 1;
        try {
          const result = await runOcrPage(pdfData, pageNumber);
          if (result.text.replace(/\s/g, "").length > 0) {
            const scaleX = result.imageWidth ? result.imageWidth / viewport.width : 1;
            const scaleY = result.imageHeight ? result.imageHeight / viewport.height : 1;
            const ocrItems = (result.items ?? []).map((word) => ({
                str: word.text,
                transform: [1, 0, 0, 1, word.left / scaleX, viewport.height - word.top / scaleY],
                width: word.width / scaleX,
              }));
            const ocrRows = ocrItems.length
              ? rowsFromItems(ocrItems)
              : result.text.split(/\r?\n/).map((line) => line.split(/\s*\|\s*/).filter(Boolean));
            const ocrColumns = ocrItems.length
              ? columnLinesFromItems(ocrItems, viewport.width)
              : [[], []];
            rows = [...nativeRows, ...ocrRows];
            text = [nativeText, result.text].filter(Boolean).join("\n");
            columns = columns.map((lines, index) => [...lines, ...(ocrColumns[index] ?? [])]);
            ocr = true;
            ocrConfidence = result.confidence;
            ocrPages.push(pageNumber);
            if (result.confidence !== null) ocrConfidences.push(result.confidence);
          } else {
            ocrIncomplete = true;
            incompleteOcrPages.push(pageNumber);
            ocrWarnings.push(`OCR returned no searchable text on page ${pageNumber}`);
          }
        } catch (error) {
          ocrIncomplete = true;
          incompleteOcrPages.push(pageNumber);
          ocrWarnings.push(`OCR failed on page ${pageNumber}: ${error instanceof Error ? error.message : "unknown OCR error"}`);
        }
        }
      }
      pdfPages.set(pageNumber, { text, rows, columns, ocr, ocrConfidence });
      textPages.push({ pdfPage: pageNumber, text, ocr, ocrConfidence });
      if (pageNumber <= 5) detectedFranchisor = detectFranchisor(text, detectedFranchisor);
    }

    const averageOcrConfidence = ocrConfidences.length
      ? ocrConfidences.reduce((sum, value) => sum + value, 0) / ocrConfidences.length
      : null;
    const textCharacters = textPages.reduce(
      (sum, page) => sum + page.text.replace(/\s/g, "").length,
      0,
    );
    if (textCharacters < Math.min(500, pdf.numPages * 20)) {
      throw new Error("The PDF has too little searchable text after OCR; existing location data was preserved");
    }
    const discovery = discoverFranchiseeSources(textPages);
    if (!discovery.sections.length) {
      throw new Error("No validated Item 20 franchisee list or franchisee exhibit was found; existing location data was preserved");
    }

    const candidates: ExtractedCandidate[] = [];
    const warnings = [...ocrWarnings];
    if (ocrPages.length) {
      warnings.push(`OCR used on ${ocrPages.length} page${ocrPages.length === 1 ? "" : "s"}`);
      if (averageOcrConfidence !== null) {
        warnings.push(`Average OCR confidence was ${Math.round(averageOcrConfidence * 100)}%; extracted rows require review`);
        if (averageOcrConfidence < 0.72) warnings.push("OCR quality is low; verify extracted rows against the source document");
      } else {
        warnings.push("OCR returned no confidence scores; extracted rows require review");
      }
    }
    const seen = new Set<string>();
    const candidateKey = (candidate: Candidate) => [
      candidate.status,
      candidate.address?.toLowerCase(),
      candidate.city?.toLowerCase(),
      candidate.state,
      candidate.zip,
      /Location code:/i.test(candidate.rawSourceText ?? "")
        ? candidate.rawSourceText?.match(/Location code:\s*([A-Z]{2}\d{4})/i)?.[1]
        : "",
      !candidate.address || /not disclosed/i.test(candidate.address)
        ? candidate.franchiseeEntity?.toLowerCase()
        : "",
    ].join(":");
    let rejectedRows = 0;
    let duplicateRows = 0;
    const pagesExamined: number[] = [];

    const acceptCandidate = (rawCandidate: FranchisorCandidate) => {
      const candidate = sanitizeCandidate(rawCandidate);
      const quality = scoreCandidate(candidate);
      const pageData = pdfPages.get(candidate.sourcePage);
      candidate.confidence = quality.confidence;
      if (quality.issues.length) {
        candidate.reviewStatus = "Needs review";
        candidate.reviewReason = quality.issues.join("; ");
      } else if (!pageData?.ocr && quality.confidence >= 0.85) {
        candidate.reviewStatus = "Auto-verified";
        candidate.reviewReason = "Complete row extracted from a verified text-based franchisee section";
      } else {
        candidate.reviewStatus = "Needs review";
        candidate.reviewReason = "Complete row requires review because OCR was used";
      }
      if (pageData?.ocr) {
        const confidenceMultiplier = pageData.ocrConfidence ?? 0.5;
        candidate.confidence = Number(
          Math.max(0.05, Math.min(1, candidate.confidence * confidenceMultiplier)).toFixed(3),
        );
        candidate.reviewStatus = "Needs review";
        candidate.reviewReason = `${candidate.reviewReason}; OCR confidence ${pageData.ocrConfidence === null ? "unavailable" : `${Math.round(pageData.ocrConfidence * 100)}%`}`;
      }
      const normalized = normalizeCandidate(candidate);
      const key = candidateKey(normalized.location);
      if (seen.has(key)) {
        duplicateRows += 1;
        return;
      }
      seen.add(key);
      candidates.push(normalized);
    };

    for (const section of discovery.sections) {
      const sectionPages = pagesForSection(section, pdf.numPages);
      pagesExamined.push(...sectionPages);
      const sectionColumns: string[][] = [[], []];
      for (const pageNumber of sectionPages) {
        const pageData = pdfPages.get(pageNumber);
        if (!pageData) continue;
        const printedPage = printedPageForPdfPage(
          pageNumber,
          section,
          discovery.printedPageToPdfPage,
        );
        const source = {
          exhibit: section.exhibit,
          section: section.heading,
          printedPage,
        };
        let pageStatus = section.status;
        for (const cells of pageData.rows) {
          pageStatus = statusFromHeading(cells.join(" "), pageStatus);
          const candidate = candidateFromCells(
            cells,
            documentId,
            detectedFranchisor,
            pageNumber,
            pageStatus,
            source,
          );
          if (candidate) acceptCandidate(candidate);
          else if (/\b(?:[A-Z]{2}|Alabama|Alaska|Arizona|California|Florida|Georgia|Illinois|New York|North Carolina|Ohio|Pennsylvania|Texas|Virginia|Washington)\s+\d{5}(?:-\d{4})?\b/i.test(cells.join(" "))) {
            rejectedRows += 1;
          }
        }
        for (const [columnIndex, lines] of pageData.columns.entries()) {
          sectionColumns[columnIndex].push(
            `[[PAGE:${pageNumber}]]`,
            `[[STATUS:${pageStatus}]]`,
            section.heading,
            ...lines,
          );
        }
      }
      const source = {
        exhibit: section.exhibit,
        section: section.heading,
        printedPage: section.printedPageStart,
      };
      const territoryCandidates = sectionColumns.flatMap((lines) =>
        candidatesFromTerritoryDirectoryLines(
          lines,
          documentId,
          detectedFranchisor,
          section.pdfPageStart ?? 1,
          source,
        ),
      );
      const addressCandidates = sectionColumns.flatMap((lines) =>
        candidatesFromAddressBlockLines(
          lines,
          documentId,
          detectedFranchisor,
          section.pdfPageStart ?? 1,
          source,
        ),
      );
      const multilineCandidates = territoryCandidates.length
        ? territoryCandidates
        : sectionColumns.flatMap((lines) => [
          ...candidatesFromUnitBlockLines(
            lines,
            documentId,
            detectedFranchisor,
            section.pdfPageStart ?? 1,
            source,
          ),
          ...addressCandidates,
        ]);
      for (const candidate of multilineCandidates) {
        candidate.sourcePrintedPage = printedPageForPdfPage(
          candidate.sourcePage,
          section,
          discovery.printedPageToPdfPage,
        );
        acceptCandidate(candidate);
      }
    }

    const lowQualityOcrSourcePages = uniqueNumbers(
      pagesExamined.filter((pageNumber) => {
        const pageData = pdfPages.get(pageNumber);
        return pageData?.ocr
          && (pageData.ocrConfidence === null || pageData.ocrConfidence < OCR_REPLACEMENT_CONFIDENCE);
      }),
    );
    const incompleteOcrSourcePages = uniqueNumbers(
      pagesExamined.filter((pageNumber) => incompleteOcrPages.includes(pageNumber)),
    );
    if (previousLocationCount > 0 && incompleteOcrSourcePages.length > 0) {
      throw new Error(
        `OCR did not complete on source page${incompleteOcrSourcePages.length === 1 ? "" : "s"} ${incompleteOcrSourcePages.join(", ")}; existing location data was preserved`,
      );
    }
    if (previousLocationCount > 0 && lowQualityOcrSourcePages.length > 0) {
      throw new Error(
        `OCR quality was too low on source page${lowQualityOcrSourcePages.length === 1 ? "" : "s"} ${lowQualityOcrSourcePages.join(", ")} to replace the previously stored location data; existing location data was preserved`,
      );
    }

    if (!candidates.length) {
      throw new Error("The franchisee section was found, but no valid location rows were extracted; existing location data was preserved");
    }

    const missingAddressRows = candidates.filter(({ location }) =>
      !location.address || /not (?:listed|disclosed)/i.test(location.address),
    ).length;
    const missingContactRows = candidates.filter(({ location, contacts }) =>
      !location.franchiseeEntity && contacts.length === 0,
    ).length;
    if (rejectedRows) warnings.push(`${rejectedRows} address-like rows could not be normalized`);
    if (missingAddressRows) warnings.push(`${missingAddressRows} locations do not include a disclosed street address`);
    if (missingContactRows) warnings.push(`${missingContactRows} locations do not include a franchisee or contact`);
    const evaluatedRows = candidates.length + rejectedRows;
    const rejectedRatio = evaluatedRows ? rejectedRows / evaluatedRows : 1;
    const complete = missingAddressRows / candidates.length < 0.25
      && missingContactRows / candidates.length < 0.25
      && rejectedRatio <= 0.4;
    if (!complete) warnings.push("Extraction coverage is below the automatic-approval threshold");
    const historicFloor = previousLocationCount >= 20
      ? Math.floor(previousLocationCount * 0.55)
      : 0;
    const highRejectionFloor = previousLocationCount >= 20
      ? historicFloor
      : previousLocationCount
        ? Math.ceil(previousLocationCount * 0.8)
        : 0;
    if (
      rejectedRatio > 0.4
      && (!highRejectionFloor || candidates.length < highRejectionFloor)
    ) {
      throw new Error(
        `Extraction rejected ${Math.round(rejectedRatio * 100)}% of candidate rows (${rejectedRows} rejected, ${candidates.length} accepted); existing location data was preserved`,
      );
    }
    if (historicFloor && candidates.length < historicFloor) {
      throw new Error(`Extraction produced ${candidates.length} rows versus ${previousLocationCount} previously stored rows; existing location data was preserved`);
    }
    const discoveryMethod = discovery.tocEntries.some((entry) => entry.listKind)
      ? "toc"
      : "heading-scan";
    const manifest: FddExtractionManifest = {
      discoveryMethod,
      sourceRanges: discovery.sections.map((section) => ({
        section: section.heading,
        status: section.status,
        exhibit: section.exhibit,
        printedStart: section.printedPageStart ? String(section.printedPageStart) : null,
        pdfStart: section.pdfPageStart ?? 1,
        pdfEnd: section.pdfPageEnd ?? section.pdfPageStart ?? 1,
      })),
      pagesExamined: uniqueNumbers(pagesExamined),
      ocrPages: uniqueNumbers(ocrPages),
      ocrConfidence: ocrConfidences.length
        ? Number((ocrConfidences.reduce((sum, value) => sum + value, 0) / ocrConfidences.length).toFixed(3))
        : null,
      acceptedRows: candidates.length,
      rejectedRows,
      duplicateRows,
      missingAddressRows,
      missingContactRows,
      warnings,
      complete,
    };

    const committed = await processorDb.transaction(async (transaction) => {
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${normalizeIdentityText(detectedFranchisor)}))`,
      );
      const brandDocuments = await transaction
        .select()
        .from(fddDocumentsTable)
        .where(ilike(fddDocumentsTable.franchiseName, detectedFranchisor));
      const currentDocument = brandDocuments.find((document) => document.id === documentId);
      if (currentDocument?.objectPath && currentDocument.objectPath !== objectPath) {
        await transaction
          .update(processingStagesTable)
          .set({
            status: "Skipped",
            message: "A newer replacement of this document is already processing",
            finishedAt: new Date(),
          })
          .where(eq(processingStagesTable.id, stage.id));
        return false;
      }
      const newerVerifiedDocument = brandDocuments.find((document) =>
        document.id !== documentId
        && document.lastProcessedAt
        && ["Ready", "Needs review"].includes(document.processingStatus)
        && document.uploadDate > (currentDocument?.uploadDate ?? documentRow.uploadDate),
      );
      if (newerVerifiedDocument) {
        await transaction
          .update(processingStagesTable)
          .set({
            status: "Skipped",
            message: `A newer verified FDD (${newerVerifiedDocument.filename}) already supplies this franchisor's evidence`,
            finishedAt: new Date(),
          })
          .where(eq(processingStagesTable.id, stage.id));
        await transaction
          .update(fddDocumentsTable)
          .set({ processingStatus: "Superseded" })
          .where(eq(fddDocumentsTable.id, documentId));
        return false;
      }
      const existingLocations = await transaction
        .select()
        .from(franchiseLocationsTable)
        .where(ilike(franchiseLocationsTable.franchisor, detectedFranchisor));
      const existingLocationIds = existingLocations.map((location) => location.id);
      const existingContacts = existingLocationIds.length
        ? await transaction
            .select()
            .from(contactsTable)
            .where(inArray(contactsTable.locationId, existingLocationIds))
        : [];
      const reconciliation = reconcileFranchiseCandidates(
        candidates,
        existingLocations,
        existingContacts,
      );
      Object.assign(manifest, {
        addedRows: reconciliation.addedRows,
        matchedRows: reconciliation.matchedRows,
        updatedRows: reconciliation.updatedRows,
        unchangedRows: reconciliation.unchangedRows,
        ambiguousRows: reconciliation.ambiguousRows,
        collapsedRows: reconciliation.collapsedRows,
        removedRows: reconciliation.removedRows,
      });
      if (reconciliation.ambiguousRows) {
        warnings.push(`${reconciliation.ambiguousRows} possible duplicate matches require review`);
      }
      if (reconciliation.collapsedRows) {
        warnings.push(`${reconciliation.collapsedRows} existing duplicate records were safely consolidated`);
      }
      if (reconciliation.removedRows) {
        warnings.push(`${reconciliation.removedRows} stale rows from the replaced extraction were removed`);
      }

      if (reconciliation.deleteLocationIds.length) {
        await transaction
          .delete(franchiseLocationsTable)
          .where(inArray(franchiseLocationsTable.id, reconciliation.deleteLocationIds));
      }
      const existingRecords = reconciliation.records.filter(
        (record): record is WorkingRecord & { existingId: string } =>
          Boolean(record.existingId) && record.writeChanged,
      );
      for (const record of existingRecords) {
        await transaction
          .update(franchiseLocationsTable)
          .set(record.location)
          .where(eq(franchiseLocationsTable.id, record.existingId));
        if (record.contactsChanged || reconciliation.deleteLocationIds.length) {
          await transaction
            .delete(contactsTable)
            .where(eq(contactsTable.locationId, record.existingId));
          if (record.contacts.length) {
            await transaction
              .insert(contactsTable)
              .values(record.contacts.map((contact) => ({
                ...contact,
                locationId: record.existingId,
              })));
          }
        }
      }
      const newRecords = reconciliation.records.filter((record) => !record.existingId);
      for (let start = 0; start < newRecords.length; start += 250) {
        const chunk = newRecords.slice(start, start + 250);
        const inserted = await transaction
          .insert(franchiseLocationsTable)
          .values(chunk.map(({ location }) => location))
          .returning({ id: franchiseLocationsTable.id });
        const contacts = inserted.flatMap((location, index) =>
          chunk[index].contacts.map((contact) => ({ ...contact, locationId: location.id })),
        );
        if (contacts.length) await transaction.insert(contactsTable).values(contacts);
      }
      await transaction
        .update(processingStagesTable)
        .set({
          status: "Complete",
          message: [
            `${candidates.length} locations normalized from ${manifest.pagesExamined.length} verified source pages`,
            `${reconciliation.addedRows} added, ${reconciliation.updatedRows} updated, ${reconciliation.unchangedRows} unchanged`,
            `${duplicateRows + reconciliation.collapsedRows} duplicates removed`,
            warnings.length ? warnings.join("; ") : "coverage checks passed",
          ].join(". "),
          finishedAt: new Date(),
        })
        .where(eq(processingStagesTable.id, stage.id));
      await transaction
        .update(fddDocumentsTable)
        .set({
          franchiseName: detectedFranchisor,
          processingStatus: complete ? "Ready" : "Needs review",
          pageCount: pdf.numPages,
          sourceExhibit: [...new Set(discovery.sections.map((section) => section.exhibit).filter(Boolean))].join(", ") || null,
          extractionManifest: manifest,
          lastProcessedAt: new Date(),
        })
        .where(eq(fddDocumentsTable.id, documentId));
      const olderDocumentIds = brandDocuments
        .filter((document) =>
          document.id !== documentId
          && document.uploadDate <= (currentDocument?.uploadDate ?? documentRow.uploadDate),
        )
        .map((document) => document.id);
      if (olderDocumentIds.length) {
        await transaction
          .update(fddDocumentsTable)
          .set({ processingStatus: "Superseded" })
          .where(inArray(fddDocumentsTable.id, olderDocumentIds));
      }
      return true;
    });
    if (!committed) return;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown processing error";
    if (extractionStageId !== undefined) {
      await processorDb
        .update(processingStagesTable)
        .set({
          status: "Failed",
          message,
          finishedAt: new Date(),
        })
        .where(eq(processingStagesTable.id, extractionStageId));
    } else {
      await processorDb.insert(processingStagesTable).values({
        documentId,
        stage: "Processing error",
        status: "Failed",
        message,
        finishedAt: new Date(),
      });
    }
    await processorDb
      .update(fddDocumentsTable)
      .set({ processingStatus: "Failed" })
      .where(eq(fddDocumentsTable.id, documentId));
  } finally {
    await closeOcrSession?.();
  }
}

export function parseTesseractTsv(tsv: string): OcrPageResult {
  const words: OcrWord[] = [];
  const lines = new Map<string, OcrWord[]>();
  let imageWidth: number | undefined;
  let imageHeight: number | undefined;
  for (const rawLine of tsv.split(/\r?\n/).slice(1)) {
    const fields = rawLine.split("\t");
    if (fields.length < 12) continue;
    const [, page, block, paragraph, lineNumber, , left, top, width, height, confidence, ...textParts] = fields;
    if (fields[0] === "1") {
      imageWidth = Number(width);
      imageHeight = Number(height);
    }
    const text = textParts.join("\t").trim();
    const parsedConfidence = Number(confidence);
    if (!text || !Number.isFinite(parsedConfidence) || parsedConfidence < 0) continue;
    const word: OcrWord = {
      text,
      left: Number(left),
      top: Number(top),
      width: Number(width),
      height: Number(height),
      confidence: parsedConfidence,
    };
    if (![word.left, word.top, word.width, word.height].every(Number.isFinite)) continue;
    words.push(word);
    const lineKey = [page, block, paragraph, lineNumber].join(":");
    const line = lines.get(lineKey) ?? [];
    line.push(word);
    lines.set(lineKey, line);
  }

  const confidenceValues = words.map((word) => word.confidence);
  const confidence = confidenceValues.length
    ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length / 100
    : null;
  const text = [...lines.values()]
    .map((line) => line.sort((a, b) => a.left - b.left).map((word) => word.text).join(" "))
    .join("\n");
  return { text, confidence, items: words, imageWidth, imageHeight };
}

const OCR_MAX_PAGES = 400;

async function createPdfOcrSession(pdfData: Uint8Array) {
  const workingDirectory = await mkdtemp(path.join(tmpdir(), "fdd-ocr-"));
  const pdfPath = path.join(workingDirectory, "document.pdf");
  const imagePrefix = path.join(workingDirectory, "page");
  const imagePath = `${imagePrefix}.png`;
  await writeFile(pdfPath, pdfData);
  return {
    run: async (pageNumber: number): Promise<OcrPageResult> => {
      await execFileAsync("pdftoppm", [
        "-f", String(pageNumber),
        "-l", String(pageNumber),
        "-png",
        "-scale-to", String(OCR_MAX_RASTER_DIMENSION),
        "-singlefile",
        pdfPath,
        imagePrefix,
      ], {
        maxBuffer: 10 * 1024 * 1024,
        timeout: OCR_RENDER_TIMEOUT_MILLISECONDS,
        killSignal: "SIGKILL",
      });
      const raster = await stat(imagePath);
      if (raster.size > OCR_MAX_RASTER_BYTES) {
        throw new Error(`Rendered OCR page exceeded the ${OCR_MAX_RASTER_BYTES / 1024 / 1024} MB safety limit`);
      }
      const { stdout } = await execFileAsync(
        "tesseract",
        [imagePath, "stdout", "--psm", "3", "-l", "eng", "tsv"],
        {
          encoding: "utf8",
          maxBuffer: 20 * 1024 * 1024,
          timeout: OCR_PAGE_TIMEOUT_MILLISECONDS,
          killSignal: "SIGKILL",
        },
      );
      return parseTesseractTsv(stdout);
    },
    close: () => rm(workingDirectory, { recursive: true, force: true }),
  };
}

const OCR_MAX_DOCUMENT_MILLISECONDS = 10 * 60 * 1000;

const OCR_REPLACEMENT_CONFIDENCE = 0.6;

const OCR_MAX_RASTER_DIMENSION = 3000;

const execFileAsync = promisify(execFile);

const OCR_HYBRID_PAGE_CHARACTERS = 400;

const OCR_MAX_RASTER_BYTES = 50 * 1024 * 1024;

const OCR_RENDER_TIMEOUT_MILLISECONDS = 30_000;

type OcrPageResult = {
  text: string;
  confidence: number | null;
  items?: OcrWord[];
  imageWidth?: number;
  imageHeight?: number;
};

const OCR_PAGE_TIMEOUT_MILLISECONDS = 60_000;

const OCR_MIN_PAGE_CHARACTERS = 80;
