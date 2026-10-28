'use strict';
const {check}=require('./youtube-registry.cjs');
const DAY=86400_000;

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
  const cycle=async()=>{
    if(running)return;
    running=true;
    try {console.info('[catalog-maintenance]',JSON.stringify(await pruneCatalog(db)));}
    catch {console.warn('[catalog-maintenance] cleanup failed; will retry');}
    finally {running=false;}
  };
  void cycle();
  const timer=setInterval(cycle,3600_000);timer.unref();
  return ()=>clearInterval(timer);
}
module.exports={pruneCatalog,startCatalogMaintenance};
