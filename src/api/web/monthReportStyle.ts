/** One reading column, with definitions beneath each figure and controls that work without script. */
export const MONTH_REPORT_CSS = String.raw`
.month-report{min-inline-size:0;max-inline-size:var(--measure-prose);font-size:var(--font-size-base);line-height:1.5}
.month-report h1,.month-report h2{overflow-wrap:anywhere}
.month-report h2{font-family:var(--font-family);font-size:var(--font-size-title);line-height:1.3}
.month-report .results-header{margin-block-end:var(--space-32)}
.month-report .results-header p{font-size:var(--font-size-base)}
.month-report .results-section,.month-report .mr-month,.month-report .results-empty{margin-block-end:var(--space-32)}
.month-report .result-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--space-8) var(--space-24)}
.month-report .result-row dt{min-inline-size:0;overflow-wrap:anywhere}
.month-report .result-row dd{font-variant-numeric:tabular-nums;text-align:end;overflow-wrap:anywhere}
.month-report .mr-amounts{display:grid;gap:var(--space-4)}
.month-report .result-row .mr-definition{grid-column:1 / -1;margin:0;text-align:start;font-weight:400}
.month-report .mr-definition p{margin:var(--space-8) 0 0}
.month-report .mr-subrow{margin-inline-start:var(--space-16);border-block-end-color:var(--color-sand)}
.month-report .mr-subrow dt,.month-report .mr-subrow dd{font-size:var(--font-size-small)}
.month-report .mr-picker{display:grid;grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"previous form next";align-items:baseline;gap:var(--space-12);margin-block:var(--space-24)}
.month-report .mr-picker:not(:has(>a)){grid-template-columns:minmax(0,1fr);grid-template-areas:"form"}
.month-report .mr-picker>.back{grid-area:previous;justify-self:start}
.month-report .mr-picker>.deeper{grid-area:next;justify-self:end}
.month-report .mr-month-form{grid-area:form;display:flex;align-items:baseline;gap:var(--space-8);min-inline-size:0;margin:0}
.month-report label{display:block;margin-block-end:var(--space-8)}
.month-report .mr-month-form label{margin:0}
.month-report .mr-month-controls{display:flex;flex:1;min-inline-size:0;gap:var(--space-8);align-items:baseline}
.month-report select{flex:1;min-inline-size:0;inline-size:0}
.month-report input,.month-report select{font:inherit;min-block-size:44px;max-inline-size:100%;box-sizing:border-box}
.month-report a,.month-report summary{min-block-size:44px;align-content:center}
.month-report .mr-minutes{border-block-start:1px solid var(--color-border);padding-block:var(--space-16);margin-block-end:var(--space-24)}
.month-report .results-section[aria-labelledby="month-handed"]+.mr-minutes{border-block-start:0}
.month-report summary{cursor:pointer;font-weight:600}
.month-report .pform{margin-block-start:var(--space-16);max-inline-size:var(--measure-form)}
.month-report .pform input{display:block;inline-size:6rem}
.month-report .mr-formula{font-variant-numeric:tabular-nums;text-align:match-parent;overflow-wrap:anywhere}
.month-report .btn{min-block-size:44px;max-inline-size:100%;white-space:normal}
.month-report .btn.send{background:var(--color-ink);border-color:var(--color-ink);color:var(--color-surface)}
/* The same four doors appear on every Results view. */
.tabs:has(> .tab[href="/app/results/month"]){flex-wrap:wrap;overflow:visible}
.tabs:has(> .tab[href="/app/results/month"]) .tab{min-block-size:44px;white-space:normal;align-content:center}
@media(max-width:600px){
 .month-report .mr-picker{grid-template-columns:repeat(2,minmax(0,1fr));grid-template-areas:"previous next" "form form"}
 .month-report .result-row{column-gap:var(--space-12)}
}
`;
