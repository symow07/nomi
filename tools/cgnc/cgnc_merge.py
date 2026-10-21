import json, re, unicodedata, sys
S=sys.argv[1]
a=json.load(open(S+'normal.json'))['items']; b=json.load(open(S+'normal2.json'))['items']
def norm(t): return re.sub(r'[^a-z0-9]','',unicodedata.normalize('NFKD',t.lower()).encode('ascii','ignore').decode())
def clean(t):
    t=re.sub(r'(\w)- (\w)', r'\1\2', t)        # a word hyphenated at a line's end
    return re.sub(r'\s+',' ',t).strip()
A={}; B={}
for i in a: A.setdefault(i['code'],i)
for i in b: B.setdefault(i['code'],i)
pages={}
for c in sorted(set(A)|set(B), key=lambda c:(min(x['page'] for x in (A.get(c),B.get(c)) if x), c)):
    x=A.get(c); y=B.get(c)
    if x and y and norm(x['title'])==norm(y['title']): t=clean(x['title']); mark=' '
    elif x and y: t=f"{clean(x['title'])}  ‖  {clean(y['title'])}"; mark='?'
    else: t=clean((x or y)['title']); mark='1' if x else '2'
    p=(x or y)['page']
    pages.setdefault(p,[]).append((mark,c,t))
json.dump({str(k):v for k,v in pages.items()},open(S+'merged.json','w'),ensure_ascii=False)
for p in sys.argv[2:]:
    print(f'--- page {p}')
    for m,c,t in pages.get(int(p),[]): print(f'{m} {c}. {t}')
