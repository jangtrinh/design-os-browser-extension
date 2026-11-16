import json,glob,re,hashlib,os
H=lambda s:hashlib.sha256(s.encode()).hexdigest()[:8]
JANG={'05-observe-profile','06-observe-analytics-content','07-observe-analytics-content-settled','13-observe-recent-activity','16-observe-post','29-observe-post-full','30-observe-post-full-settled'}
THIRD={'09-observe-profile-views','10-observe-profile-views-settled','19-observe-search','22-observe-search-result-profile'}
allow=set()
for f in JANG: 
    for n in json.load(open(f'raw/{f}.json'))['data']['nodes']: allow.add(n['name'])
METRIC=re.compile(r'^[\d,.+]+\s*(reactions?|comments?|impressions?|followers|connections|reposts?)?$|^(Search|Message|Follow|Connect|More|Show all|Next|Previous|Page \d+|\d+)$',re.I)
def url(u,third):
    u=re.sub(r'/in/(?!jangtrinh/)([^/?#"]+)',lambda m:f'/in/[member:{H(m.group(1))}]',u)
    if third and '?' in u and 'keywords=design%20system' not in u: u=u.split('?')[0]+'?[query-redacted]'
    if 'messaging/compose' in u: u=u.split('?')[0]+'?[query-redacted]'
    return u
def scrub(s,third):
    s=re.sub(r'[\w.+-]+@[\w-]+\.[\w.]+','[email-redacted]',s)
    s=re.sub(r'(?<!\d)0\d{2,3}[ .]?\d{3}[ .]?\d{3,4}(?!\d)','[phone-redacted]',s)
    s=re.sub(r'https?://[^\s"\)]+',lambda m:url(m.group(0),third),s)
    s=re.sub(r'(vanityName|recipient|profileUrn)=[^&\s"\)]+',lambda m:m.group(1)+'=[redacted:'+H(m.group(0))+']',s)
    s=re.sub(r'(?<![\w/])/in/(?!jangtrinh/)(?!\[member)([^/?#"\s]+)',lambda m:'/in/[member:'+H(m.group(1))+']',s)
    return s
def walk(o,third):
    if isinstance(o,dict): return {k:walk(v,third) for k,v in o.items()}
    if isinstance(o,list): return [walk(v,third) for v in o]
    if isinstance(o,str): return scrub(o,third)
    return o
for p in sorted(glob.glob('raw/*.json')):
    f=os.path.basename(p)[:-5]; d=json.load(open(p)); third=f in THIRD
    if third:
        for n in d['data']['nodes']:
            if n['name'] not in allow and not METRIC.match(n['name'].strip()):
                n['name']=f'[redacted:{H(n["name"])}]'
        d['data']['compactText']='\n'.join(f'[ref={n["ref"]}] {n["role"]} "{n["name"]}"'+(f' (href={n["href"]})' if n.get('href') else '') for n in d['data']['nodes'])
        if not d['data']['title'].endswith(('Search | LinkedIn','Profile Viewers | LinkedIn')): d['data']['title']=f'[redacted:{H(d["data"]["title"])}] | LinkedIn'
        d['_redaction']='Third-party names/headlines hashed (sha256[:8]); profile slugs hashed; query strings dropped; compactText regenerated from redacted nodes.'
    if f.startswith(('20-','21-')):
        for k in ('publicIdentifier','fullName'): d['data'][k]=f'[member:{H(d["data"][k])}]'
        d['data']['url']=url(d['data']['url'],True); d['_redaction']='Third-party profile: identifier and name hashed.'
    if f=='25-cache-profiles':
        for r in d['rows']:
            if r['public_identifier']!='jangtrinh':
                for k in ('public_identifier','full_name'): r[k]=f'[member:{H(r[k])}]'
        d['_redaction']='Non-Jang rows hashed.'
    if f=='28-cache-events':
        d['_note']='These 8 events come from the earlier logged-out throwaway-profile smoke test (Cloudflare challenge + authwall), not from the signed-in pilot.'
    d=walk(d,third)
    json.dump(d,open(f'redacted/{f}.json','w'),indent=2,ensure_ascii=False)
print('ok')
