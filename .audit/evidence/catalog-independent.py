import json,hashlib,re,collections,pathlib
root=pathlib.Path(__file__).resolve().parents[2]
sp=root/'apps/mcp/spec/app-store-connect-4.5.1.json'; gp=root/'apps/mcp/src/generated/operations.json'; pp=root/'apps/mcp/spec/provenance.json'
s=json.loads(sp.read_bytes());g=json.loads(gp.read_bytes());p=json.loads(pp.read_bytes())
assert hashlib.sha256(sp.read_bytes()).hexdigest()==p['sha256']==g['sha256']
raw={}
for path,item in s['paths'].items():
 for method,o in item.items():
  if method.lower() not in ('get','post','patch','delete','put','head','options','trace'):continue
  raw[(method.upper(),path,o['operationId'])]=(item,o)
actual={(o['method'],o['path'],o['operationId']):o for o in g['operations']}
assert len(raw)==1303 and raw.keys()==actual.keys()
names=[o['name'] for o in g['operations']];assert len(names)==len(set(names)); assert all(len(n)<=40 and re.fullmatch('[A-Za-z0-9_-]+',n) for n in names)

def refs(x):
 if isinstance(x,dict):
  if '$ref' in x: yield x['$ref']
  for c in x.values():yield from refs(c)
 elif isinstance(x,list):
  for c in x:yield from refs(c)

def conv(x):
 if isinstance(x,list):return [conv(c) for c in x]
 if not isinstance(x,dict):return x
 if x.get('enum',None)==[]:return {'not':{}}
 out={k:conv(v) for k,v in x.items() if k not in ('nullable','discriminator','xml','example','externalDocs','exclusiveMinimum','exclusiveMaximum')}
 if '$ref' in out:out['$ref']=out['$ref'].replace('#/components/schemas/','#/$defs/')
 for bound,exc in [('minimum','exclusiveMinimum'),('maximum','exclusiveMaximum')]:
  if exc in x and x[exc]:out[exc]=x[bound] if isinstance(x[exc],bool) else x[exc]
 if x.get('nullable'):out={'anyOf':[out,{'type':'null'}]}
 return out

count=collections.Counter();requiredQueries=[]
for key,(item,source) in raw.items():
 o=actual[key];sc=o['inputSchema'];props=sc['properties'];params={}
 for q in item.get('parameters',[])+source.get('parameters',[]):params[q['in'],q['name']]=q
 for loc in ('path','query'):
  selected={n:q for (l,n),q in params.items() if l==loc}
  if not selected:assert loc not in props,(key,loc);continue
  assert set(props[loc]['properties'])==set(selected),(key,loc)
  needs={n for n,q in selected.items() if q.get('required') or loc=='path'}
  assert set(props[loc].get('required',[]))==needs,(key,loc)
  assert (loc in sc.get('required',[]))==bool(needs),(key,loc)
  for n,q in selected.items():
   expected=conv(q['schema'])
   if loc=='path': expected.update(minLength=1,pattern='^(?!\\.{1,2}$)')
   assert props[loc]['properties'][n]==expected,(key,n)
  count[loc]+=len(selected)
  if loc=='query': requiredQueries.extend((source['operationId'],n) for n in needs)
 if 'requestBody' in source:
  assert props['body']==conv(source['requestBody']['content']['application/json']['schema']),key
  assert ('body' in sc.get('required',[]))==bool(source['requestBody'].get('required'))
  count['bodies']+=1
 for r in refs(sc):
  assert r.startswith('#/$defs/'),(key,r)
  assert r[len('#/$defs/'):] in sc['$defs'],(key,r)
 for n,component in sc.get('$defs',{}).items():assert component==conv(s['components']['schemas'][n]),(key,n)
 media=set(t for status,response in source['responses'].items() if status.startswith('2') for t in response.get('content',{}))
 assert set(o['responseMedia'])==media,key
 expected='asc_'+source['operationId'];expected=re.sub('[^a-zA-Z0-9_-]','_',expected)
 if len(expected)>40:expected=expected[:31]+'_'+hashlib.sha256(source['operationId'].encode()).hexdigest()[:8]
 assert o['name']==expected,key
 assert o['deprecated']==bool(source.get('deprecated')),key
 count[o['method']]+=1
out={'raw_spec_sha256':hashlib.sha256(sp.read_bytes()).hexdigest(),'generated_sha256':hashlib.sha256(gp.read_bytes()).hexdigest(),'source_checksum_matches_provenance':hashlib.sha256(sp.read_bytes()).hexdigest()==p['sha256'],'coverage':dict(count),'unique_names':len(names),'max_name_length':max(map(len,names)),'required_query_parameters':len(requiredQueries),'required_query_examples':requiredQueries[:6]}
print(json.dumps(out,indent=2))
