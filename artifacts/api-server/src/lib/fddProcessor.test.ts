import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import * as databaseSchema from "@workspace/db/schema";
import {
  contactsTable,
  fddDocumentsTable,
  franchiseLocationsTable,
  processingStagesTable,
} from "@workspace/db/schema";
import {
  parseTesseractTsv,
  processFddDocument,
  reconcileFranchiseCandidates,
  locationIdentityKeys,
  sanitizeCandidate,
  scoreCandidate,
  type ExtractedCandidate,
} from "./fddProcessor.ts";

type DocumentRow = {
  id: string;
  franchiseName: string;
  filename: string;
  processingStatus: string;
  pageCount: number;
  objectPath?: string | null;
  uploadDate?: Date;
  lastProcessedAt?: Date | null;
  extractionManifest?: {
    discoveryMethod: string;
    ocrPages?: number[];
    ocrConfidence?: number | null;
    warnings: string[];
  };
};

type StageRow = {
  id: number;
  documentId: string;
  stage: string;
  status: string;
  message?: string;
  finishedAt?: Date;
};

type InsertedCandidate = {
  id: string;
  documentId: string;
  franchiseName: string;
  franchisor: string;
  status: string;
  sourcePage: number;
  rawSourceText: string;
  confidence: number;
  reviewStatus: string;
  reviewReason: string;
};

type InsertedContact = {
  locationId: string;
  rawName: string | null;
  email: string | null;
  phone: string | null;
};

type FakeDatabase = {
  documents: DocumentRow[];
  stages: StageRow[];
  candidates: InsertedCandidate[];
  contacts: InsertedContact[];
  failOnContacts?: boolean;
  db: any;
};

function createFakeDatabase(document: DocumentRow): FakeDatabase {
  const state: FakeDatabase = {
    documents: [document],
    stages: [],
    candidates: [],
    contacts: [],
    db: {},
  };
  let nextStageId = 1;

  state.db.select = (selection?: Record<string, unknown>) => ({
    from: (table: unknown) => ({
      where: () => {
        const rows = table === fddDocumentsTable
          ? state.documents
          : table === franchiseLocationsTable
            ? selection?.value
              ? [{ value: state.candidates.length }]
              : state.candidates
            : table === contactsTable
              ? state.contacts
              : [{ value: state.candidates.length }];
        const result = Promise.resolve(rows) as Promise<unknown[]> & { limit: () => Promise<unknown[]> };
        result.limit = async () => rows;
        return result;
      },
    }),
  });
  state.db.insert = (table: unknown) => {
    let insertedRows: Array<Record<string, unknown> & { id?: number | string }> = [];
    const builder: any = {
      values: (values: Record<string, unknown> | Record<string, unknown>[]) => {
        const rows = Array.isArray(values) ? values : [values];
        if (table === processingStagesTable) {
          insertedRows = rows.map((value) => ({
            id: nextStageId++,
            ...value,
          }));
          state.stages.push(...(insertedRows as StageRow[]));
        } else if (table === franchiseLocationsTable) {
          insertedRows = rows.map((value, index) => ({
            id: `location-${state.candidates.length + index + 1}`,
            ...value,
          }));
          state.candidates.push(...(insertedRows as unknown as InsertedCandidate[]));
        } else if (table === contactsTable) {
          if (state.failOnContacts) throw new Error("simulated contact write failure");
          insertedRows = rows;
          state.contacts.push(...(rows as InsertedContact[]));
        }
        return builder;
      },
      returning: async () => insertedRows,
    };
    return builder;
  };
  state.db.update = (table: unknown) => ({
    set: (changes: Partial<DocumentRow> & Partial<StageRow>) => ({
      where: async () => {
        if (table === processingStagesTable) {
          const stage = state.stages.find((entry) => entry.id === 1);
          if (stage) Object.assign(stage, changes);
        } else if (table === fddDocumentsTable) {
          Object.assign(state.documents[0], changes);
        } else if (table === franchiseLocationsTable && state.candidates[0]) {
          Object.assign(state.candidates[0], changes);
        }
        return [];
      },
    }),
  });
  state.db.delete = (table: unknown) => ({
    where: async () => {
      if (table === franchiseLocationsTable) {
        state.candidates = [];
        state.contacts = [];
      } else if (table === contactsTable) {
        state.contacts = [];
      }
      return [];
    },
  });
  state.db.execute = async () => [];
  state.db.transaction = async (callback: (transaction: any) => Promise<unknown>) => {
    const snapshot = {
      documents: structuredClone(state.documents),
      stages: structuredClone(state.stages),
      candidates: structuredClone(state.candidates),
      contacts: structuredClone(state.contacts),
    };
    try {
      return await callback(state.db);
    } catch (error) {
      state.documents = snapshot.documents;
      state.stages = snapshot.stages;
      state.candidates = snapshot.candidates;
      state.contacts = snapshot.contacts;
      throw error;
    }
  };

  return state;
}

function createPdfFixture(lines: string[], withRasterImage = false) {
  const escapePdfText = (line: string) => line.replace(/([\\()])/g, "\\$1");
  const content = [
    ...(withRasterImage ? ["q", "500 0 0 700 50 50 cm", "/Im1 Do", "Q"] : []),
    "BT",
    "/F1 12 Tf",
    ...lines.flatMap((line, index) => {
      const y = 760 - index * 24;
      const cells = line.split(" | ");
      return cells.map(
        (cell, cellIndex) =>
          `1 0 0 1 ${36 + cellIndex * 125} ${y} Tm (${escapePdfText(cell)}) Tj`,
      );
    }),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >>${withRasterImage ? " /XObject << /Im1 6 0 R >>" : ""} >> /Contents 5 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ...(withRasterImage
      ? ["<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\nx\nendstream"]
      : []),
  ];
  const header = "%PDF-1.4\n";
  const bodyParts: string[] = [];
  const offsets = [0];
  let position = header.length;
  for (const [index, object] of objects.entries()) {
    const body = `${index + 1} 0 obj\n${object}\nendobj\n`;
    offsets.push(position);
    bodyParts.push(body);
    position += body.length;
  }
  const xrefPosition = position;
  const xref = [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(xrefPosition),
    "%%EOF",
  ].join("\n");
  return Buffer.from(header + bodyParts.join("") + xref);
}

async function createIsolatedPostgresDatabase() {
  const { pool } = await import("@workspace/db");
  const client = await pool.connect();
  const schemaName = `fdd_test_${randomUUID().replaceAll("-", "")}`;
  await client.query(`CREATE SCHEMA "${schemaName}"`);
  try {
    for (const tableName of [
      "fdd_documents",
      "processing_stages",
      "franchise_locations",
      "contacts",
    ]) {
      await client.query(
        `CREATE TABLE "${schemaName}"."${tableName}" (LIKE public."${tableName}" INCLUDING ALL)`,
      );
    }
    for (const tableName of ["processing_stages"]) {
      const sequenceName = `${tableName}_id_seq`;
      await client.query(`CREATE SEQUENCE "${schemaName}"."${sequenceName}"`);
      await client.query(
        `ALTER TABLE "${schemaName}"."${tableName}" ALTER COLUMN id SET DEFAULT nextval('"${schemaName}"."${sequenceName}"'::regclass)`,
      );
    }
    await client.query(`SET search_path TO "${schemaName}", public`);
  } catch (error) {
    await client.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    client.release();
    throw error;
  }

  return {
    db: drizzle(client, { schema: databaseSchema }),
    close: async () => {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${schemaName}" CASCADE`);
      client.release();
    },
  };
}

function runProcessor(
  document: DocumentRow,
  fixture: Buffer,
  ocrPage?: () => Promise<ReturnType<typeof parseTesseractTsv>>,
) {
  const fake = createFakeDatabase(document);
  return processFddDocument(document.id, `/objects/fixture/${document.id}`, {
    db: fake.db,
    getObjectFile: () => ({
      download: async () => [fixture],
    }),
    ocrPage,
  }).then(() => fake);
}

function runPdfProcessor(document: DocumentRow, lines: string[]) {
  return runProcessor(document, createPdfFixture(lines));
}

function location(overrides: Record<string, unknown> = {}) {
  return {
    id: "existing-location",
    documentId: "old-document",
    franchiseName: "HOTWORX",
    franchisor: "HOTWORX",
    status: "Current",
    franchiseeEntity: "Jane Doe Fitness LLC",
    address: "123 Main Street",
    city: "Austin",
    state: "TX",
    zip: "78701",
    country: "USA",
    phone: null,
    email: null,
    locationCode: "HW-100",
    exitReason: null,
    sourcePage: 10,
    printedPage: "9",
    sourceExhibit: "Exhibit A",
    sourceSection: "Current Franchisees",
    rawSourceText: "Old source",
    confidence: 0.8,
    reviewStatus: "Needs review",
    reviewReason: null,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  } as any;
}

function incoming(overrides: Record<string, unknown> = {}): ExtractedCandidate {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...base } = location({
    documentId: "new-document",
    sourcePage: 20,
    printedPage: "19",
    rawSourceText: "New source",
    confidence: 0.9,
  });
  return {
    location: { ...base, ...overrides } as any,
    contacts: [],
  };
}

test("matches stable location codes and enriches a canonical record from the newest source", () => {
  const result = reconcileFranchiseCandidates(
    [incoming({ locationCode: "hw 100", phone: "(512) 555-0100" })],
    [location()],
    [],
  );

  assert.equal(result.addedRows, 0);
  assert.equal(result.matchedRows, 1);
  assert.equal(result.updatedRows, 1);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].existingId, "existing-location");
  assert.equal(result.records[0].location.phone, "(512) 555-0100");
  assert.equal(result.records[0].location.documentId, "new-document");
  assert.equal(result.records[0].location.sourcePage, 20);
});

test("matches normalized addresses without rewriting equally good values", () => {
  const result = reconcileFranchiseCandidates(
    [incoming({
      locationCode: null,
      address: "123 Main St.",
      confidence: 0.8,
    })],
    [location({ locationCode: null })],
    [],
  );

  assert.equal(result.addedRows, 0);
  assert.equal(result.matchedRows, 1);
  assert.equal(result.updatedRows, 0);
  assert.equal(result.unchangedRows, 1);
  assert.equal(result.records[0].location.address, "123 Main Street");
  assert.equal(result.records[0].location.documentId, "new-document");
});

test("reprocessing replaces stale rows from the same document and refreshes confidence", () => {
  const result = reconcileFranchiseCandidates(
    [incoming({ documentId: "same-document", confidence: 0.42 })],
    [
      location({ id: "matched", documentId: "same-document", confidence: 0.94 }),
      location({ id: "stale", documentId: "same-document", locationCode: "HW-200", address: "9 Old Road" }),
    ],
    [],
  );

  assert.deepEqual(result.deleteLocationIds, ["stale"]);
  assert.equal(result.removedRows, 1);
  assert.equal(result.records[0].location.confidence, 0.42);
});

test("cleans concatenated legal entity and contact data before scoring", () => {
  const raw = incoming({
    franchiseeEntity: "JTI Inc. John & Tasha Mendez 303-589-0985",
    phone: null,
    rawSourceText: "JTI Inc. John & Tasha Mendez 303-589-0985 | 123 Main Street | Denver, CO 80202",
    sourceSection: "Current Franchisees",
  }).location as any;
  const cleaned = sanitizeCandidate(raw);
  const scored = scoreCandidate(cleaned);

  assert.equal(cleaned.franchiseeEntity, "JTI Inc");
  assert.equal(cleaned.phone, "303-589-0985");
  assert.equal(scored.confidence, 0.95);
});

test("missing addresses cannot receive high confidence", () => {
  const raw = incoming({
    address: "Address not disclosed",
    zip: "",
    phone: "303-589-0985",
    sourceSection: "Former Franchisees",
  }).location as any;
  assert.ok(scoreCandidate(raw).confidence <= 0.58);
});

test("keeps ambiguous entity-and-geography matches separate and flags the new row", () => {
  const result = reconcileFranchiseCandidates(
    [incoming({ locationCode: null, address: null })],
    [
      location({ id: "first", locationCode: null, address: "1 First Street" }),
      location({ id: "second", locationCode: null, address: "2 Second Street" }),
    ],
    [],
  );

  assert.equal(result.addedRows, 1);
  assert.equal(result.matchedRows, 0);
  assert.equal(result.ambiguousRows, 1);
  assert.equal(result.records[0].location.reviewStatus, "Needs review");
  assert.match(result.records[0].location.reviewReason ?? "", /Possible duplicate/);
});

test("uses exact source evidence to make territory-only reuploads idempotent", () => {
  const first = location({
    id: "first",
    locationCode: null,
    address: null,
    rawSourceText: "Jane Doe Fitness LLC | Austin | TX | Territory A",
  });
  const second = location({
    id: "second",
    locationCode: null,
    address: null,
    rawSourceText: "Jane Doe Fitness LLC | Austin | TX | Territory B",
  });
  const candidate = incoming({
    locationCode: null,
    address: null,
    rawSourceText: first.rawSourceText,
  });
  const result = reconcileFranchiseCandidates([candidate], [first, second], []);

  assert.equal(result.addedRows, 0);
  assert.equal(result.matchedRows, 1);
  assert.equal(result.ambiguousRows, 0);
  assert.equal(result.records[0].existingId, "first");
});

test("merges matching contacts without duplicating email, phone, or name identities", () => {
  const candidate = incoming();
  candidate.contacts = [{
    rawName: "Jane Doe",
    firstName: "Jane",
    middleName: null,
    lastName: "Doe",
    suffix: null,
    title: null,
    email: "JANE@EXAMPLE.COM",
    phone: "512-555-0100",
  }];
  const result = reconcileFranchiseCandidates(
    [candidate],
    [location()],
    [{
      id: "contact-1",
      locationId: "existing-location",
      rawName: "Jane Doe",
      firstName: "Jane",
      middleName: null,
      lastName: "Doe",
      suffix: null,
      title: null,
      email: "jane@example.com",
      phone: null,
    } as any],
  );

  assert.equal(result.records[0].contacts.length, 1);
  assert.equal(result.records[0].contacts[0].phone, "512-555-0100");
  assert.equal(result.updatedRows, 1);
});

test("does not destructively collapse pre-existing rows that share an exact stable location code", () => {
  const result = reconcileFranchiseCandidates(
    [incoming()],
    [
      location({ id: "sparse", address: null, confidence: 0.7 }),
      location({ id: "complete", confidence: 0.95 }),
    ],
    [],
  );

  assert.equal(result.addedRows, 1);
  assert.equal(result.matchedRows, 0);
  assert.equal(result.ambiguousRows, 1);
  assert.equal(result.collapsedRows, 0);
  assert.deepEqual(result.deleteLocationIds, []);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].location.reviewStatus, "Needs review");
});

test("does not merge a location-code match when its address points to another record", () => {
  const result = reconcileFranchiseCandidates(
    [incoming()],
    [
      location({ id: "code-match", address: "999 Other Road" }),
      location({ id: "address-match", locationCode: "HW-999" }),
    ],
    [],
  );

  assert.equal(result.addedRows, 1);
  assert.equal(result.matchedRows, 0);
  assert.equal(result.ambiguousRows, 1);
  assert.match(result.records[0].location.reviewReason ?? "", /Identity conflict/);
});

test("does not add the same ambiguous source evidence twice", () => {
  const exact = location({ id: "exact", rawSourceText: "New source" });
  const collision = location({ id: "collision", rawSourceText: "Different source" });
  const result = reconcileFranchiseCandidates([incoming()], [exact, collision], []);

  assert.equal(result.addedRows, 0);
  assert.equal(result.matchedRows, 1);
  assert.equal(result.ambiguousRows, 1);
  assert.equal(result.records[0].existingId, "exact");
});

test("does not revoke a reviewed decision when new ambiguous evidence is retained", () => {
  const approved = location({ id: "approved", reviewStatus: "Approved" });
  const collision = location({
    id: "collision",
    locationCode: "HW-999",
    address: "123 Main Street",
  });
  const result = reconcileFranchiseCandidates(
    [incoming({ rawSourceText: "Brand-new conflicting evidence" })],
    [approved, collision],
    [],
  );

  assert.equal(approved.reviewStatus, "Approved");
  assert.equal(result.addedRows, 1);
  assert.equal(result.records[0].location.reviewStatus, "Needs review");
});

test("preserves an approved status while filling missing fields", () => {
  const result = reconcileFranchiseCandidates(
    [incoming({ status: "Former", phone: "512-555-0100" })],
    [location({ reviewStatus: "Approved" })],
    [],
  );

  assert.equal(result.records[0].location.status, "Current");
  assert.equal(result.records[0].location.phone, "512-555-0100");
});

test("does not merge contacts on a shared phone or common name alone", () => {
  const candidate = incoming();
  candidate.contacts = [{
    rawName: "Other Person",
    firstName: "Other",
    middleName: null,
    lastName: "Person",
    suffix: null,
    title: null,
    email: null,
    phone: "512-555-0100",
  }, {
    rawName: "Jane Doe",
    firstName: "Jane",
    middleName: null,
    lastName: "Doe",
    suffix: null,
    title: null,
    email: "other@example.com",
    phone: null,
  }];
  const result = reconcileFranchiseCandidates(
    [candidate],
    [location()],
    [{
      id: "contact-1",
      locationId: "existing-location",
      rawName: "Jane Doe",
      firstName: "Jane",
      middleName: null,
      lastName: "Doe",
      suffix: null,
      title: null,
      email: null,
      phone: "512-555-0100",
    } as any],
  );

  assert.equal(result.records[0].contacts.length, 3);
});

test("deduplicates repeated phone-only contacts when no person identity conflicts", () => {
  const candidate = incoming();
  candidate.contacts = [{
    rawName: null,
    firstName: null,
    middleName: null,
    lastName: null,
    suffix: null,
    title: null,
    email: null,
    phone: "512-555-0100",
  }];
  const repeatedPhoneContact = {
    rawName: null,
    firstName: null,
    middleName: null,
    lastName: null,
    suffix: null,
    title: null,
    email: null,
    phone: "(512) 555-0100",
  };
  const result = reconcileFranchiseCandidates(
    [candidate],
    [location()],
    [
      { id: "contact-1", locationId: "existing-location", ...repeatedPhoneContact } as any,
      { id: "contact-2", locationId: "existing-location", ...repeatedPhoneContact } as any,
    ],
  );

  assert.equal(result.records[0].contacts.length, 1);
  assert.equal(result.updatedRows, 1);
});

function createOcrFixture(lines: string[][], confidence: number) {
  const rows = lines.flatMap((cells, lineIndex) =>
    cells.map((cell, cellIndex) => {
      const left = 36 + cellIndex * 140;
      const top = 60 + lineIndex * 32;
      const width = Math.min(110, Math.max(20, cell.length * 7));
      return `5\t1\t1\t1\t${lineIndex + 1}\t${cellIndex + 1}\t${left}\t${top}\t${width}\t20\t${confidence * 100}\t${cell}`;
    }),
  );
  return parseTesseractTsv([
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
    "1\t1\t0\t0\t0\t0\t0\t0\t612\t792\t-1\t",
    ...rows,
  ].join("\n"));
}

test("parses Tesseract TSV text, geometry, and confidence", () => {
  const result = parseTesseractTsv([
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
    "1\t1\t0\t0\t0\t0\t0\t0\t612\t792\t-1\t",
    "5\t1\t1\t1\t1\t1\t40\t60\t80\t20\t90.0\tCurrent",
    "5\t1\t1\t1\t1\t2\t130\t60\t100\t20\t80.0\tFranchisees",
    "5\t1\t1\t1\t2\t1\t40\t100\t50\t20\t70.0\tAustin",
  ].join("\n"));

  assert.equal(result.text, "Current Franchisees\nAustin");
  assert.equal(result.confidence, 0.8);
  assert.equal(result.imageWidth, 612);
  assert.equal(result.imageHeight, 792);
  assert.deepEqual(result.items?.map(({ left, top, width, height }) => ({ left, top, width, height })), [
    { left: 40, top: 60, width: 80, height: 20 },
    { left: 130, top: 60, width: 100, height: 20 },
    { left: 40, top: 100, width: 50, height: 20 },
  ]);
});

test("processes a known-brand PDF through extraction, storage, and stage completion", async () => {
  const fake = await runPdfProcessor(
    {
      id: "known-brand-document",
      franchiseName: "HOTWORX FDD",
      filename: "hotworx-2025.pdf",
      processingStatus: "Processing",
      pageCount: 0,
    },
    [
      "The franchisor is HOTWORX, LLC",
      "Current Franchisees",
      "Jane Doe | 123 Main Street | Austin, TX 78701 512-555-0100 jane@example.com",
      "Store 2 | 456 Oak Avenue | Dallas | TX | 75201",
    ],
  );

  assert.equal(fake.documents[0].franchiseName, "HOTWORX");
  assert.equal(fake.documents[0].processingStatus, "Needs review");
  assert.equal(fake.documents[0].pageCount, 1);
  assert.equal(fake.candidates.length, 2);
  assert.ok(fake.candidates.every((candidate) =>
    candidate.franchiseName === "HOTWORX" && candidate.franchisor === "HOTWORX",
  ));
  assert.match(fake.candidates[0].rawSourceText, /123 Main Street.*Austin.*TX.*78701/);
  assert.deepEqual(fake.contacts.map((contact) => contact.rawName), ["Jane Doe"]);
  assert.equal(fake.contacts[0].email, "jane@example.com");
  assert.equal(fake.stages.length, 1);
  assert.equal(fake.stages[0].status, "Complete");
  assert.match(fake.stages[0].message ?? "", /2 locations normalized from 1 verified source pages/);
});

test("keeps the filename-derived brand when a generic legal Franchisor label is present", async () => {
  const fake = await runPdfProcessor(
    {
      id: "generic-document",
      franchiseName: "Acme Wellness 2025",
      filename: "acme-wellness-2025.pdf",
      processingStatus: "Processing",
      pageCount: 0,
    },
    [
      "Franchisor: Acme Wellness Franchising, LLC, a Delaware limited liability company",
      "Current Franchisees",
      "Location 1 | 10 Oak Road | Raleigh | NC | 27601",
    ],
  );

  assert.equal(fake.documents[0].franchiseName, "acme wellness");
  assert.equal(fake.candidates.length, 1);
  assert.ok(fake.candidates.every((candidate) =>
    candidate.franchiseName === "acme wellness"
      && candidate.franchisor === "acme wellness",
  ));
  assert.match(fake.candidates[0].rawSourceText, /10 Oak Road.*Raleigh.*NC.*27601/);
  assert.equal(fake.documents[0].processingStatus, "Needs review");
  assert.equal(fake.stages.length, 1);
  assert.equal(fake.stages[0].status, "Complete");
});

test("keeps processing successful and uses the document name for a malformed label", async () => {
  const fake = await runPdfProcessor(
    {
      id: "fallback-document",
      franchiseName: "Fallback Wellness FDD",
      filename: "fallback-wellness-2025.pdf",
      processingStatus: "Processing",
      pageCount: 0,
    },
    [
      "Franchisor: [not disclosed]",
      "Current Franchisees",
      "Location 1 | 99 Main Street | Boise | ID | 83702",
    ],
  );

  assert.equal(fake.documents[0].franchiseName, "fallback wellness");
  assert.equal(fake.candidates.length, 1);
  assert.ok(fake.candidates.every((candidate) =>
    candidate.franchiseName === "fallback wellness"
      && candidate.franchisor === "fallback wellness",
  ));
  assert.match(fake.candidates[0].rawSourceText, /99 Main Street.*Boise.*ID.*83702/);
  assert.equal(fake.documents[0].processingStatus, "Needs review");
  assert.equal(fake.stages.length, 1);
  assert.equal(fake.stages[0].status, "Complete");
});

for (const fixture of [
  {
    label: "current",
    tocTitle: "CURRENT FRANCHISEES",
    heading: "Current Franchisees",
    row: "Alice Current | 123 Main Street | Austin, TX 78701",
    status: "Current",
  },
  {
    label: "former",
    tocTitle: "FORMER FRANCHISEES",
    heading: "Former Franchisees",
    row: "Bob Former | 456 Oak Avenue | Dallas, TX 75201",
    status: "Former",
  },
  {
    label: "planning",
    tocTitle: "SIGNED BUT NOT OPEN",
    heading: "Signed But Not Open",
    row: "Carol Planning | 789 Pine Road | Miami, FL 33101",
    status: "Planning",
  },
] as const) {
  test(`extracts ${fixture.label} locations from a scanned FDD page`, async () => {
    const fake = await runProcessor(
      {
        id: `scanned-${fixture.label}-document`,
        franchiseName: "Scanned Wellness FDD",
        filename: "scanned-wellness-2025.pdf",
        processingStatus: "Processing",
        pageCount: 0,
      },
      createPdfFixture([]),
      async () => createOcrFixture([
        [`EXHIBIT A ${fixture.tocTitle} ........ 1`],
        ["EXHIBIT A"],
        [fixture.heading],
        fixture.row.split(" | "),
      ], 0.88),
    );

    assert.equal(fake.documents[0].processingStatus, "Ready");
    assert.equal(fake.candidates.length, 1);
    assert.equal(fake.candidates[0].status, fixture.status);
    assert.equal(fake.candidates[0].confidence, 0.792);
    assert.equal(fake.candidates[0].reviewStatus, "Needs review");
    assert.match(fake.candidates[0].reviewReason, /OCR confidence 88%/);
    assert.equal(fake.documents[0].extractionManifest?.discoveryMethod, "toc");
    assert.deepEqual(fake.documents[0].extractionManifest?.ocrPages, [1]);
    assert.equal(fake.documents[0].extractionManifest?.ocrConfidence, 0.88);
    assert.ok(fake.documents[0].extractionManifest?.warnings.some((warning) =>
      /OCR used on 1 page/.test(warning),
    ));
  });
}

test("OCRs a hybrid page whose incidental native text is not useful for discovery", async () => {
  let ocrCalls = 0;
  const fake = await runProcessor(
    {
      id: "hybrid-scanned-document",
      franchiseName: "Scanned Wellness FDD",
      filename: "scanned-wellness-2025.pdf",
      processingStatus: "Processing",
      pageCount: 0,
    },
    createPdfFixture([
      "CONFIDENTIAL DRAFT PAGE 2025 — NOT FOR DISTRIBUTION — PRELIMINARY COPY — WATERMARK TEXT ONLY",
    ], true),
    async () => {
      ocrCalls += 1;
      return createOcrFixture([
        ["Current Franchisees"],
        ["Hybrid Owner", "321 Image Street", "Phoenix, AZ 85001"],
      ], 0.9);
    },
  );

  assert.equal(ocrCalls, 1);
  assert.equal(fake.documents[0].processingStatus, "Ready");
  assert.equal(fake.candidates.length, 1);
  assert.equal(fake.candidates[0].status, "Current");
  assert.deepEqual(fake.documents[0].extractionManifest?.ocrPages, [1]);
});

test("preserves a healthy corpus when OCR confidence is too low", async () => {
  const document: DocumentRow = {
    id: "low-quality-ocr-document",
    franchiseName: "Scanned Wellness FDD",
    filename: "scanned-wellness-2025.pdf",
    processingStatus: "Processing",
    pageCount: 1,
  };
  const fake = createFakeDatabase(document);
  fake.candidates.push({
    id: "existing-location",
    documentId: document.id,
    franchiseName: "Scanned Wellness",
    franchisor: "Scanned Wellness",
    status: "Current",
    sourcePage: 1,
    rawSourceText: "Previously verified row",
    confidence: 0.9,
    reviewStatus: "Approved",
    reviewReason: "Previously verified",
  });

  await processFddDocument(document.id, "/objects/fixture/low-quality-ocr", {
    db: fake.db,
    getObjectFile: () => ({
      download: async () => [createPdfFixture([])],
    }),
    ocrPage: async () => createOcrFixture([
      ["Current Franchisees"],
      ["Noisy Result", "999 Blur Street", "Austin, TX 78701"],
    ], 0.41),
  });

  assert.deepEqual(fake.candidates.map((candidate) => candidate.id), ["existing-location"]);
  assert.equal(fake.documents[0].processingStatus, "Failed");
  assert.equal(fake.stages[0].status, "Failed");
  assert.match(fake.stages[0].message ?? "", /OCR quality was too low.*existing location data was preserved/i);
});

test("marks a corrupt PDF and its extraction stage as failed without storing candidates", async () => {
  const invalidPdfFixture = Buffer.from(
    "%PDF-1.4\nThis fixture is intentionally not a valid PDF.\n%%EOF\n",
    "ascii",
  );
  const fake = await runProcessor(
    {
      id: "invalid-document",
      franchiseName: "Unreadable Wellness FDD",
      filename: "unreadable-wellness-2025.pdf",
      processingStatus: "Processing",
      pageCount: 0,
    },
    invalidPdfFixture,
  );

  assert.equal(fake.documents[0].processingStatus, "Failed");
  assert.equal(fake.candidates.length, 0);
  assert.equal(fake.stages.length, 1);
  assert.equal(fake.stages[0].status, "Failed");
  assert.match(fake.stages[0].message ?? "", /PDF|Invalid|structure/i);
  assert.ok(fake.stages[0].finishedAt instanceof Date);
});

test("rolls back replacement rows when contact persistence fails", async () => {
  const document: DocumentRow = {
    id: "rollback-document",
    franchiseName: "HOTWORX",
    filename: "Hotworx_2025.pdf",
    processingStatus: "Processing",
    pageCount: 0,
  };
  const fake = createFakeDatabase(document);
  fake.candidates.push({
    id: "existing-location",
    documentId: document.id,
    franchiseName: "HOTWORX",
    franchisor: "HOTWORX",
    status: "Current",
    sourcePage: 10,
    rawSourceText: "Previously verified row",
    confidence: 0.9,
    reviewStatus: "Approved",
    reviewReason: "Previously verified",
  });
  fake.failOnContacts = true;

  await processFddDocument(document.id, "/objects/fixture/rollback", {
    db: fake.db,
    getObjectFile: () => ({
      download: async () => [createPdfFixture([
        "Current Franchisees",
        "Jane Doe | 123 Main Street | Austin, TX 78701 512-555-0100 jane@example.com",
      ])],
    }),
  });

  assert.deepEqual(fake.candidates.map((candidate) => candidate.id), ["existing-location"]);
  assert.equal(fake.documents[0].processingStatus, "Failed");
  assert.equal(fake.stages[0].status, "Failed");
  assert.match(fake.stages[0].message ?? "", /simulated contact write failure/);
});

test("keeps a real PostgreSQL reupload idempotent", { skip: !process.env.DATABASE_URL }, async () => {
  const isolated = await createIsolatedPostgresDatabase();
  const { db } = isolated;
  const suffix = randomUUID();
  const documentId = randomUUID();
  const filename = `integration-idempotency-${suffix}-2026.pdf`;
  const objectPath = `/objects/integration/${suffix}/fdd.pdf`;
  const fixture = createPdfFixture([
    "Current Franchisees",
    "Jane Doe | 123 Main Street | Austin, TX 78701 512-555-0100 jane@example.com",
    "Store 2 | 456 Oak Avenue | Dallas | TX | 75201",
  ]);

  await db.insert(fddDocumentsTable).values({
    id: documentId,
    franchiseName: "Integration Idempotency Fixture",
    filename,
    objectPath,
    processingStatus: "Processing",
  });

  try {
    const getObjectFile = () => ({
      download: async () => [fixture] as [Buffer],
    });
    await processFddDocument(documentId, objectPath, { db, getObjectFile });

    const [firstDocument] = await db
      .select()
      .from(fddDocumentsTable)
      .where(eq(fddDocumentsTable.id, documentId))
      .limit(1);
    assert.equal(firstDocument?.processingStatus, "Ready");
    const firstLocations = await db
      .select()
      .from(franchiseLocationsTable)
      .where(eq(franchiseLocationsTable.documentId, documentId));
    const firstContacts = await db
      .select()
      .from(contactsTable)
      .where(inArray(contactsTable.locationId, firstLocations.map((location) => location.id)));
    assert.equal(firstLocations.length, 2);
    assert.equal(firstContacts.length, 1);

    await processFddDocument(documentId, objectPath, { db, getObjectFile });

    const [secondDocument] = await db
      .select()
      .from(fddDocumentsTable)
      .where(eq(fddDocumentsTable.id, documentId))
      .limit(1);
    const secondLocations = await db
      .select()
      .from(franchiseLocationsTable)
      .where(eq(franchiseLocationsTable.documentId, documentId));
    const secondContacts = await db
      .select()
      .from(contactsTable)
      .where(inArray(contactsTable.locationId, secondLocations.map((location) => location.id)));
    const manifest = secondDocument?.extractionManifest;
    assert.equal(manifest?.addedRows, 0);
    assert.equal(manifest?.updatedRows, 0);
    assert.equal(manifest?.unchangedRows, 2);
    assert.equal(secondLocations.length, firstLocations.length);
    assert.equal(secondContacts.length, firstContacts.length);

    const identityKeys = secondLocations.map((location) => {
      const keys = locationIdentityKeys(location);
      return keys.code || keys.address || keys.entity || keys.exact;
    });
    assert.ok(identityKeys.every(Boolean));
    assert.equal(new Set(identityKeys).size, secondLocations.length);
    const stages = await db
      .select()
      .from(processingStagesTable)
      .where(eq(processingStagesTable.documentId, documentId));
    assert.equal(stages.length, 2);
    assert.ok(stages.every((stage) => stage.status === "Complete"));
    assert.match(stages.at(-1)?.message ?? "", /0 added, 0 updated, 2 unchanged/);
  } finally {
    await isolated.close();
  }
});

test("does not commit stale evidence after a newer overlapping extraction wins", { skip: !process.env.DATABASE_URL }, async () => {
  const isolated = await createIsolatedPostgresDatabase();
  const { db } = isolated;
  const suffix = randomUUID();
  const documentId = randomUUID();
  const oldObjectPath = `/objects/integration/${suffix}/old.pdf`;
  const newObjectPath = `/objects/integration/${suffix}/new.pdf`;
  const oldFixture = createPdfFixture([
    "Current Franchisees",
    "Old Owner | 111 Old Street | Austin, TX 78701",
  ]);
  const newFixture = createPdfFixture([
    "Current Franchisees",
    "New Owner | 222 New Street | Austin, TX 78701",
  ]);
  let signalOldDownloadStarted!: () => void;
  let releaseOldDownload!: () => void;
  const oldDownloadStarted = new Promise<void>((resolve) => {
    signalOldDownloadStarted = resolve;
  });
  const oldDownloadMayContinue = new Promise<void>((resolve) => {
    releaseOldDownload = resolve;
  });
  let staleRun: Promise<void> | undefined;
  const filename = `integration-stale-${suffix}-2026.pdf`;

  await db.insert(fddDocumentsTable).values({
    id: documentId,
    franchiseName: "Integration Stale Fixture",
    filename,
    objectPath: oldObjectPath,
    processingStatus: "Processing",
  });

  try {
    staleRun = processFddDocument(documentId, oldObjectPath, {
      db,
      getObjectFile: () => ({
        download: async () => {
          signalOldDownloadStarted();
          await oldDownloadMayContinue;
          return [oldFixture] as [Buffer];
        },
      }),
    });
    await oldDownloadStarted;

    await db
      .update(fddDocumentsTable)
      .set({
        objectPath: newObjectPath,
        uploadDate: new Date(Date.now() + 1_000),
        processingStatus: "Processing",
      })
      .where(eq(fddDocumentsTable.id, documentId));

    await processFddDocument(documentId, newObjectPath, {
      db,
      getObjectFile: () => ({
        download: async () => [newFixture] as [Buffer],
      }),
    });
    releaseOldDownload();
    await staleRun;

    const [document] = await db
      .select()
      .from(fddDocumentsTable)
      .where(eq(fddDocumentsTable.id, documentId))
      .limit(1);
    const locations = await db
      .select()
      .from(franchiseLocationsTable)
      .where(eq(franchiseLocationsTable.documentId, documentId));
    const stages = await db
      .select()
      .from(processingStagesTable)
      .where(eq(processingStagesTable.documentId, documentId));
    assert.equal(document?.processingStatus, "Ready");
    assert.deepEqual(locations.map((location) => location.address), ["222 New Street"]);
    assert.equal(stages.filter((stage) => stage.status === "Complete").length, 1);
    assert.equal(stages.filter((stage) => stage.status === "Skipped").length, 1);
  } finally {
    releaseOldDownload();
    await staleRun?.catch(() => undefined);
    await isolated.close();
  }
});
