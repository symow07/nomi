import re, sys, json
text=open(sys.argv[1]).read()
# the normal model only: from its title page to the simplified model's
start=text.index('=== PAGE 257'); end=text.index('=== PAGE 316')
body=text[start:end]
items=[]; page=None; flagged=[]
cur=None
for raw in body.split('\n'):
    line=raw.strip()
    m=re.match(r'=== PAGE (\d+)',line)
    if m: page=int(m.group(1)); cur=None; continue
    if not line: continue
    line=line.replace(' | ',' ').replace('|',' ')
    m=re.match(r'^([0-9IlO]{2,6}(?:/[0-9]{2,3})?)\s*\.\s*(.*)$',line)
    if m:
        code,title=m.group(1),m.group(2).strip()
        if re.search(r'[IlO]',code): flagged.append((page,line,'letter in code')); code=code.replace('I','1').replace('l','1').replace('O','0')
        cur={'code':code,'title':title,'page':page}; items.append(cur); continue
    # a page number, a class heading, or a title's continuation
    if re.fullmatch(r'\d{1,3}',line) or re.match(r'^CL ?A ?S ?S ?E',line) or line.startswith('COMPTES D'): cur=None; continue
    if cur is not None and not re.match(r'^\d',line): cur['title']+=' '+line
    else: flagged.append((page,line,'unplaced'))
json.dump({'items':items,'flagged':flagged},open(sys.argv[2],'w'),ensure_ascii=False,indent=0)
print(len(items),'codes;',len(flagged),'flagged')
