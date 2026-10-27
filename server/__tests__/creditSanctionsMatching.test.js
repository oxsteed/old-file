'use strict';

/**
 * In-house name matching and list parsers (no database). Fixtures are cut
 * from the official OFAC, UN, EU and UK publications; the SEMA fixture is a
 * synthetic sample in the published layout.
 */

const fs = require('fs');
const path = require('path');
const { normalizeName, nameSimilarity } = require('../services/creditCompliance/nameMatching');
const parsers = require('../services/creditCompliance/sanctions/parsers');

const FIX = path.join(__dirname, 'fixtures', 'sanctions');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');

describe('name normalisation and similarity', () => {
  test('folds accents, punctuation and case', () => {
    expect(normalizeName('  Jîmmy  CHÉRIZIER, ')).toBe('jimmy cherizier');
    expect(normalizeName("Jean-Marie O'Neil")).toBe('jean marie oneil');
  });

  test.each([
    ['Jimmy Cherizier', 'CHERIZIER, Jimmy'],
    ['Jimmy Jean Cherizier', 'Jimmy Cherizier'],
    ['Jimy Cherisier', 'Jimmy Cherizier'],
    ['Mohamed Ali', 'Ali Mohammed'],
  ])('%s is close to %s', (a, b) => {
    expect(nameSimilarity(a, b)).toBeGreaterThanOrEqual(0.88);
  });

  test.each([
    ['Marie Joseph', 'Michel Joseph Martelly'],
    ['Rose Marie Jean', 'Jean-Marie Rugerero'],
    ['Jean Baptiste', 'Jean Bertrand Aristide'],
  ])('%s is not a match for %s', (a, b) => {
    expect(nameSimilarity(a, b)).toBeLessThan(0.88);
  });
});

describe('official list parsers', () => {
  test('OFAC CSV with aliases and reordered individual names', () => {
    const { entries } = parsers.parseOfacCsv(read('ofac_sdn.csv'), read('ofac_alt.csv'));
    const bank = entries.find((e) => e.externalId === '306');
    expect(bank.entryType).toBe('entity');
    expect(bank.aliases.map((a) => a.name)).toEqual(expect.arrayContaining(['NATIONAL BANK OF CUBA', 'BNC']));
    const person = entries.find((e) => e.primaryName === 'CHERIZIER, Jimmy');
    expect(person.entryType).toBe('individual');
    expect(person.aliases.map((a) => a.name)).toContain('Jimmy CHERIZIER');
    expect(person.birthDates[0]).toMatch(/1977/);
  });

  test('UN consolidated list includes the Haiti regime', () => {
    const { entries, publishedAt } = parsers.parseUnXml(read('un.xml'));
    expect(publishedAt).toMatch(/^\d{4}-/);
    const ht = entries.filter((e) => e.programs.includes('Haiti'));
    expect(ht.length).toBe(4);
    expect(ht[0]).toMatchObject({ externalId: 'HTi.001', primaryName: 'JIMMY CHERIZIER', entryType: 'individual' });
    expect(ht[0].aliases[0]).toMatchObject({ name: 'BARBEQUE', strength: 'weak' });
  });

  test('EU, UK and SEMA lists', () => {
    expect(parsers.parseEuXml(read('eu.xml')).entries[0]).toMatchObject({ externalId: 'EU.27.28', entryType: 'individual', countries: ['IQ'] });
    const uk = parsers.parseUkXml(read('uk.xml')).entries;
    expect(uk.map((e) => e.entryType)).toEqual(['entity', 'individual']);
    expect(uk[1].birthDates.length).toBeGreaterThan(0);
    const sema = parsers.parseSemaXml(read('sema.xml')).entries;
    expect(sema[0]).toMatchObject({ entryType: 'individual', primaryName: 'Jean Baptiste Testlisted', countries: ['Haiti'] });
    expect(sema[1].entryType).toBe('entity');
  });

  test('broken documents are refused, never parsed as empty lists', () => {
    expect(() => parsers.parseUnXml('<html>maintenance</html>')).toThrow();
    expect(() => parsers.parseEuXml('<foo/>')).toThrow();
    expect(() => parsers.parseUkXml('<foo/>')).toThrow();
  });

  test('CSV parser handles quotes, commas and CRLF', () => {
    expect(parsers.parseCsv('1,"a, ""b""",c\r\n2,x,y\n')).toEqual([['1', 'a, "b"', 'c'], ['2', 'x', 'y']]);
  });
});
