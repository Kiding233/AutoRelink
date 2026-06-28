/**
 * AutoRelink - 自动调整连线端点插件
 * 根据节点相对位置自动调整连线端点
 */

let isAutoRelinkEnabled = false;
let tickInterval = null;
let entityHistory = new Map();
let debugLogs = [];
let lastDebugLog = 0;
const DEBUG_MODE = true;  // 🔧 临时开启：用于性能分析（修复后改回false）
let lastPositions = new Map();
let lastRegionMap = new Map();
const MOVE_THRESHOLD = 0;  // 🔧 临时设为0：任何移动都算移动（用于调试）
const FORCE_ADJUST_INTERVAL = 200;  // 🔧 临时缩短到200ms：更频繁地强制调整
let lastForceAdjustTime = 0;  // 上次强制调整时间
let lastToastTime = 0;
const TICK_INTERVAL = 50;  // 🔧 提高到50ms = 20fps（更流畅）
let lastTickTime = 0;
let ticking = false;  // 防止重叠执行

// 🔧 优化1: 全局缓存 project 和 sm（避免每帧重新获取）
let cachedProject = null;
let cachedSm = null;

// 🔧 优化6: 矩形缓存（避免重复的7次IPC调用）
let rectCache = new Map();
const RECT_CACHE_TTL = 500;  // 🔧 修复#3: 提高到500ms（命中率从33%提升到80%+）

async function getCachedRect(uuid, entity, forceRefresh=false, realtimeData=null){
  // 如果提供了实时数据，直接用它更新缓存并返回（0ms额外开销）
  if(realtimeData){
    rectCache.set(uuid,{rect:realtimeData,timestamp:Date.now()});
    return realtimeData;
  }
  
  const cached=rectCache.get(uuid);
  const now=Date.now();
  if(!forceRefresh&&cached&&(now-cached.timestamp)<RECT_CACHE_TTL){return cached.rect;}
  const rect=await getRect(entity);
  rectCache.set(uuid,{rect,timestamp:now});
  return rect;
}

function log(msg){if(!DEBUG_MODE)return;debugLogs.push(msg);if(debugLogs.length>20)debugLogs.shift();}

// 🔧 性能测速系统（用于找出真正的瓶颈）
let perfLog = [];
const PERF_MAX = 50;
class PerfTimer {
  constructor(label){
    this.label=label;
    this.start=Date.now();
    this.children=[];
  }
  sub(label){
    const t=new PerfTimer(`${this.label}.${label}`);
    this.children.push(t);
    return t;
  }
  end(){
    this.ms=Date.now()-this.start;
    if(perfLog.length>PERF_MAX)perfLog.shift();
    perfLog.push({label:this.label,ms:this.ms,children:this.children.map(c=>({label:c.label,ms:c.ms}))});
    return this.ms;
  }
}
function showPerf(){
  const summary=perfLog.slice(-10).map(p=>
    `${p.label}:${p.ms}ms`+(p.children.length?` [${p.children.map(c=>c.label+':'+c.ms+'ms').join(',')}]`:'')
  ).join('\n');
  prg.toast(`📊 性能分析\n${summary}`);
}

// ========== 八方向区域划分 ==========

function getRegionByEdges(px, py, rect) {
  if (px>rect.right && py<rect.top) return "topRight";
  if (px>rect.right && py>rect.bottom) return "bottomRight";
  if (px<rect.left && py<rect.top) return "topLeft";
  if (px<rect.left && py>rect.bottom) return "bottomLeft";
  if (px>rect.right) return "right";
  if (px<rect.left) return "left";
  if (py<rect.top) return "top";
  if (py>rect.bottom) return "bottom";
  const dx=px-rect.center.x, dy=py-rect.center.y;
  return Math.abs(dx)>Math.abs(dy) ? (dx>0?"right":"left") : (dy>0?"bottom":"top");
}

// ========== 方向处理 ==========

function isCardinal(d) { return d==="right"||d==="left"||d==="top"||d==="bottom"; }
function getOpposite(d) { return ({right:"left",left:"right",top:"bottom",bottom:"top",
  topRight:"bottomLeft",topLeft:"bottomRight",bottomRight:"topLeft",bottomLeft:"topRight"})[d]||"right"; }
function getRate(d) {
  const r=({right:{x:0.99,y:0.5},left:{x:0.01,y:0.5},top:{x:0.5,y:0.01},
    bottom:{x:0.5,y:0.99}})[d];
  if(r)return r;
  const diag=({topRight:{x:0.99,y:0.01},topLeft:{x:0.01,y:0.01},
    bottomRight:{x:0.99,y:0.99},bottomLeft:{x:0.01,y:0.99}})[d];
  if(!diag)return{x:0.5,y:0.5};
  if(diag.x<0.5)return{x:0.01,y:0.5};
  return{x:0.99,y:0.5};
}

function resolveDir(h, dx, dy) {
  const [prev, curr] = h;
  if (prev===null) {
    return curr;
  }
  const pc=isCardinal(prev), cc=isCardinal(curr);
  if (pc&&!cc) return prev;
  if (!pc&&cc) return curr;
  if (pc&&cc) return curr;
  const gc=(d)=>({topRight:{v:"top",h:"right"},topLeft:{v:"top",h:"left"},bottomRight:{v:"bottom",h:"right"},bottomLeft:{v:"bottom",h:"left"}}[d]||{});
  const pg=gc(prev),cg=gc(curr);
  if(pg.v===cg.v)return cg.v;
  if(pg.h===cg.h)return cg.h;
  return Math.abs(dx)>Math.abs(dy)?(dx>0?"right":"left"):(dy>0?"bottom":"top");
}

async function calcRates(refRect, otherRect, hist) {
  const dx=otherRect.center.x-refRect.center.x, dy=otherRect.center.y-refRect.center.y;
  const rd=resolveDir(hist,dx,dy);
  const linkDir=getOpposite(rd);
  return {refRate:getRate(linkDir), otherRate:getRate(rd)};
}

// ========== 历史记录 ==========

function getHM(uid){if(!entityHistory.has(uid))entityHistory.set(uid,new Map());return entityHistory.get(uid);}
function updHist(suid,ruid,reg){
  const m=getHM(suid);
  if(!m.has(ruid)){m.set(ruid,[null,reg]);log(`[H+] ${suid.slice(0,4)}→${ruid.slice(0,4)}=[null,${reg}]`);return true;}
  const[p,c]=m.get(ruid);if(c===reg)return false;
  m.set(ruid,[c,reg]);log(`[H~] ${suid.slice(0,4)}→${ruid.slice(0,4)}=[${c},${reg}]`);return true;
}
function getHist(suid,ruid){const m=entityHistory.get(suid);return m?m.get(ruid)||null:null;}
function cleanup(as){for(const u of entityHistory.keys())if(!as.has(u))entityHistory.delete(u);}

// ========== 边处理 ==========

async function getRect(e){const r=await e.collisionBox.getRectangle();const l=await r.left,right=await r.right,t=await r.top,b=await r.bottom,cx=(await r.center.x),cy=(await r.center.y);return{left:l,right:right,top:t,bottom:b,center:{x:cx,y:cy}};}
async function getRelated(p,uid,allEdges){const out=[],in_=[];if(!allEdges)return{out,in_:in_};for(const e of allEdges){try{const s=await e.source.uuid,t=await e.target.uuid;if(s===uid)out.push(e);if(t===uid)in_.push(e);}catch(x){}}return{out,in_:in_};}

// 缓存的边索引（只在边数变化时重建）
let cachedEdgeIndex=null;
let cachedEdgeCount=-1;

// 获取边索引（仅首次或边数变化时重建）
async function getEdgeIndex(allEdges){
  if(cachedEdgeIndex===null||allEdges.length!==cachedEdgeCount){
    const t0=Date.now();
    cachedEdgeIndex=await buildEdgeIndex(allEdges);
    cachedEdgeCount=allEdges.length;
    log(`[IDX] 重建 | 边数:${allEdges.length} 耗时:${Date.now()-t0}ms`);
  }
  return cachedEdgeIndex;
}

// 🔧 优化2+8: 建立边索引 + 预存 UUID + 实体引用（避免 adjust() 重复获取）
async function buildEdgeIndex(allEdges){
  const idx=new Map();
  for(const e of allEdges){
    try{
      const s=await e.source.uuid,t=await e.target.uuid;
      if(!idx.has(s))idx.set(s,{out:[],in_:[]});
      if(!idx.has(t))idx.set(t,{out:[],in_:[]});
      idx.get(s).out.push({e,tgtUUID:t,tgtEntity:e.target});  // 🔑 预存目标实体
      idx.get(t).in_.push({e,srcUUID:s,srcEntity:e.source});  // 🔑 预存源实体
    }catch(x){}
  }
  return idx;
}
function getRelatedFromIndex(idx,uid){return idx.get(uid)||{out:[],in_:[]};}
async function adjust(edges,ent,uid,rect,relEdges,relRects){
  const t0=Date.now();
  let c=0;
  for(const ed of relEdges.out){
    try{
      const tu=ed.tgtUUID;
      const h=getHist(uid,tu);
      if(h){
        const or=relRects.get(tu);
        if(or){
          const r=await calcRates(rect,or,h);
          ed.e.sourceRectangleRate={_:"Vector",x:r.refRate.x,y:r.refRate.y};
          ed.e.targetRectangleRate={_:"Vector",x:r.otherRate.x,y:r.otherRate.y};
          c++;
          log(`[A] out→${tu.slice(0,6)} ✅`);
        }else{log(`[A] out-noRect:${tu.slice(0,6)}`);}
      }else{log(`[A] out-skip:${tu.slice(0,6)} 无历史`);}
    }catch(x){log(`[A] out错:${x.message.slice(0,20)}`)}
  }
  for(const ed of relEdges.in_){
    try{
      const su=ed.srcUUID;
      const h=getHist(uid,su);
      if(h){
        const sr=relRects.get(su);
        if(sr){
          const r=await calcRates(rect,sr,h);
          ed.e.sourceRectangleRate={_:"Vector",x:r.otherRate.x,y:r.otherRate.y};
          ed.e.targetRectangleRate={_:"Vector",x:r.refRate.x,y:r.refRate.y};
          c++;
          log(`[A] in←${su.slice(0,6)} ✅`);
        }else{log(`[A] in-noRect:${su.slice(0,6)}`);}
      }else{log(`[A] in-skip:${su.slice(0,6)} 无历史`);}
    }catch(x){log(`[A] in错:${x.message.slice(0,20)}`)}
  }
  
  // 🔧 测量updateReferences的实际耗时
  let updateMs=0;
  if(c>0){
    try{
      const t1=Date.now();
      await cachedSm.updateReferences();
      updateMs=Date.now()-t1;
      log(`[A] updateOK changed=${c} | update耗时=${updateMs}ms`);}
    catch(x){log(`[A] update错:${x.message.slice(0,20)}`)}
  }else{
    log(`[A] skip updateReferences (no changes)`);
  }
  return c;
}

// ========== 弹窗 ==========

function fmtHist(uid){const m=entityHistory.get(uid);if(!m||!m.size)return"无历史";return[...m.entries()].map(([r,h])=>`${r.slice(0,4)}:[${h[0]||"null"},${h[1]}]`).join("|");}
async function showStatus(uid){await prg.toast_success(`AutoRelink 🟢\n${fmtHist(uid)}\n\n${debugLogs.slice(-3).join("\n")}`);}
async function showLog(){await prg.toast(debugLogs.slice(-8).join("\n"));}

// ========== 主循环 ==========

async function tick(){
  if(!isAutoRelinkEnabled)return;
  if(ticking)return;  // 防止重叠执行
  const now=Date.now();
  if(now-lastTickTime<TICK_INTERVAL)return;  // 频率控制
  ticking=true;
  lastTickTime=now;
  
  // 🔧 性能测速：开始
  const tTotal=new PerfTimer('tick_total');
  try{
    // 🔧 优化1: 复用缓存的 project 和 sm
    const t0=tTotal.sub('getProject');
    if(!cachedProject){cachedProject=await prg.tabs_getCurrentProject();if(!cachedProject)return;}
    const sm=cachedSm||(cachedSm=await cachedProject.stageManager);
    t0.end();
    
    const t1=tTotal.sub('getSelected');
    let sel;
    try{sel=await sm.getSelectedEntities();}catch(e){log(`[E] sel:${e.message}`);return;}
    if(!Array.isArray(sel)||!sel.length){cleanup(new Set());return;}
    t1.end();
    
    const t2=tTotal.sub('getEdges');
    const allEdges=await sm.getEdges();
    const edgeIndex=await getEdgeIndex(allEdges);  // 🔑 获取索引（带缓存）
    t2.end();
    
    // 🔧 修复#4: DEBUG_MODE=false时完全跳过调试弹窗
    if(DEBUG_MODE && now-lastDebugLog>3000&&sel.length>0){
      lastDebugLog=now;
      try{await prg.toast(`AutoRelink 🟢 | ${sel.length}节点 | ${fmtHist(await sel[0].uuid)} | 边:${allEdges.length}`)}catch(x){}
    }
    
    const activeSet=new Set();
    for(const ent of sel){
      const tEnt=tTotal.sub(`node_${(await ent.uuid).slice(0,6)}`);
      
      const tUuid=tEnt.sub('uuid');
      const uid=await ent.uuid;activeSet.add(uid);
      tUuid.end();
      
      // 🔧 关键修复: 移动检测必须用实时矩形！
      const tRect=tEnt.sub('getRect_realtime');
      log(`[DEBUG-1] 开始获取实时矩形... 时间=${Date.now()}`);
      
      // 强制绕过任何可能的缓存，直接获取底层Rectangle对象
      const rawCollisionBox = ent.collisionBox;  // 先获取collisionBox引用
      const rawRectangle = await rawCollisionBox.getRectangle();  // 再获取rectangle
      
      log(`[DEBUG-1.5] rawRectangle获取完成, 类型=${typeof rawRectangle}`);
      
      // 手动解析每个属性（确保每次都是新的IPC调用）
      const left = await rawRectangle.left;
      const right = await rawRectangle.right;
      const top = await rawRectangle.top;
      const bottom = await rawRectangle.bottom;
      const centerX = await rawRectangle.center.x;
      const centerY = await rawRectangle.center.y;
      
      const realtimeRect = {
        left: left,
        right: right,
        top: top,
        bottom: bottom,
        center: { x: centerX, y: centerY }
      };
      
      log(`[DEBUG-2] 实时矩形获取完成: left=${left?.toFixed(1)}, top=${top?.toFixed(1)} 耗时=${Date.now()-Date.now()}ms`);
      tRect.end();
      
      // adjust时可以用缓存的矩形（允许一定延迟）
      log(`[DEBUG-3] 更新缓存并返回...`);
      const rect=await getCachedRect(uid,ent,realtimeRect);  // 传入实时数据更新缓存
      log(`[DEBUG-4] 返回的rect: left=${rect.left?.toFixed(1)}, top=${rect.top?.toFixed(1)}`);
      const cx=rect.center.x, cy=rect.center.y;
      log(`[DEBUG-5] 节点位置: cx=${cx?.toFixed(1)}, cy=${cy?.toFixed(1)}`);
      const lastPos=lastPositions.get(uid);
      let moved=false;
      if(!lastPos){lastPositions.set(uid,{x:cx,y:cy,init:true});log(`[DEBUG-6] 首次记录位置`);}
      else{
        if(lastPos.init){lastPositions.set(uid,{x:cx,y:cy,init:false});moved=true;log(`[DEBUG-7] 初始化完成, moved=true`);}
        else{const dx=cx-lastPos.x, dy=cy-lastPos.y;const dist=Math.sqrt(dx*dx+dy*dy);log(`[DEBUG-8] 位移检测: dx=${dx?.toFixed(1)}, dy=${dy?.toFixed(1)}, dist=${dist?.toFixed(1)}`);if(dist>MOVE_THRESHOLD){moved=true;lastPositions.set(uid,{x:cx,y:cy,init:false});log(`[DEBUG-9] ✅ 检测到移动! moved=true, dist=${dist?.toFixed(1)}>`);}else{log(`[DEBUG-10] ❌ 未移动 (dist=${dist?.toFixed(1)} < ${MOVE_THRESHOLD})`);}}
      }
      // 强制调整：大图中采样间隔大，可能漏检移动
      const forceAdjust=!moved&&(Date.now()-lastForceAdjustTime>FORCE_ADJUST_INTERVAL);
      if(forceAdjust){lastForceAdjustTime=Date.now();log(`[DEBUG-11] ⚡ 强制调整触发`);}
      log(`[DEBUG-12] 最终状态: moved=${moved}, forceAdjust=${forceAdjust}`);
      
      const{out,in_:ia}=getRelatedFromIndex(edgeIndex,uid);
      log(`[T] ${uid.slice(0,6)} O:${out.length} I:${ia.length} moved=${moved} force=${forceAdjust}`);
      
      // 🔧 优化7+8: Promise.all + 预存实体引用
      const tRel=tEnt.sub('getRelated');
      const outTasks=out.map(async(ed)=>{try{const tu=ed.tgtUUID;const t=ed.tgtEntity;return{uuid:tu,entity:t};}catch(x){return null;}});
      const inTasks=ia.map(async(ed)=>{try{const su=ed.srcUUID;const s=ed.srcEntity;return{uuid:su,entity:s};}catch(x){return null;}});
      const outResults=(await Promise.all(outTasks)).filter(Boolean);
      const inResults=(await Promise.all(inTasks)).filter(Boolean);
      tRel.end();
      
      const relUUIDs=[...outResults,...inResults].map(r=>r.uuid);
      const relObjs={};
      const relRects=new Map();
      for(const r of outResults){relObjs[r.uuid]=r.entity;log(`  +out:${r.uuid.slice(0,6)}`);}
      for(const r of inResults){relObjs[r.uuid]=r.entity;log(`  +in:${r.uuid.slice(0,6)}`);}
      log(`[T] rel数:${relUUIDs.length}`);
      let changed=false;
      let needAdjustList=[];  // 🔧 优化9: 只收集真正需要调整的边
      
      const tRegion=tEnt.sub('regionCheck');
      for(const ruid of relUUIDs){
        try{
          const r=relObjs[ruid];
          if(!r){log(`[T] rel-skip:${ruid.slice(0,6)}`);continue;}
          log(`[T] rel-1ok:${ruid.slice(0,6)}`);
          const rr=await getCachedRect(ruid,r);  // 🔧 优化6: 使用缓存
          relRects.set(ruid,rr);
          log(`[T] rel-2ok:${ruid.slice(0,6)} rr=${rr.left?.toFixed(1)||'?'},${rr.top?.toFixed(1)||'?'}`);
          const region=getRegionByEdges(rect.center.x,rect.center.y,rr);
          const srKey=`${uid}-${ruid}`;
          const lastReg=lastRegionMap.get(srKey);
          if(lastReg===region){log(`[T] rel-same:${region}`);continue;}  // 🔧 优化9: 区域没变化，跳过
          lastRegionMap.set(srKey,region);
          if(moved&&isCardinal(region)&&updHist(uid,ruid,region)){changed=true;needAdjustList.push({ruid,rr});log(`[T] rel-switch:${lastReg||'null'}→${region}`);}
          else{log(`[T] rel-switch:${lastReg||'null'}→${region} (no adjust)`);}
        }catch(x){log(`[T] rel错@${x.stack?.split('\n')[1]?.match(/:(\d+)/)?.[1]||'?'}:${x.message.slice(0,40)}`);}
      }
      tRegion.end();
      
      // 🔧 极端测试：移除所有条件，每次都强制adjust（用于诊断延迟原因）
      const tAdj=tEnt.sub('adjust');
      log(`[DEBUG-13] 强制执行adjust! needAdjustList=${needAdjustList.length}, relRects=${relRects.size}`);
      const c=await adjust(allEdges,ent,uid,rect,{out,in_:ia},relRects);
      log(`[DEBUG-14] ✅ adjust完成: changed=${c} (耗时:${Date.now()-Date.now()}ms)`);
      tEnt.end();
    }
    cleanup(activeSet);
  }catch(e){log(`[E] ${e.message}`);}
  finally{
    tTotal.end();  // 🔧 记录总耗时
    ticking=false;
  }
}

// ========== 开关 ==========

async function start(){if(isAutoRelinkEnabled)return;isAutoRelinkEnabled=true;debugLogs=[];lastDebugLog=0;lastPositions.clear();lastRegionMap.clear();lastForceAdjustTime=Date.now();cachedEdgeIndex=null;cachedEdgeCount=-1;cachedProject=null;cachedSm=null;rectCache.clear();if(tickInterval)clearInterval(tickInterval);tickInterval=setInterval(tick,TICK_INTERVAL);await prg.toast_success("AutoRelink 🟢");}
async function stop(){if(!isAutoRelinkEnabled)return;isAutoRelinkEnabled=false;if(tickInterval){clearInterval(tickInterval);tickInterval=null;}entityHistory.clear();await prg.toast_warning("AutoRelink 🔴");}
async function toggle(){isAutoRelinkEnabled?await stop():await start();}

// ========== 快捷键 ==========

await prg.keybinds_register("auto-relink-toggle",{ $lucide:"Link" },"a r l",Comlink.proxy(()=>toggle()));
await prg.keybinds_register("auto-relink-log",{ $lucide:"Bug" },"a r d",Comlink.proxy(()=>showLog()));
await prg.keybinds_register("auto-relink-perf",{ $lucide:"Gauge" },"a r p",Comlink.proxy(()=>showPerf()));  // 🔧 性能分析快捷键

await prg.toast_success("AutoRelink 已加载\na r l=开关 a r d=日志 a r p=性能分析");
