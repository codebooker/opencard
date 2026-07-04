import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, guessMapping, mapCsvRow, CsvTarget } from "./csvimport";

test("parseCsv handles quotes, escaped quotes, commas, CRLF and BOM", () => {
  const rows = parseCsv('﻿name,title\r\n"Lopez, Maria","Sales ""Star"""\nBob,\n');
  assert.deepEqual(rows, [
    ["name", "title"],
    ["Lopez, Maria", 'Sales "Star"'],
    ["Bob", ""],
  ]);
});

test("parseCsv ignores trailing blank lines but keeps empty cells", () => {
  assert.deepEqual(parseCsv("a,b\n,\n\n"), [
    ["a", "b"],
    ["", ""],
  ]);
});

test("guessMapping recognizes common header spellings", () => {
  assert.deepEqual(guessMapping(["First Name", "LAST_NAME", "E-mail Address", "Job Title", "Dept", "Cell Phone", "Store Code", "Notes"]), [
    "firstName",
    "lastName",
    "email",
    "title",
    "department",
    "phoneMobile",
    "location",
    "",
  ]);
});

test("mapCsvRow builds a candidate and splits full names", () => {
  const mapping: CsvTarget[] = ["name", "email", "title", "phoneWork"];
  const c = mapCsvRow(mapping, ["Maria Q Lopez", "Maria@Acme.com", "GM", "+1 555 0100"])!;
  assert.equal(c.email, "maria@acme.com");
  assert.equal(c.firstName, "Maria");
  assert.equal(c.lastName, "Q Lopez");
  assert.equal(c.title, "GM");
  assert.deepEqual(c.phones, [{ label: "Work", value: "+1 555 0100" }]);
  assert.equal(c.enabled, true);
});

test("mapCsvRow rejects rows without a usable email", () => {
  const mapping: CsvTarget[] = ["name", "email"];
  assert.equal(mapCsvRow(mapping, ["No Email", ""]), null);
  assert.equal(mapCsvRow(mapping, ["Bad Email", "not-an-email"]), null);
});
