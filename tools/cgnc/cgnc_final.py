import json, re, sys
S=sys.argv[1]
pages=json.load(open(S+'merged.json'))
fix={}; drop=set()
for line in open(S+'corrections.txt'):
    line=line.rstrip('\n')
    if not line or line.startswith('#'): continue
    if line.startswith('-'): drop.add(line[1:]); continue
    c,t=line.split('|',1); fix[c]=t
final={}; undecided=[]
for p,rows in pages.items():
    for mark,c,t in rows:
        if c in drop or '/' in c: continue
        if c in fix: title=fix[c]
        elif mark=='?': undecided.append((p,c,t)); title=t.split('  ‖  ')[0]
        else: title=t
        title=re.sub(r'\(\s+','(',title); title=re.sub(r'\s+\)',')',title); title=re.sub(r'\s+',' ',title).strip()
        title=title.rstrip(".'").strip()
        if not title: continue           # a number the CGNC leaves empty (12., 18., 46. …)
        final.setdefault(c,(title,int(p)))
for c,t in fix.items():
    if c not in final: final[c]=(t,0)
print('undecided:',undecided)
codes=sorted(final)
# every code's parent: the longest shorter prefix present
def parent(c):
    for n in range(len(c)-1,0,-1):
        if c[:n] in final: return c[:n]
    return None
orphans=[c for c in codes if len(c)>2 and parent(c) is None]
print(len(codes),'accounts; orphans',orphans)
odd=[(c,final[c][0]) for c in codes if re.search(r'[^\w\s\'’(),.:;"/+\-–àâäçéèêëîïôöùûüÀÂÄÇÉÈÊËÎÏÔÖÙÛÜ]',final[c][0])]
print('odd characters',odd)
json.dump({c:{'title':final[c][0],'page':final[c][1],'parent':parent(c)} for c in codes},open(S+'cgnc-final.json','w'),ensure_ascii=False,indent=0)
