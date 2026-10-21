import { excelConnector } from '../../src/books/connectors/excel.js';
import { conformance } from './conformance.js';
import { SAMPLE_BOOKS, SAMPLE_WITH_FIELDS } from './sample.js';

/** B2 — the Nomi workbook passes the same conformance suite as the fake (B1's done-criterion). */
const excel = excelConnector('MAD');
conformance({
  name: 'the Nomi workbook (Excel, by file)',
  connector: excel,
  sample: SAMPLE_WITH_FIELDS,
  connectTo: (data) => ({ workbook: excel.fromBooks(data) }),
  refusedWith: { values: { workbook: Buffer.from('Code,Name\n3421,Clients\n') }, reason: 'not_a_nomi_workbook' },
});
