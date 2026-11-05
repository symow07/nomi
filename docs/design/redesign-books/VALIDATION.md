# Books browser review

This is local browser evidence for the Books redesign. The before application is the frozen final Products build; the after application uses the final Books compiled routes. Both use separate synthetic database clones and owned ports. Existing runtimes were preserved.

## Coverage

The comparison contains 68 states at 1440×900 and 390×844: 136 before visits and 136 after visits. Twenty additional after visits cover the new settings, supporting money reports, history list and guided draft destinations. The matrix includes all 22 Books manifest rows, old inline anchors, year-end sections, empty/unconfigured/configured-zero states, complete large lists, document work states, issued/draft invoices and credits, currency/refund/transfer fixtures and owner/accountant/staff/Books-disabled views. New destinations are compared to their old source surface rather than described as previously existing pages.

After visits show no horizontal document overflow or browser page error. The before unreadable-paper phone page has a 19 px overflow from the old state label. English-only rendering was used throughout.

## Money and complete queues

The synthetic tenant has 113 invoices, 205 unmatched statement lines and 212 encrypted originals, including 209 pending work items. Browser paging reaches all 113 invoices, 109 overdue invoices, 205 unmatched lines and 209 pending papers once, across 3/3/5/5 pages respectively. This exercises rows beyond the former 100/200 caps.

Independent posted records and SQL establish the expected current-workspace-day figures: Received 480 USD, Paid out 46 USD, customers owe 315 USD plus 30 EUR, refund due 75 USD separately, supplier owed 32 USD with 10 USD advances separately, and fiscal-year profit 692 USD. Transfers, opening money, future dated invoice/payment/credit and unposted drafts are exercised. The owner-selected cash/bank and payable accounts are carried through the supporting readers. An absent scope says Choose accounts; a configured real zero says 0.00. Foreign/invalid scope never becomes a fabricated zero.

A separate boundary fixture issues 17.25 USD on the workspace's Nov 6 day while UTC is Nov 5. Before the fix the interface displayed Nov 5 and omitted it. The final interface displays Nov 6 and includes 17.25 in both owed and profit.

Nineteen financial/source tables for the comparison tenant have identical row counts and hashes in frozen before and after clones following the read-only passes. Actual workflow writes use another synthetic tenant.

## Browser actions and existing safeguards

Twenty read-only checks cover the five figures, complete paging, source links, scope retention, exact list/page/row return, phone chooser Escape/focus/outside click, legacy hash moves, exact guided entry/paper relation, original preview/download, accountant read-only controls, staff and Books-disabled availability, and reachable phone forms without JavaScript.

Seven actual synthetic receipt checks cover upload without reading/posting; one explicit scripted read without entry creation; missing supplier refusal retaining account choices; one explicit draft with exact entry URL; an invalid edit retaining typed date/reference; saving changes while still a draft; and explicit Save to the books posting exactly once. A repeated post adds no entry. The saved original still decodes. Four final checks verify Add receipt reaches the upload with script on/off and visible guided fields/save actions have 44 px minimum dimensions.

The original document can be previewed inline by permitted readers; the attachment endpoint remains. Issued document print output was generated as A4 PDF and rendered for visual inspection. The final invoice and credit note omit application navigation and commands. Issuer details are explicitly current business details; the document does not imply they were copied when issued.

## Moves

| Former surface | Current destination |
|---|---|
| Books home inline connections | Settings → Books → Connections |
| Sales/payment accounts and chart | Settings → Books → Accounts; chart remains under Advanced when offered |
| Current legal/tax details and confirmed imported tax dates | Settings → Books → Tax and business details |
| Starting balances | Settings → Books → Starting balances |
| Extra fields | Settings → Books → Extra fields |
| Papers | Books → Spending; original attachment endpoint kept |
| Entries and trial balance | Books → Advanced |
| Closing, lock/reopen and retained history | Books → Year-end |
| FEC and supporting money readers | Books → Reports; existing country availability retained |

Old GET paths and known home fragments bridge to their canonical destination. Existing command endpoints remain authoritative. No connector is read automatically on the settings GET pages. A source may request a tax start date only through its existing read-refusal response; confirmed dates are listed without inventing a pending request.

## Limits

These checks use local synthetic records, encrypted local originals, scripted reading, provider disabled, no workers, blocked external fetch and blocked outbound/drive work. One scripted document read was requested in the final command pass; no paid/live model, network store/import, production service or customer send was exercised. Real connector responses, live external reading and production accounting data were not used. Repository-wide checks and release gates are separate.

## Repository verification

Node 22: `npm run check` passed 9,300 assertions; `npm run trust` passed 44; `npm run build` passed; the full `tools/run-integration-isolated.mjs` run passed 2,058 of 2,058 with none skipped. The initial full run caught ten old Books GET aliases redirecting before the login check. Those aliases now authenticate first; focused public-route checks and the complete isolated rerun passed.
