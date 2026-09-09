'use strict';
const { createHash, randomUUID } = require('node:crypto');
const ENDPOINTS = new Set(['channels', 'videos', 'playlistItems', 'playlists', 'search']);
const FIELDS = {
  channels: new Set(['part','id','forHandle','forUsername','maxResults','pageToken']),
  videos: new Set(['part','id','maxResults']),
  playlistItems: new Set(['part','playlistId','pageToken','maxResults']),
  playlists: new Set(['part','id','channelId','pageToken','maxResults']),
  search: new Set(['part','channelId','pageToken','maxResults','q','type','order','videoDuration']),
};
function canonicalRequest(endpoint, input) {
  if (!ENDPOINTS.has(endpoint) || !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid request');
  const params = new URLSearchParams();
  for (const name of Object.keys(input).sort()) {
    if (!FIELDS[endpoint].has(name) || typeof input[name] !== 'string' || input[name].length > 600) throw new Error('Invalid parameter');
    let value = input[name].trim();
    if (name === 'id' || name === 'part') value = [...new Set(value.split(',').map(v=>v.trim()).filter(Boolean))].sort().join(',');
    if (name === 'q') value = value.replace(/\s+/g, ' ');
    params.set(name, value);
  }
  if (!params.has('part') || [...params.get('part').split(',')].some(p=>!['snippet','statistics','contentDetails','id'].includes(p))) throw new Error('Invalid part');
  if (params.has('maxResults') && !/^(?:[1-9]|[1-4][0-9]|50)$/.test(params.get('maxResults'))) throw new Error('Invalid size');
  if (endpoint === 'videos' && !/^[\w-]{11}(,[\w-]{11}){0,49}$/.test(params.get('id') || '')) throw new Error('Invalid videos');
  if (endpoint === 'playlistItems' && !/^[\w-]{10,80}$/.test(params.get('playlistId') || '')) throw new Error('Invalid playlist');
  if (endpoint === 'search' && !(params.get('q') || params.get('channelId'))) throw new Error('Missing query');
  const canonical = endpoint + '?' + params;
  return { endpoint, params, key: createHash('sha256').update(canonical).digest('hex'), bucket: endpoint === 'search' ? 'search' : 'read' };
}
function createCatalog({ store, fetchUpstream, registry, now = Date.now }) {
  const memory = new Map();
  const pending = new Map();
  const metrics = { requests:0, memoryHits:0, sharedHits:0, upstream:0, stale:0, unavailable:0 };
  async function resolve(request) {
    metrics.requests++;
    const cached = memory.get(request.key);
    if (cached && cached.expires > now()) {metrics.memoryHits++;return cached.value;}
    if (pending.has(request.key)) return pending.get(request.key);
    if (pending.size >= 32) {metrics.unavailable++;return null;}
    const work = (async () => {
      if (registry) {
        try {
          const local = await registry.lookup(request);
          if (local) {
            const value={payload:local,stale:false};
            if(memory.size>=500)memory.delete(memory.keys().next().value);
            memory.set(request.key,{value,expires:now()+60_000});
            return value;
          }
        } catch { /* The normal catalog can still serve an existing response. */ }
      }
      const owner = randomUUID();
      const row = await store.claim(request.key, owner, request.bucket === 'search' ? 3600 : 1800);
      const fallback = row.payload ? {payload:row.payload, stale:true} : null;
      let value;
      if (!row.acquired) {
        metrics.sharedHits++;
        const age = now() - Date.parse(row.refreshedAt || '');
        value = row.payload ? {payload:row.payload, stale:Boolean(row.invalidated) || age > (request.bucket === 'search' ? 3600 : 1800)*1000} : null;
      } else {
        let payload = null; let quotaError = false;
        try {
          if (await store.takeBudget(request.bucket)) {
            metrics.upstream++;
            const response = await fetchUpstream(request);
            quotaError = response.quotaError === true;
            if (response.ok && response.payload && Array.isArray(response.payload.items)) payload = response.payload;
          }
        } catch { /* Serve previous public metadata on temporary upstream failure. */ }
        finally {await store.finish(request.key,owner,payload,request.bucket,quotaError);}
        value = payload ? {payload, stale:false} : fallback;
      }
      if (registry && value && !value.stale) {
        try { await registry.remember(request,value.payload); } catch { metrics.registryErrors=(metrics.registryErrors||0)+1; }
      }
      if (value?.stale) metrics.stale++;
      if (!value) metrics.unavailable++;
      // Bounded memory in each replica, durable cache and refresh leases in Postgres.
      if (memory.size >= 500) memory.delete(memory.keys().next().value);
      memory.set(request.key,{value,expires:now()+(value ? 60_000 : 2000)});
      return value;
    })();
    pending.set(request.key,work);
    try {return await work;} finally {pending.delete(request.key);}
  }
  return {resolve, metrics};
}
function registerYoutubeCatalog(app) {
  if (process.env.YOUTUBE_CATALOG_ENABLED !== '1') return;
  const apiKey = process.env.YOUTUBE_CATALOG_API_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!apiKey || !serviceKey || !supabaseUrl) throw new Error('YouTube catalog server configuration missing');
  const {createClient} = require('@supabase/supabase-js');
  const db = createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const rpc = async (name,args) => {const result=await db.rpc(name,args);if(result.error)throw new Error('Catalog storage unavailable');return result.data;};
  const store = {
    claim:(key,owner,fresh)=>rpc('catalog_claim',{p_key:key,p_owner:owner,p_fresh_seconds:fresh}),
    takeBudget:bucket=>rpc('catalog_take_budget',{p_bucket:bucket}),
    finish:(key,owner,payload,bucket,quota)=>rpc('catalog_finish',{p_key:key,p_owner:owner,p_payload:payload,p_bucket:bucket,p_quota_error:quota}),
  };
  const registry = process.env.YOUTUBE_REGISTRY_ENABLED === '1' ? require('./youtube-registry.cjs').createRegistry(db) : null;
  const catalog = createCatalog({store,registry,fetchUpstream:async request=>{
    const url=new URL('https://www.googleapis.com/youtube/v3/'+request.endpoint);
    url.search=request.params.toString();url.searchParams.set('key',apiKey);
    const response=await fetch(url,{signal:AbortSignal.timeout(8000)});
    const payload=await response.json();
    const reasons=payload?.error?.errors?.map(e=>e.reason)||[];
    if (!response.ok) console.info('[youtube-api-error]', JSON.stringify({endpoint:request.endpoint,bucket:request.bucket,status:response.status,reasons}));
    return {ok:response.ok,payload,quotaError:reasons.some(r=>['quotaExceeded','dailyLimitExceeded'].includes(r))};
  }});
  // Validation is cached briefly per credential, never shared through public CDN caches.
  const authCache = new Map();
  app.post('/api/youtube/catalog/:endpoint', async (req,res)=>{
    res.set('Cache-Control','private, no-store');
    let request;
    try {request=canonicalRequest(req.params.endpoint,req.body);}catch{return res.status(400).json({error:{message:'Invalid catalog request'}});}
    const authorization=String(req.headers.authorization||'');
    if(authorization.length>4096||! /^(Bearer|Child) \S+$/.test(authorization))return res.status(401).json({error:{message:'Authentication required'}});
    // Discovery across families is a parent operation, never child authorization.
    if (authorization.startsWith('Child ') && request.endpoint==='search' && request.params.get('type')==='channel') {
      return res.status(403).json({error:{message:'Parent authentication required'}});
    }
    const authKey=createHash('sha256').update(authorization).digest('hex');
    let identity=authCache.get(authKey);
    try {
      if(!identity || identity.expires<Date.now()) {
        const [kind,token]=authorization.split(' ');
        let valid=false;
        if(kind==='Bearer'){const r=await db.auth.getUser(token);valid=Boolean(!r.error&&r.data.user);}
        else {const r=await rpc('child_get_device_state',{p_access_token:token});valid=Array.isArray(r)&&r.length>0&&!r[0].is_blocked;}
        if(!valid)return res.status(401).json({error:{message:'Authentication required'}});
        if(authCache.size>=10_000)authCache.delete(authCache.keys().next().value);
        identity={expires:Date.now()+30_000,count:0};authCache.set(authKey,identity);
      }
      if(++identity.count>120)return res.status(429).set('Retry-After','30').json({error:{message:'Please retry shortly'}});
      const result=await catalog.resolve(request);
      if(!result)return res.status(503).set('Retry-After','2').json({error:{message:'הרשימה מתעדכנת. נסו שוב בעוד זמן קצר.'}});
      res.set('X-SafeTube-Catalog-Stale',result.stale?'1':'0');
      return res.json(result.payload);
    }catch{return res.status(503).set('Retry-After','10').json({error:{message:'עדכון הרשימה אינו זמין כרגע. נסו שוב.'}});}
  });
  // Operational counters contain no keys, tokens, users, or search text.
  const timer=setInterval(()=>console.log('[catalog-metrics]',JSON.stringify(catalog.metrics)),60_000);timer.unref();
}
module.exports={canonicalRequest,createCatalog,registerYoutubeCatalog};
