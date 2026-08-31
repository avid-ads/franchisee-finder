import path from "node:path";
import { createReadStream, existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  contactsTable,
  db,
  fddDocumentsTable,
  franchiseLocationsTable,
  processingStagesTable,
} from "@workspace/db";
import {
  GetLocationResponse,
  GetStatsResponse,
  ListDocumentsResponse,
  ListLocationsQueryParams,
  ListLocationsResponse,
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
  UpdateLocationBody,
  UpdateLocationResponse,
  UploadDocumentBody,
  UploadDocumentResponse,
} from "@workspace/api-zod";
import { createPdfUploadDestination, getObjectFile } from "../lib/objectStorage";
import { processFddDocument } from "../lib/fddProcessor";

const router: IRouter = Router();

const toLocation = (
  row: typeof franchiseLocationsTable.$inferSelect,
  contacts: any[] = [],
  sourceDocument?: typeof fddDocumentsTable.$inferSelect,
) => ({
  id: row.id,
  documentId: row.documentId,
  sourceDocumentFilename: sourceDocument?.filename ?? null,
  franchiseName: row.franchiseName,
  franchisor: row.franchisor,
  status: row.status,
  franchiseeEntity: row.franchiseeEntity,
  address: row.address,
  city: row.city,
  state: row.state,
  zip: row.zip,
  country: row.country,
  phone: row.phone,
  email: row.email,
  locationCode: row.locationCode,
  exitReason: row.exitReason,
  sourcePage: row.sourcePage,
  printedPage: row.printedPage,
  sourceExhibit: row.sourceExhibit,
  sourceSection: row.sourceSection,
  rawSourceText: row.rawSourceText,
  confidence: row.confidence,
  reviewStatus: row.reviewStatus,
  reviewReason: row.reviewReason,
  contacts: contacts.map((contact) => ({
    rawName: contact.rawName,
    firstName: contact.firstName,
    middleName: contact.middleName,
    lastName: contact.lastName,
    suffix: contact.suffix,
    title: contact.title,
    email: contact.email,
    phone: contact.phone,
  })),
});

async function toDocument(document: typeof fddDocumentsTable.$inferSelect) {
  const [counts, stages] = await Promise.all([
    db
      .select({ status: franchiseLocationsTable.status, count: sql<number>`count(*)` })
      .from(franchiseLocationsTable)
      .where(eq(franchiseLocationsTable.documentId, document.id))
      .groupBy(franchiseLocationsTable.status),
    db
      .select()
      .from(processingStagesTable)
      .where(eq(processingStagesTable.documentId, document.id))
      .orderBy(asc(processingStagesTable.id)),
  ]);
  const recordCounts: Record<string, number> = Object.fromEntries(
    counts.map((row) => [row.status, Number(row.count)]),
  );
  return {
    id: document.id,
    franchiseName: document.franchiseName,
    fddYear: document.fddYear,
    filename: document.filename,
    uploadDate: document.uploadDate.toISOString(),
    processingStatus: document.processingStatus,
    pageCount: document.pageCount,
    dataAsOf: document.dataAsOf,
    sourceExhibit: document.sourceExhibit,
    extractionManifest: document.extractionManifest,
    lastProcessedAt: document.lastProcessedAt?.toISOString() ?? null,
    locationCount: Object.values(recordCounts).reduce((sum, count) => sum + count, 0),
    recordCounts,
    stages: stages.map(({ stage, status, message, startedAt, finishedAt }) => ({
      stage,
      status,
      message,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt?.toISOString() ?? null,
    })),
  };
}

router.get("/stats", async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        documents: sql<number>`count(distinct ${fddDocumentsTable.id})`,
        totalLocations: sql<number>`count(${franchiseLocationsTable.id}) filter (where ${fddDocumentsTable.processingStatus} in ('Ready', 'Needs review', 'Completed'))`,
        current: sql<number>`count(${franchiseLocationsTable.id}) filter (where ${franchiseLocationsTable.status} = 'Current' and ${fddDocumentsTable.processingStatus} in ('Ready', 'Needs review', 'Completed'))`,
        former: sql<number>`count(${franchiseLocationsTable.id}) filter (where ${franchiseLocationsTable.status} = 'Former' and ${fddDocumentsTable.processingStatus} in ('Ready', 'Needs review', 'Completed'))`,
        planning: sql<number>`count(${franchiseLocationsTable.id}) filter (where ${franchiseLocationsTable.status} = 'Planning' and ${fddDocumentsTable.processingStatus} in ('Ready', 'Needs review', 'Completed'))`,
        needsReview: sql<number>`count(${franchiseLocationsTable.id}) filter (where ${franchiseLocationsTable.reviewStatus} = 'Needs review' and ${fddDocumentsTable.processingStatus} in ('Ready', 'Needs review', 'Completed'))`,
      })
      .from(fddDocumentsTable)
      .leftJoin(franchiseLocationsTable, eq(franchiseLocationsTable.documentId, fddDocumentsTable.id));
    return void res.json(GetStatsResponse.parse(Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, Number(v)]))));
  } catch (error) {
    return next(error);
  }
});

router.get("/documents", async (_req, res, next) => {
  try {
    const documents = await db.select().from(fddDocumentsTable).orderBy(desc(fddDocumentsTable.uploadDate));
    const output = await Promise.all(documents.map(toDocument));
    return void res.json(ListDocumentsResponse.parse(output));
  } catch (error) {
    return next(error);
  }
});

router.post("/storage/uploads/request-url", async (req, res, next) => {
  try {
    const body = RequestUploadUrlBody.parse(req.body);
    if (body.contentType !== "application/pdf" && !body.name.toLowerCase().endsWith(".pdf")) {
      res.status(400).json({ error: "Only PDF files can be uploaded" });
      return;
    }
    res.json(RequestUploadUrlResponse.parse(await createPdfUploadDestination()));
    return;
  } catch (error) {
    return next(error);
  }
});

router.post("/documents", async (req, res, next) => {
  try {
    const body = UploadDocumentBody.parse(req.body);
    const existing = await db
      .select()
      .from(fddDocumentsTable)
      .where(eq(fddDocumentsTable.filename, body.filename))
      .limit(1);
    if (existing[0]) {
      const [updated] = await db
        .update(fddDocumentsTable)
        .set({ objectPath: body.objectPath, uploadDate: new Date(), processingStatus: "Processing" })
        .where(eq(fddDocumentsTable.id, existing[0].id))
        .returning();
      await db.insert(processingStagesTable).values({
        documentId: updated.id,
        stage: "Upload",
        status: "Complete",
        message: "Replacement PDF stored securely",
        finishedAt: new Date(),
      });
      void processFddDocument(updated.id, body.objectPath);
      res.status(201).json(UploadDocumentResponse.parse(await toDocument(updated)));
      return;
    }
    const year = Number(body.filename.match(/20\d{2}/)?.[0]) || null;
    const name = body.filename.replace(/[-_]/g, " ").replace(/20\d{2}.*$/i, "").replace(/\.pdf$/i, "").trim();
    const [document] = await db
      .insert(fddDocumentsTable)
      .values({
        franchiseName: name || "Uploaded FDD",
        fddYear: year,
        filename: body.filename,
        objectPath: body.objectPath,
        processingStatus: "Processing",
      })
      .returning();
    await db.insert(processingStagesTable).values({
      documentId: document.id,
      stage: "Upload",
      status: "Complete",
      message: "PDF stored securely",
      finishedAt: new Date(),
    });
    void processFddDocument(document.id, body.objectPath);
    res.status(201).json(UploadDocumentResponse.parse(await toDocument(document)));
    return;
  } catch (error) {
    return next(error);
  }
});

router.get("/documents/:documentId/pdf", async (req, res, next) => {
  try {
    const [document] = await db
      .select()
      .from(fddDocumentsTable)
      .where(eq(fddDocumentsTable.id, req.params.documentId))
      .limit(1);
    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    const asciiFilename = document.filename
      .normalize("NFKD")
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/["\\]/g, "")
      || "document.pdf";
    const encodedFilename = encodeURIComponent(document.filename).replace(/['()*]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    res
      .type("application/pdf")
      .setHeader(
        "Content-Disposition",
        `inline; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`,
      );
    if (document.objectPath) {
      getObjectFile(document.objectPath).createReadStream().pipe(res);
      return;
    }
    const fixtureDir = path.resolve(process.cwd(), ".local/conversation-workspace/files/data/uploads");
    if (existsSync(fixtureDir)) {
      const match = (await readdir(fixtureDir)).find((file) => file === document.filename);
      if (match) {
        createReadStream(path.join(fixtureDir, match)).pipe(res);
        return;
      }
    }
    res.status(404).json({ error: "Source PDF is not available" });
    return;
  } catch (error) {
    return next(error);
  }
});

router.get("/locations", async (req, res, next) => {
  try {
    const query = ListLocationsQueryParams.parse(req.query);
    const conditions = [];
    if (query.status) conditions.push(eq(franchiseLocationsTable.status, query.status));
    if (query.franchisor) conditions.push(eq(franchiseLocationsTable.franchisor, query.franchisor));
    if (query.documentId) conditions.push(eq(franchiseLocationsTable.documentId, query.documentId));
    else conditions.push(sql`${franchiseLocationsTable.documentId} in (select id from fdd_documents where processing_status in ('Ready', 'Needs review', 'Completed'))`);
    if (query.state) conditions.push(eq(franchiseLocationsTable.state, query.state));
    if (query.reviewStatus) conditions.push(eq(franchiseLocationsTable.reviewStatus, query.reviewStatus));
    if (query.q) {
      const pattern = `%${query.q}%`;
      conditions.push(
        or(
          ilike(franchiseLocationsTable.franchisor, pattern),
          ilike(franchiseLocationsTable.franchiseeEntity, pattern),
          ilike(franchiseLocationsTable.city, pattern),
          ilike(franchiseLocationsTable.state, pattern),
          ilike(franchiseLocationsTable.address, pattern),
          ilike(franchiseLocationsTable.locationCode, pattern),
        )!,
      );
    }
    const rows = await db
      .select()
      .from(franchiseLocationsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(franchiseLocationsTable.franchiseName), asc(franchiseLocationsTable.state), asc(franchiseLocationsTable.city))
      .limit(query.limit ?? 100)
      .offset(query.offset ?? 0);
    return void res.json(ListLocationsResponse.parse(rows.map((row) => toLocation(row))));
  } catch (error) {
    return next(error);
  }
});

router.get("/locations/:locationId", async (req, res, next) => {
  try {
    const [location] = await db.select().from(franchiseLocationsTable).where(eq(franchiseLocationsTable.id, req.params.locationId)).limit(1);
    if (!location) {
      res.status(404).json({ error: "Location not found" });
      return;
    }
    const contacts = await db.select().from(contactsTable).where(eq(contactsTable.locationId, location.id));
    const [sourceDocument] = await db
      .select()
      .from(fddDocumentsTable)
      .where(eq(fddDocumentsTable.id, location.documentId))
      .limit(1);
    res.json(GetLocationResponse.parse(toLocation(location, contacts, sourceDocument)));
    return;
  } catch (error) {
    return next(error);
  }
});

router.patch("/locations/:locationId", async (req, res, next) => {
  try {
    const body = UpdateLocationBody.parse(req.body);
    const [location] = await db.update(franchiseLocationsTable).set(body).where(eq(franchiseLocationsTable.id, req.params.locationId)).returning();
    if (!location) {
      res.status(404).json({ error: "Location not found" });
      return;
    }
    const contacts = await db.select().from(contactsTable).where(eq(contactsTable.locationId, location.id));
    const [sourceDocument] = await db
      .select()
      .from(fddDocumentsTable)
      .where(eq(fddDocumentsTable.id, location.documentId))
      .limit(1);
    res.json(UpdateLocationResponse.parse(toLocation(location, contacts, sourceDocument)));
    return;
  } catch (error) {
    return next(error);
  }
});

export default router;
