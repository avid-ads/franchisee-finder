import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateFromCells,
  candidateFromContactDirectoryCells,
  candidatesFromAddressBlockLines,
  candidatesFromTerritoryDirectoryLines,
  candidatesFromUnitBlockLines,
  detectFranchisor,
  discoverFranchiseeSources,
  franchisorFromFilename,
  inferStatus,
  isFranchiseeSectionHeading,
  mapPrintedPagesToPdfPages,
  parseFddTocEntries,
  statusFromHeading,
} from "./fddParser.ts";

test("discovers Item 20 and exhibit franchisee-list TOC entries", () => {
  const entries = parseFddTocEntries([
    "Item 20. Outlets and Franchisee Information ........ 145",
    "Exhibit F - Current Franchisees .................... 201-204",
    "Exhibit F - Former Franchisees ..................... 205",
    "Exhibit F - Franchisees Signed But Not Open ....... 206",
    "Exhibit G - Financial Statements ................... 207",
  ].join("\n"));
  assert.deepEqual(entries.map(({ itemNumber, exhibit, listKind, printedPageStart, printedPageEnd }) => [
    itemNumber, exhibit, listKind, printedPageStart, printedPageEnd,
  ]), [
    [20, null, null, 145, 145],
    [null, "F", "current", 201, 204],
    [null, "F", "former", 205, 205],
    [null, "F", "signed-but-not-open", 206, 206],
  ]);
});

test("maps observed printed footer labels and validates list headings", () => {
  const pages = [
    { pdfPage: 214, text: "Current Franchisees\nAcme LLC\nFDD-201" },
    { pdfPage: 215, text: "Former Franchisees\nFDD-202" },
  ];
  assert.deepEqual([...mapPrintedPagesToPdfPages(pages)], [[201, 214], [202, 215]]);
  assert.equal(isFranchiseeSectionHeading("Current Franchisees"), true);
  assert.equal(isFranchiseeSectionHeading("Current Franchisees ........ 201"), false);
  assert.equal(isFranchiseeSectionHeading("Franchisee financial performance"), false);
});

test("returns page-resolved, scoped franchisee sections", () => {
  const discovery = discoverFranchiseeSources([
    { pdfPage: 4, text: "EXHIBIT F - Current Franchisees ........ 201" },
    { pdfPage: 214, text: "EXHIBIT F\nCurrent Franchisees\nAcme LLC\nFDD-201" },
  ]);
  assert.equal(discovery.sections.length, 1);
  assert.deepEqual(discovery.sections[0], {
    heading: "Current Franchisees",
    kind: "current",
    status: "Current",
    exhibit: "F",
    printedPageStart: 201,
    printedPageEnd: 201,
    pdfPageStart: 214,
    pdfPageEnd: 214,
  });
});

test("classifies a plain List of Franchisees exhibit as a current section", () => {
  assert.equal(isFranchiseeSectionHeading("List of Franchisees"), true);
  const discovery = discoverFranchiseeSources([
    { pdfPage: 6, text: "Exhibit C - List of Franchisees" },
    {
      pdfPage: 100,
      text: [
        "EXHIBIT C",
        "LIST OF FRANCHISEES",
        "Acme LLC | 100 Main Street | Austin | TX | 78701",
        "Bravo LLC | 200 Oak Street | Dallas | TX | 75201",
      ].join("\n"),
    },
  ]);
  assert.equal(discovery.sections.length, 1);
  assert.equal(discovery.sections[0].kind, "current");
  assert.equal(discovery.sections[0].pdfPageStart, 100);
});

test("merges repeated headers and extends start-only TOC citations to the next section", () => {
  const discovery = discoverFranchiseeSources([
    {
      pdfPage: 4,
      text: [
        "Exhibit F - Current Franchisees ........ 201",
        "Exhibit F - Former Franchisees ......... 204",
        "Exhibit F - Signed But Not Open ....... 206-207",
      ].join("\n"),
    },
    { pdfPage: 214, text: "EXHIBIT F\nCurrent Franchisees\nAcme\nFDD-201" },
    { pdfPage: 215, text: "Current Franchisees\nBravo\nFDD-202" },
    { pdfPage: 216, text: "Charlie\nFDD-203" },
    { pdfPage: 217, text: "Former Franchisees\nDelta\nFDD-204" },
    { pdfPage: 218, text: "Former Franchisees\nEcho\nFDD-205" },
    { pdfPage: 219, text: "Signed But Not Open\nFoxtrot\nFDD-206" },
    { pdfPage: 220, text: "Golf\nFDD-207" },
    { pdfPage: 221, text: "EXHIBIT G\nFinancial Statements\nFDD-208" },
  ]);
  assert.deepEqual(discovery.sections.map((section) => [
    section.kind,
    section.printedPageStart,
    section.printedPageEnd,
    section.pdfPageStart,
    section.pdfPageEnd,
  ]), [
    ["current", 201, 203, 214, 216],
    ["former", 204, 205, 217, 218],
    // The explicit TOC range wins even though the range could otherwise be inferred.
    ["signed-but-not-open", 206, 207, 219, 220],
  ]);
});

test("uses the next validated boundary when an explicit TOC end footer is unreadable", () => {
  const discovery = discoverFranchiseeSources([
    { pdfPage: 4, text: "Exhibit F - Current Franchisees ........ 201-203" },
    { pdfPage: 214, text: "EXHIBIT F\nCurrent Franchisees\nAcme LLC\nFDD-201" },
    { pdfPage: 215, text: "Continuation row without a readable footer" },
    { pdfPage: 216, text: "EXHIBIT G\nFinancial Statements" },
  ]);
  assert.equal(discovery.sections.length, 1);
  assert.equal(discovery.sections[0].pdfPageStart, 214);
  assert.equal(discovery.sections[0].pdfPageEnd, 215);
  assert.equal(discovery.sections[0].printedPageEnd, 203);
});

test("normalizes the named franchisors found on FDD cover pages", () => {
  const cases = [
    ["HOTWORX®, LLC", "HOTWORX"],
    ["Elements Massage Franchising, LLC", "Elements Massage"],
    ["Massage Envy Franchising, LLC", "Massage Envy"],
  ] as const;

  for (const [pageText, expected] of cases) {
    assert.equal(detectFranchisor(`The franchisor is ${pageText}`, "Uploaded FDD"), expected);
  }
});

test("extracts and cleans a generic Franchisor label", () => {
  assert.equal(
    detectFranchisor(
      "Franchisor: Acme Wellness Franchising, LLC, a Delaware limited liability company",
      "Uploaded FDD",
    ),
    "Acme Wellness Franchising, LLC",
  );
  assert.equal(
    detectFranchisor("Franchisor means Example Brands, Inc. Item 1 - The Company", "Uploaded FDD"),
    "Example Brands, Inc",
  );
});

test("uses the fallback when the Franchisor label is absent or malformed", () => {
  assert.equal(detectFranchisor("The cover page has no franchisor label.", "Uploaded FDD"), "Uploaded FDD");
  assert.equal(detectFranchisor("Franchisor: [not disclosed]", "Uploaded FDD"), "Uploaded FDD");
  assert.equal(detectFranchisor("Franchisor: unknown", "Uploaded FDD"), "Uploaded FDD");
});

test("uses a cleaned filename brand and does not replace it with a weak generic match", () => {
  const filenameBrand = franchisorFromFilename("Pure_Barre_2025_wNNpGhbJ.pdf");
  assert.equal(filenameBrand, "Pure Barre");
  assert.equal(detectFranchisor("payments made to the franchisor at its direction", filenameBrand), "Pure Barre");
});

test("accepts full state names in conventional location tables", () => {
  const candidate = candidateFromCells(
    ["1.", "Hayes, Taylor", "2415 Moores Mill Road", "Auburn", "Alabama", "36830", "334-750-1144"],
    "document-id",
    "Pure Barre",
    229,
    "Current",
  );
  assert.equal(candidate?.state, "AL");
  assert.equal(candidate?.city, "Auburn");
  assert.equal(candidate?.franchiseeEntity, "Hayes, Taylor");
});

test("extracts a ZIP when phone and franchisee details share the ZIP cell", () => {
  const candidate = candidateFromCells(
    ["8485 Auburn Road", "Citrus Heights", "CA", "95610 916-241-8939 Auburn Fitness, Inc", "Jerry McCall"],
    "document-id",
    "Gold’s Gym",
    168,
    "Current",
  );
  assert.equal(candidate?.address, "8485 Auburn Road");
  assert.equal(candidate?.city, "Citrus Heights");
  assert.equal(candidate?.state, "CA");
  assert.equal(candidate?.zip, "95610");
  assert.equal(candidate?.franchiseeEntity, "Auburn Fitness, Inc");
});

test("parses combined city/state rows and preserves contact and source citations", () => {
  const candidate = candidateFromCells(
    ["Acme Fitness LLC", "100 Main Street", "Denver, CO 80202", "(303) 555-0199", "owner@acme.test"],
    "document-id", "Acme", 23, "Current",
    { exhibit: "F", section: "Current Franchisees", printedPage: 201 },
  );
  assert.deepEqual(
    [candidate?.franchiseeEntity, candidate?.address, candidate?.city, candidate?.state, candidate?.zip, candidate?.phone, candidate?.email],
    ["Acme Fitness LLC", "100 Main Street", "Denver", "CO", "80202", "(303) 555-0199", "owner@acme.test"],
  );
  assert.deepEqual(
    [candidate?.sourceExhibit, candidate?.sourceSection, candidate?.sourcePrintedPage],
    ["F", "Current Franchisees", 201],
  );
});

test("extracts one location per territory from unit-count blocks", () => {
  const candidates = candidatesFromUnitBlockLines(
    [
      "[[STATUS:Current]]",
      "Laguna Beach, CA",
      "Newport Beach, CA",
      "William Gregory Moore",
      "1821 Buttonshell Lane",
      "Newport Beach, CA 92660",
      "# of units: 2",
      "[[STATUS:Planning]]",
      "Sherman Oaks, CA",
      "Dru Montgomery",
      "4305 Cezanne Ave",
      "Woodland Hills, CA 91364",
      "# of units: 1",
    ],
    "document-id",
    "GYMGUYZ",
    151,
  );
  assert.deepEqual(
    candidates.map(({ city, state, status, franchisor }) => [city, state, status, franchisor]),
    [
      ["Laguna Beach", "CA", "Current", "GYMGUYZ"],
      ["Newport Beach", "CA", "Current", "GYMGUYZ"],
      ["Sherman Oaks", "CA", "Planning", "GYMGUYZ"],
    ],
  );
});

test("recognizes standalone planning and ceased-operation section headings", () => {
  assert.equal(inferStatus("SIGNED BUT NOT OPEN AS OF 12/31/24"), "Planning");
  assert.equal(inferStatus("CEASED OPERATIONS:\nFlorida"), "Former");
  assert.equal(inferStatus("LIST OF CURRENT AND FORMER FRANCHISEES\nCurrent Franchisees"), "Current");
  assert.equal(statusFromHeading("Franchisees Who Left the System During 2024", "Current"), "Former");
  assert.equal(statusFromHeading("FRANCHISEES WITH OUTLETS OPEN", "Former"), "Current");
  assert.equal(
    statusFromHeading("Franchisees who have signed agreements but have not yet opened for business", "Current"),
    "Planning",
  );
});

test("extracts multiline and inline addresses only inside franchisee list sections", () => {
  const candidates = candidatesFromAddressBlockLines(
    [
      "Corporate office",
      "100 Noise Street",
      "Chicago, IL 60601",
      "EXHIBIT F",
      "Current Franchisees",
      "Gilbert, AZ",
      "Caruso Enterprises, LLC",
      "3073 E Ray Rd Suite 103, Gilbert, AZ 85295",
      "North Scottsdale, AZ",
      "Evolution AZ, LLC*",
      "7325 E. Frank Lloyd Wright Blvd., Suite 102",
      "Scottsdale, AZ 85260",
      "EXHIBIT G",
      "Financial Statements",
      "200 More Noise Road",
      "Dallas, TX 75201",
    ],
    "document-id",
    "Pvolve",
    150,
  );
  assert.deepEqual(
    candidates.map(({ franchiseeEntity, address, city, state, zip }) => [
      franchiseeEntity,
      address,
      city,
      state,
      zip,
    ]),
    [
      ["Caruso Enterprises, LLC", "3073 E Ray Rd Suite 103", "Gilbert", "AZ", "85295"],
      ["Evolution AZ, LLC", "7325 E. Frank Lloyd Wright Blvd., Suite 102", "Scottsdale", "AZ", "85260"],
    ],
  );
});

test("keeps territory-only locations when the FDD does not disclose a street address", () => {
  const candidates = candidatesFromAddressBlockLines(
    [
      "EXHIBIT F",
      "Former Franchisees",
      "Highlands Ranch, CO – Terminated Never Opened",
      "3 Peacocks, LLC",
      "202-413-0358",
    ],
    "document-id",
    "Pvolve",
    200,
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].status, "Former");
  assert.equal(candidates[0].city, "Highlands Ranch");
  assert.equal(candidates[0].address, "Address not disclosed");
});

test("attaches multiline phone and email lines to the preceding address block", () => {
  const candidates = candidatesFromAddressBlockLines(
    ["EXHIBIT F", "Current Franchisees", "Acme Fitness LLC", "100 Main Street", "Denver, CO 80202", "(303) 555-0199", "owner@acme.test"],
    "document-id", "Acme", 214,
    { exhibit: "F", section: "Current Franchisees", printedPage: 201 },
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].phone, "(303) 555-0199");
  assert.equal(candidates[0].email, "owner@acme.test");
  assert.equal(candidates[0].sourcePrintedPage, 201);
});

test("gives every candidate the same normalized franchisor", () => {
  const franchisor = detectFranchisor("Massage Envy Franchising, LLC", "Uploaded FDD");
  const rows = [
    ["Store 1", "123 Main Street", "Austin", "TX", "78701"],
    ["Store 2", "456 Oak Avenue", "Dallas", "TX", "75201"],
  ];
  const candidates = rows.map((cells, index) =>
    candidateFromCells(cells, "document-id", franchisor, index + 1, "Current"),
  );

  assert.deepEqual(
    candidates.map((candidate) => [candidate?.franchiseName, candidate?.franchisor]),
    [
      ["Massage Envy", "Massage Envy"],
      ["Massage Envy", "Massage Envy"],
    ],
  );
});

test("extracts former and planning contact-directory rows without invented addresses", () => {
  const former = candidateFromContactDirectoryCells(
    ["Arizona", "A Touch of Bliss LLC", "Karla Rosser", "480-251-8709"],
    "document-id",
    "Elements Massage",
    211,
    "Former",
    { exhibit: "D2", section: "Franchisees Who Left System" },
  );
  const planning = candidateFromContactDirectoryCells(
    ["Rolesville", "NC", "Pereira and Woo LLC", "Anthony Pereira", "703-624-3393", "X"],
    "document-id",
    "Elements Massage",
    212,
    "Planning",
    { exhibit: "D3", section: "Franchises Sold But Not Yet Opened" },
  );
  assert.deepEqual(
    [former, planning].map((candidate) => [
      candidate?.status,
      candidate?.franchiseeEntity,
      candidate?.city,
      candidate?.state,
      candidate?.address,
      candidate?.phone,
    ]),
    [
      ["Former", "A Touch of Bliss LLC", "Not disclosed", "AZ", "Address not disclosed", "480-251-8709"],
      ["Planning", "Pereira and Woo LLC", "Rolesville", "NC", "Address not disclosed", "703-624-3393"],
    ],
  );
});

test("extracts one territory record per HOTWORX agreement code", () => {
  const candidates = candidatesFromTerritoryDirectoryLines(
    [
      "[[PAGE:204]]",
      "[[STATUS:Former]]",
      "ARIZONA",
      "SWEATY VENTURES, LLC",
      "Rebecca Dillon & Kylee O’Connell",
      "Phoenix (Prescott) DMA",
      "becky.dillon@hotworx.net; kylee.oconnell@hotworx.net",
      "(AZ0001 & AZ0002)",
    ],
    "document-id",
    "HOTWORX",
    204,
    { exhibit: "D", section: "Terminated Franchise Agreements" },
  );
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].franchiseeEntity, "SWEATY VENTURES, LLC");
  assert.equal(candidates[0].city, "Phoenix (Prescott)");
  assert.equal(candidates[0].state, "AZ");
  assert.equal(candidates[0].email, "becky.dillon@hotworx.net");
  assert.match(candidates[1].rawSourceText, /Location code: AZ0002/);
});
