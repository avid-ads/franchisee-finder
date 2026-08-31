import {
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type FddSourceRange = {
  section: string;
  status: "Current" | "Former" | "Planning";
  exhibit: string | null;
  printedStart: string | null;
  pdfStart: number;
  pdfEnd: number;
};

export type FddExtractionManifest = {
  discoveryMethod: "toc" | "heading-scan" | "legacy-fallback";
  sourceRanges: FddSourceRange[];
  pagesExamined: number[];
  ocrPages?: number[];
  ocrConfidence?: number | null;
  acceptedRows: number;
  rejectedRows: number;
  duplicateRows: number;
  missingAddressRows: number;
  missingContactRows: number;
  addedRows?: number;
  matchedRows?: number;
  updatedRows?: number;
  unchangedRows?: number;
  ambiguousRows?: number;
  collapsedRows?: number;
  removedRows?: number;
  warnings: string[];
  complete: boolean;
};

export const fddDocumentsTable = pgTable("fdd_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id"),
  franchiseName: text("franchise_name").notNull(),
  fddYear: integer("fdd_year"),
  filename: text("filename").notNull(),
  objectPath: text("object_path"),
  uploadDate: timestamp("upload_date", { withTimezone: true }).notNull().defaultNow(),
  processingStatus: text("processing_status").notNull().default("Queued"),
  pageCount: integer("page_count").notNull().default(0),
  dataAsOf: text("data_as_of"),
  sourceExhibit: text("source_exhibit"),
  publishedCounts: jsonb("published_counts").$type<Record<string, number>>().notNull().default({}),
  extractionManifest: jsonb("extraction_manifest").$type<FddExtractionManifest>(),
  lastProcessedAt: timestamp("last_processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const processingStagesTable = pgTable("processing_stages", {
  id: serial("id").primaryKey(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => fddDocumentsTable.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(),
  status: text("status").notNull(),
  message: text("message"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const franchiseLocationsTable = pgTable(
  "franchise_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => fddDocumentsTable.id, { onDelete: "cascade" }),
    franchiseName: text("franchise_name").notNull(),
    franchisor: text("franchisor").notNull().default(""),
    status: text("status").notNull(),
    franchiseeEntity: text("franchisee_entity"),
    address: text("address"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    country: text("country"),
    phone: text("phone"),
    email: text("email"),
    locationCode: text("location_code"),
    exitReason: text("exit_reason"),
    sourcePage: integer("source_page"),
    printedPage: text("printed_page"),
    sourceExhibit: text("source_exhibit"),
    sourceSection: text("source_section"),
    rawSourceText: text("raw_source_text"),
    confidence: real("confidence").notNull().default(0.8),
    reviewStatus: text("review_status").notNull().default("Needs review"),
    reviewReason: text("review_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("franchise_locations_status_idx").on(table.status),
    index("franchise_locations_state_idx").on(table.state),
    index("franchise_locations_document_idx").on(table.documentId),
    index("franchise_locations_franchisor_lower_idx").on(sql`lower(${table.franchisor})`),
  ],
);

export const contactsTable = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  locationId: uuid("location_id")
    .notNull()
    .references(() => franchiseLocationsTable.id, { onDelete: "cascade" }),
  firstName: text("first_name"),
  middleName: text("middle_name"),
  lastName: text("last_name"),
  suffix: text("suffix"),
  title: text("title"),
  email: text("email"),
  phone: text("phone"),
  rawName: text("raw_name"),
});

export const insertFddDocumentSchema = createInsertSchema(fddDocumentsTable).omit({
  id: true,
  uploadDate: true,
  createdAt: true,
});
export const insertFranchiseLocationSchema = createInsertSchema(franchiseLocationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertContactSchema = createInsertSchema(contactsTable).omit({ id: true });

export type FddDocumentRow = typeof fddDocumentsTable.$inferSelect;
export type FranchiseLocationRow = typeof franchiseLocationsTable.$inferSelect;
export type ContactRow = typeof contactsTable.$inferSelect;
export type InsertFddDocument = z.infer<typeof insertFddDocumentSchema>;
export type InsertFranchiseLocation = z.infer<typeof insertFranchiseLocationSchema>;
