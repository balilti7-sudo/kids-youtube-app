'use strict';
const CHANNEL = /^UC[A-Za-z0-9_-]{22}$/;
const VIDEO = /^[A-Za-z0-9_-]{11}$/;
function check(result) { if (result.error) throw new Error('Catalog storage unavailable'); return result.data; }
function channelForPlaylist(id) {
  if (/^UU[A-Za-z0-9_-]{22}$/.test(id)) return 'UC' + id.slice(2);
  if (/^UUSH[A-Za-z0-9_-]{22}$/.test(id)) return 'UC' + id.slice(4);
  return null;
}
function createRegistry(db) {
  async function lookup(request) {
    if (request.endpoint==='videos' && request.params.has('id')) {
      const ids=request.params.get('id').split(',');
      const rows=check(await db.from('youtube_videos_registry').select('video_id,payload')
        .in('video_id',ids).gt('refreshed_at',new Date(Date.now()-5*60_000).toISOString()));
      const parts=request.params.get('part').split(',');
      if(rows.length===ids.length&&rows.every(row=>parts.every(p=>p==='id'||row.payload[p]!=null)))return {items:rows.map(row=>row.payload)};
    }
    if (request.endpoint === 'search' && request.params.get('type') === 'channel' && !request.params.has('pageToken')) {
      const query = request.params.get('q')?.trim();
      if (!query || query.length > 200) return null;
      const rows = check(await db.from('youtube_channels_registry').select('channel_id,payload')
        .gt('refreshed_at', new Date(Date.now()-7*86400_000).toISOString())
        .textSearch('search_document', query, {type:'plain',config:'simple'})
        .order('channel_id').limit(Number(request.params.get('maxResults') || 15)));
      // A local match is a directory result, not a complete YouTube search.
      return rows.length ? {items:rows.map(row=>({id:{channelId:row.channel_id},snippet:row.payload.snippet})),
        safeTubeSource:'registry'} : null;
    }
    if (request.endpoint === 'channels' && request.params.has('id')) {
      const ids = request.params.get('id').split(',');
      const rows = check(await db.from('youtube_channels_registry').select('channel_id,payload')
        .in('channel_id',ids).gt('refreshed_at',new Date(Date.now()-86400_000).toISOString()));
      const parts = request.params.get('part').split(',');
      if (rows.length===ids.length && rows.every(row=>parts.every(p=>p==='id'||row.payload[p]!=null))) {
        return {items:rows.map(row=>row.payload),safeTubeSource:'registry'};
      }
    }
    return null;
  }
  async function remember(request,payload) {
    if (request.endpoint === 'videos' && request.params.has('id')) {
      const returned = new Set((payload.items||[]).map(item=>item.id));
      const missing = request.params.get('id').split(',').filter(id=>VIDEO.test(id)&&!returned.has(id));
      // A successful upstream response omitting a requested ID must invalidate
      // its previous individual metadata (deleted/private/unavailable).
      if (missing.length) check(await db.from('youtube_videos_registry').delete().in('video_id',missing));
    }
    if (request.endpoint === 'channels') {
      const rows = (payload.items||[]).filter(item=>CHANNEL.test(item.id)&&typeof item.snippet?.title==='string')
        .map(item=>({channel_id:item.id,title:item.snippet.title,handle:item.snippet.customUrl||'',
          payload:item,refreshed_at:new Date().toISOString()}));
      if (rows.length) {
        check(await db.from('youtube_channels_registry').upsert(rows));
        check(await db.from('youtube_websub_subscriptions').upsert(rows.map(r=>({channel_id:r.channel_id})),{ignoreDuplicates:true}));
      }
    }
    const channels = new Set();
    const direct = request.params.get('channelId') || channelForPlaylist(request.params.get('playlistId')||'');
    if (CHANNEL.test(direct||'')) channels.add(direct);
    for (const item of payload.items||[]) {
      const id = request.endpoint==='channels' ? item.id : item.snippet?.channelId;
      if (CHANNEL.test(id||'')) channels.add(id);
    }
    if (!channels.size) return;
    const known = check(await db.from('youtube_channels_registry').select('channel_id').in('channel_id',[...channels]));
    if (known.length) check(await db.from('youtube_catalog_channels').upsert(known.map(row=>({cache_key:request.key,channel_id:row.channel_id}))));
    if (request.endpoint === 'videos') {
      // Reuse individual video metadata across differently batched requests.
      // A playlist/search snippet is not a videos.list payload; never store it
      // here as though it contained duration/statistics or a verified video ID.
      const knownIds = new Set(known.map(row=>row.channel_id));
      const rows = (payload.items||[]).filter(item=>VIDEO.test(item.id)&&knownIds.has(item.snippet?.channelId))
        .map(item=>({video_id:item.id,channel_id:item.snippet.channelId,payload:item,refreshed_at:new Date().toISOString()}));
      if (rows.length) check(await db.from('youtube_videos_registry').upsert(rows));
    }
  }
  return {lookup,remember};
}
module.exports={createRegistry,channelForPlaylist,CHANNEL,VIDEO,check};
