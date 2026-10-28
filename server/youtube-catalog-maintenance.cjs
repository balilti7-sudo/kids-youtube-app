'use strict';
const DAY=86400_000;
function check(result) {
  if(result.error) {
    const code=String(result.error.code||result.status||'network').replace(/[^\w-]/g,'').slice(0,32);
    throw Object.assign(new Error('Catalog maintenance request failed'),{code});
  }
  return result.data;
}

// Only disposable public metadata is touched. No approvals, users or playlists.
// Recheck the cutoff on DELETE so a concurrent refresh cannot be deleted after
// the initial SELECT. Bound every batch to keep maintenance off the hot path.
async function pruneCatalog(db, now=Date.now()) {
  const totals={};
  const specs=[
    ['youtube_catalog_cache','cache_key',7],
    ['youtube_videos_registry','video_id',29],
    ['youtube_channels_registry','channel_id',29],
  ];
  for(const [table,key,days] of specs) {
    const cutoff=new Date(now-days*DAY).toISOString();
    const expired=query=>{
      let result=query.lt('refreshed_at',cutoff);
      if(table==='youtube_catalog_cache')result=result.or(`lease_until.is.null,lease_until.lt.${new Date(now).toISOString()}`);
      return result;
    };
    const rows=check(await expired(db.from(table).select(key)).order('refreshed_at').limit(500));
    if(rows.length)check(await expired(db.from(table).delete().in(key,rows.map(row=>row[key]))));
    totals[table]=rows.length;
  }
  return totals;
}
function startCatalogMaintenance(db) {
  let running=false;
  let stopped=false;
  let timer;
  const cycle=async()=>{
    if(running||stopped)return;
    running=true;
    let delay=3600_000;
    try {console.info('[catalog-maintenance]',JSON.stringify(await pruneCatalog(db)));}
    catch(error) {
      delay=60_000;
      console.warn('[catalog-maintenance] cleanup failed; retry in 60 seconds',error.code||'network');
    }
    finally {
      running=false;
      if(!stopped){timer=setTimeout(cycle,delay);timer.unref();}
    }
  };
  void cycle();
  return ()=>{stopped=true;clearTimeout(timer);};
}
module.exports={pruneCatalog,startCatalogMaintenance};
