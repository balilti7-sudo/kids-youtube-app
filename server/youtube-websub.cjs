'use strict';
const {createHmac,timingSafeEqual} = require('node:crypto');
const {SaxesParser} = require('saxes');
const {CHANNEL,VIDEO,check} = require('./youtube-registry.cjs');
const TOPIC = 'https://www.youtube.com/feeds/videos.xml?channel_id=';
function secretFor(master,channel) {return createHmac('sha256',master).update(channel).digest('hex');}
function validSignature(body,signature,secret) {
  const match=/^(sha1|sha256)=([a-f0-9]+)$/i.exec(signature||'');
  if (!match) return false;
  if (match[2].length !== (match[1].toLowerCase()==='sha1'?40:64)) return false;
  const expected=createHmac(match[1].toLowerCase(),secret).update(body).digest();
  const received=Buffer.from(match[2],'hex');
  return expected.length===received.length && timingSafeEqual(expected,received);
}
function parseNotification(body,channel) {
  if (!Buffer.isBuffer(body)||body.length>262144||!CHANNEL.test(channel)) throw new Error('Invalid notification');
  const xml=body.toString('utf8');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DTD prohibited');
  const entries=[];let entry=null;let field=null;let depth=0;let entryDepth=0;
  const parser=new SaxesParser({xmlns:true});
  parser.on('opentag',tag=>{
    depth++;
    if(tag.local==='entry'&&tag.uri==='http://www.w3.org/2005/Atom') {
      if(entry)throw new Error('Nested entry');entry={};entryDepth=depth;
    }
    if(entry&&depth===entryDepth+1&&tag.uri==='http://www.youtube.com/xml/schemas/2015'&&['videoId','channelId'].includes(tag.local)) {
      field=tag.local;entry[field]='';
    }
  });
  parser.on('text',text=>{if(field)entry[field]+=text;});
  parser.on('closetag',tag=>{
    if(field&&depth===entryDepth+1)field=null;
    if(entry&&depth===entryDepth&&tag.local==='entry') {
      if(entry.channelId?.trim()!==channel||!VIDEO.test(entry.videoId?.trim()||''))throw new Error('Wrong channel or video');
      entries.push(entry.videoId.trim());entry=null;
      if(entries.length>100)throw new Error('Too many entries');
    }
    depth--;
  });
  parser.write(xml).close();
  return [...new Set(entries)];
}
function registerYoutubeWebSub(app) {
  if(process.env.YOUTUBE_WEBSUB_ENABLED!=='1')return;
  const master=process.env.YOUTUBE_WEBSUB_SECRET;
  if(!master||master.length<32||!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw new Error('WebSub configuration missing');
  const {createClient}=require('@supabase/supabase-js');
  const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const route='/api/youtube/websub/:channel';
  app.get(route,async(req,res)=>{
    res.set('Cache-Control','no-store');
    const channel=req.params.channel,q=req.query;
    if(!CHANNEL.test(channel)||q['hub.mode']!=='subscribe'||q['hub.topic']!==TOPIC+channel||
      typeof q['hub.challenge']!=='string'||q['hub.challenge'].length>2048||typeof q['hub.verify_token']!=='string')return res.sendStatus(400);
    const seconds=Number(q['hub.lease_seconds']);
    if(!Number.isInteger(seconds)||seconds<1||seconds>30*86400)return res.sendStatus(400);
    try {
      const row=check(await db.from('youtube_websub_subscriptions').select('verify_token,verify_until').eq('channel_id',channel).maybeSingle());
      if(!row||row.verify_token!==q['hub.verify_token']||Date.parse(row.verify_until)<=Date.now())return res.sendStatus(403);
      const updated=check(await db.from('youtube_websub_subscriptions').update({expires_at:new Date(Date.now()+seconds*1000).toISOString(),verify_token:null,verify_until:null})
        .eq('channel_id',channel).eq('verify_token',row.verify_token).select('channel_id'));
      if(!updated.length)return res.sendStatus(403);
      return res.type('text/plain').send(q['hub.challenge']);
    }catch{return res.sendStatus(503);}
  });
  app.post(route,require('express').raw({type:['application/atom+xml','application/xml','text/xml'],limit:'256kb'}),async(req,res)=>{
    res.set('Cache-Control','no-store');
    const channel=req.params.channel;
    if(!CHANNEL.test(channel)||!Buffer.isBuffer(req.body))return res.sendStatus(400);
    if(!validSignature(req.body,req.get('x-hub-signature'),secretFor(master,channel)))return res.sendStatus(403);
    let ids;try{ids=parseNotification(req.body,channel);}catch{return res.sendStatus(400);}
    try {
      for(const id of ids)check(await db.rpc('catalog_enqueue_video',{p_channel:channel,p_video:id}));
      return res.sendStatus(204);
    }catch{return res.sendStatus(503);}
  });
}
module.exports={TOPIC,secretFor,validSignature,parseNotification,registerYoutubeWebSub};
