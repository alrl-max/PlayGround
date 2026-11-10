(() => {
  'use strict';
  const canvas = document.querySelector('#game');
  const ctx = canvas.getContext('2d');
  const W = 1000, H = 640, TILE = 20;
  const teams = [
    { name: 'RED / 돌격', color: '#f16a64', code: '01', start: [[105,500],[142,520],[179,500]] },
    { name: 'BLUE / 지원', color: '#6caeff', code: '02', start: [[105,335],[142,355],[179,335]] },
    { name: 'GOLD / 정찰', color: '#f0ca63', code: '03', start: [[105,105],[142,125],[179,105]] }
  ];
  // Wall segments leave deliberate openings that form doors and corridors.
  const walls = [
    [40,40,960,40],[960,40,960,600],[960,600,40,600],[40,600,40,40],
    [42,205,145,205],[195,205,490,205],[540,205,775,205],[825,205,958,205],
    [42,420,118,420],[168,420,450,420],[500,420,820,420],[870,420,958,420],
    [330,42,330,105],[330,155,330,205],[330,205,330,285],[330,335,330,420],[330,420,330,475],[330,525,330,598],
    [665,42,665,110],[665,160,665,205],[665,205,665,290],[665,340,665,420],[665,420,665,475],[665,525,665,598],
    [490,205,490,280],[490,330,490,420],[820,205,820,280],[820,330,820,420]
  ];
  const obstacles = [
    {x:220,y:80,w:64,h:34,label:'TABLE'}, {x:380,y:78,w:96,h:24,label:'BENCH'},
    {x:710,y:80,w:80,h:46,label:'COVER'}, {x:90,y:270,w:92,h:34,label:'DESK'},
    {x:228,y:310,w:48,h:66,label:''}, {x:390,y:275,w:62,h:82,label:'CRATE'},
    {x:545,y:276,w:74,h:32,label:'TABLE'}, {x:700,y:280,w:92,h:52,label:'COVER'},
    {x:865,y:275,w:48,h:86,label:''}, {x:80,y:470,w:74,h:38,label:'COVER'},
    {x:220,y:500,w:70,h:56,label:'CRATE'}, {x:380,y:470,w:78,h:44,label:'TABLE'},
    {x:535,y:500,w:92,h:36,label:'BENCH'}, {x:700,y:480,w:54,h:72,label:''},
    {x:835,y:465,w:76,h:50,label:'COVER'}
  ];
  const units = teams.flatMap((team, ti) => team.start.map((p, i) => ({
    id: `${ti}-${i}`, team: ti, index: i, x: p[0], y: p[1], hp: 100,
    route: [], path: [], pathIndex: 0, selected: false, facing: 0
  })));
  const state = { selectedTeam: 0, selectedUnit: null, running: false, waypointCount: 0, lastTime: 0, zoom: 1, panX: 0, panY: 0, pointer: null, touchTimer: null, longPressed: false };
  const squadRoot = document.querySelector('#squads');
  teams.forEach((team, i) => {
    const card = document.createElement('button');
    card.className = 'squad'; card.style.setProperty('--team', team.color); card.dataset.team = i;
    card.innerHTML = `<span class="swatch"></span><span class="squad-info"><span class="squad-name">${team.name}</span><span class="squad-meta">작전 인원 03 · 준비</span></span><span class="sel-tag">${team.code}</span>`;
    card.addEventListener('click', () => selectTeam(i)); squadRoot.append(card);
  });

  function resize() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw();
  }
  const view = () => {
    const r = canvas.getBoundingClientRect(), scale = Math.min((r.width - 22) / W, (r.height - 22) / H) * state.zoom;
    return { x: (r.width - W * scale) / 2 + state.panX, y: (r.height - H * scale) / 2 + state.panY, scale, width:r.width, height:r.height };
  };
  function worldPoint(e) {
    const r = canvas.getBoundingClientRect(), v = view();
    return { x: (e.clientX-r.left-v.x)/v.scale, y: (e.clientY-r.top-v.y)/v.scale };
  }
  function inside(p) { return p.x > 45 && p.x < 955 && p.y > 45 && p.y < 595; }
  function distToSegment(px,py,x1,y1,x2,y2) {
    const dx=x2-x1,dy=y2-y1,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((px-x1)*dx+(py-y1)*dy)/l)):0;
    return Math.hypot(px-(x1+t*dx),py-(y1+t*dy));
  }
  function blocked(x,y) {
    if(x<49||x>951||y<49||y>591) return true;
    for(const w of walls) if(distToSegment(x,y,...w)<7) return true;
    for(const o of obstacles) if(x>o.x-7&&x<o.x+o.w+7&&y>o.y-7&&y<o.y+o.h+7) return true;
    return false;
  }
  function nearestOpen(x,y) {
    if(!blocked(x,y)) return {x,y};
    for(let r=1;r<12;r++) for(let a=0;a<24;a++) { const ang=a*Math.PI/12, p={x:x+Math.cos(ang)*r*TILE/2,y:y+Math.sin(ang)*r*TILE/2}; if(!blocked(p.x,p.y)) return p; }
    return {x,y};
  }
  function findPath(from,to) {
    const start=nearestOpen(from.x,from.y), goal=nearestOpen(to.x,to.y);
    const cell=(x,y)=>[Math.max(0,Math.min(W/TILE-1,Math.floor(x/TILE))),Math.max(0,Math.min(H/TILE-1,Math.floor(y/TILE)))];
    let [sx,sy]=cell(start.x,start.y),[gx,gy]=cell(goal.x,goal.y);
    const key=(x,y)=>y*(W/TILE)+x, open=[key(sx,sy)], prev=new Int32Array(W/TILE*(H/TILE)); prev.fill(-1);
    const seen=new Uint8Array(prev.length); seen[key(sx,sy)]=1;
    const dirs=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
    let found=key(gx,gy);
    for(let head=0;head<open.length&&head<12000;head++) {
      const k=open[head],x=k%(W/TILE),y=Math.floor(k/(W/TILE)); if(k===found) break;
      for(const [dx,dy] of dirs) { const nx=x+dx,ny=y+dy;if(nx<2||ny<2||nx>=W/TILE-2||ny>=H/TILE-2)continue;
        const nk=key(nx,ny);if(seen[nk])continue;const cx=nx*TILE+TILE/2,cy=ny*TILE+TILE/2;
        if(blocked(cx,cy)||blocked((x*TILE+cx)/2,(y*TILE+cy)/2))continue;
        if(dx&&dy&&(blocked((x*TILE+cx)/2,y*TILE+TILE/2)||blocked(x*TILE+TILE/2,(y*TILE+cy)/2)))continue;
        seen[nk]=1;prev[nk]=k;open.push(nk);
      }
      if(head===open.length-1) found=-1;
    }
    if(found<0||!seen[found]) return [goal];
    const result=[];for(let k=found;k!==key(sx,sy)&&k>=0;k=prev[k]) result.push({x:(k%(W/TILE))*TILE+TILE/2,y:Math.floor(k/(W/TILE))*TILE+TILE/2});
    result.reverse();result.push(goal);
    // Remove straight-line intermediate cells while preserving corners.
    const compact=[];for(let i=0;i<result.length;i++) if(i===0||i===result.length-1||Math.sign(result[i].x-result[i-1].x)!==Math.sign(result[i+1].x-result[i].x)||Math.sign(result[i].y-result[i-1].y)!==Math.sign(result[i+1].y-result[i].y)) compact.push(result[i]);
    return compact;
  }

  function selectedUnits() {
    if(state.selectedUnit) return units.filter(u=>u.id===state.selectedUnit);
    return units.filter(u=>u.team===state.selectedTeam);
  }
  function selectTeam(i) { state.selectedTeam=i;state.selectedUnit=null;updateUI();draw(); }
  function selectUnit(u) { state.selectedTeam=u.team;state.selectedUnit=u.id;updateUI();draw(); }
  function routeFor(unit) {
    unit.path=[];unit.pathIndex=0;let from={x:unit.x,y:unit.y};
    for(const target of unit.route) { unit.path.push(...findPath(from,target));from=target; }
  }
  function addWaypoint(point) {
    if(!inside(point)||blocked(point.x,point.y)) return;
    const selected=selectedUnits(), formation=[[-15,-10],[15,-10],[0,17]];
    selected.forEach((u,i)=>{
      const off=state.selectedUnit?{x:0,y:0}:formation[u.index];
      const target=nearestOpen(point.x+off[0],point.y+off[1]);
      u.route.push(target);routeFor(u);
    });
    state.waypointCount++;updateUI();draw();
  }
  function undoWaypoint() {
    selectedUnits().forEach(u=>{u.route.pop();routeFor(u);});updateUI();draw();
  }
  function clearRoutes() { selectedUnits().forEach(u=>{u.route=[];u.path=[];u.pathIndex=0;});updateUI();draw(); }
  function toggleRun() { state.running=!state.running;state.lastTime=performance.now();updateUI(); }
  function updateUI() {
    document.querySelectorAll('.squad').forEach((el,i)=>el.classList.toggle('active',i===state.selectedTeam));
    const members=selectedUnits(), selected=state.selectedUnit?units.find(u=>u.id===state.selectedUnit):null;
    const title=document.querySelector('#detailTitle'),sub=document.querySelector('#detailSub'),dot=document.querySelector('#unitDot');
    dot.style.background=teams[state.selectedTeam].color;
    title.textContent=selected?`유닛 ${selected.index+1} · ${teams[selected.team].name.split(' / ')[0]}`:`${teams[state.selectedTeam].name} 분대`;
    const orderCount=members.reduce((n,u)=>n+u.route.length,0);
    sub.textContent=`${selected?'개별 유닛':'분대원 03'} · 경로 ${orderCount}개 대기`;
    document.querySelectorAll('.squad-meta').forEach((el,i)=>{
      const alive=units.filter(u=>u.team===i).length,orders=units.filter(u=>u.team===i).reduce((n,u)=>n+u.route.length,0);
      el.textContent=`작전 인원 ${String(alive).padStart(2,'0')} · ${orders?`경로 ${orders}`:'준비'}`;
    });
    const status=document.querySelector('#status'),run=document.querySelector('#runBtn'),pause=document.querySelector('#pauseBtn');
    status.classList.toggle('live',state.running);status.querySelector('span').textContent=state.running?'작전 진행 중':'계획 단계';
    run.innerHTML=state.running?'Ⅱ 일시정지':'▶ 실행';run.classList.toggle('primary',!state.running);
    pause.textContent=state.running?'▶ 계속':'Ⅱ 일시정지';pause.disabled=!state.running;pause.style.opacity=state.running?'1':'.55';
  }

  function draw() {
    const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return;
    ctx.clearRect(0,0,r.width,r.height);
    const v=view();ctx.save();ctx.translate(v.x,v.y);ctx.scale(v.scale,v.scale);
    ctx.fillStyle='#19221d';ctx.fillRect(0,0,W,H);
    // Quiet drafting grid.
    ctx.strokeStyle='#25332a';ctx.lineWidth=1;
    for(let x=60;x<W;x+=20){ctx.beginPath();ctx.moveTo(x,50);ctx.lineTo(x,590);ctx.stroke();}
    for(let y=60;y<H;y+=20){ctx.beginPath();ctx.moveTo(50,y);ctx.lineTo(950,y);ctx.stroke();}
    // Room floor panels, each kept intentionally spare.
    ctx.fillStyle='#1b2520';
    [[48,48,278,149],[338,48,318,149],[673,48,278,149],[48,213,274,201],[338,213,146,201],[498,213,158,201],[673,213,141,201],[828,213,123,201],[48,428,274,164],[338,428,318,164],[673,428,278,164]].forEach(a=>ctx.fillRect(...a));
    ctx.strokeStyle='#637268';ctx.lineWidth=8;ctx.lineCap='square';
    walls.forEach(w=>{ctx.beginPath();ctx.moveTo(w[0],w[1]);ctx.lineTo(w[2],w[3]);ctx.stroke();});
    // Passages are visible as simple outlined door thresholds.
    ctx.lineCap='butt';ctx.strokeStyle='#c4a86b';ctx.lineWidth=2;
    [[170,205,170,194],[515,205,515,194],[800,205,800,194],[143,420,143,431],[475,420,475,431],[845,420,845,431],
      [330,130,319,130],[330,310,341,310],[330,500,319,500],[665,135,676,135],[665,315,654,315],[665,500,676,500],
      [490,305,501,305],[820,305,831,305]].forEach(a=>{ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(a[2],a[3]);ctx.stroke();});
    // Cover and furniture: blocks and a single fine inset line.
    obstacles.forEach((o,i)=>{
      ctx.fillStyle=i%2?'#29362e':'#2d3931';ctx.strokeStyle='#607064';ctx.lineWidth=1.5;
      ctx.beginPath();ctx.rect(o.x,o.y,o.w,o.h);ctx.fill();ctx.stroke();
      ctx.strokeStyle='#46564a';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(o.x+6,o.y+6);ctx.lineTo(o.x+o.w-6,o.y+6);ctx.stroke();
      if(o.label){ctx.fillStyle='#84948a';ctx.font=`700 ${Math.max(8,10/ v.scale)}px ui-monospace,monospace`;ctx.textAlign='center';ctx.fillText(o.label,o.x+o.w/2,o.y+o.h/2+3);}
    });
    drawRoomLabels(v.scale);drawRoutes(v.scale);drawUnits(v.scale);drawOverlays(v);
    ctx.restore();
  }
  function drawRoomLabels(scale) {
    ctx.font=`700 ${Math.max(10,12/scale)}px ui-monospace,monospace`;ctx.fillStyle='#617168';ctx.textAlign='left';
    [['01 / NORTH',58,67],['02 / OFFICE',348,67],['03 / STORAGE',680,67],['04 / PASSAGE',58,232],['05 / CENTRAL',348,232],['06 / EAST',680,232],['07 / ENTRY',58,447],['08 / SOUTH',348,447],['09 / EXIT',680,447]].forEach(a=>ctx.fillText(a[0],a[1],a[2]));
    ctx.textAlign='right';ctx.fillStyle='#a3b2a7';ctx.fillText('N ↑',944,69);ctx.textAlign='left';
  }
  function drawRoutes(scale) {
    units.forEach(u=>{
      if(!u.route.length)return;
      const active=state.selectedUnit?u.id===state.selectedUnit:u.team===state.selectedTeam;
      const color=teams[u.team].color;ctx.save();ctx.globalAlpha=active?.9:.34;ctx.strokeStyle=color;ctx.fillStyle=color;
      ctx.lineWidth=active?Math.max(2.5,2/scale):Math.max(1.6,1.4/scale);ctx.setLineDash([Math.max(6,5/scale),Math.max(6,5/scale)]);ctx.beginPath();ctx.moveTo(u.x,u.y);
      u.path.slice(u.pathIndex).forEach(p=>ctx.lineTo(p.x,p.y));ctx.stroke();ctx.setLineDash([]);
      u.route.forEach((p,i)=>{ctx.beginPath();ctx.arc(p.x,p.y,active?Math.max(6,5/scale):Math.max(4,3.5/scale),0,Math.PI*2);ctx.stroke();if(active){ctx.font=`700 ${Math.max(8,9/scale)}px ui-monospace,monospace`;ctx.textAlign='center';ctx.fillText(String(i+1),p.x,p.y+3);}});
      ctx.restore();
    });
  }
  function drawUnits(scale) {
    units.forEach(u=>{
      const color=teams[u.team].color, isSelected=state.selectedUnit?state.selectedUnit===u.id:u.team===state.selectedTeam;
      const radius=Math.max(7,4.6/scale);
      if(isSelected){ctx.strokeStyle=color;ctx.globalAlpha=.45;ctx.lineWidth=Math.max(1.5,1.2/scale);ctx.beginPath();ctx.arc(u.x,u.y,Math.max(13,10/scale),0,Math.PI*2);ctx.stroke();ctx.globalAlpha=1;}
      ctx.fillStyle=color;ctx.beginPath();ctx.arc(u.x,u.y,radius,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#101612';ctx.lineWidth=Math.max(1.5,1.2/scale);ctx.beginPath();ctx.moveTo(u.x,u.y);ctx.lineTo(u.x+Math.cos(u.facing)*Math.max(5,3/scale),u.y+Math.sin(u.facing)*Math.max(5,3/scale));ctx.stroke();
      ctx.fillStyle='#edf4ed';ctx.beginPath();ctx.arc(u.x-radius*.24,u.y-radius*.24,Math.max(1.3,1/scale),0,Math.PI*2);ctx.fill();
    });
  }
  function drawOverlays(v) {
    const scale=v.scale;ctx.strokeStyle='#526158';ctx.lineWidth=1/scale;ctx.strokeRect(40,40,920,560);
    // Small scale indicator in the lower-left of the map.
    ctx.strokeStyle='#7d8d82';ctx.lineWidth=2/scale;ctx.beginPath();ctx.moveTo(62,570);ctx.lineTo(122,570);ctx.stroke();
    ctx.fillStyle='#84948a';ctx.font='700 9px ui-monospace,monospace';ctx.textAlign='left';ctx.fillText('20 M',62,560);
  }

  function update(dt) {
    if(!state.running)return;
    let changed=false;
    for(const u of units) {
      if(u.pathIndex>=u.path.length)continue;
      let budget=88*dt;
      while(budget>0&&u.pathIndex<u.path.length) {
        const target=u.path[u.pathIndex],dx=target.x-u.x,dy=target.y-u.y,d=Math.hypot(dx,dy);
        if(d<1.5){u.x=target.x;u.y=target.y;u.pathIndex++;continue;}
        u.facing=Math.atan2(dy,dx);const step=Math.min(d,budget);u.x+=dx/d*step;u.y+=dy/d*step;budget-=step;
        if(step>=d-.01){u.x=target.x;u.y=target.y;u.pathIndex++;}
        else break;
      }
      if(u.pathIndex>=u.path.length&&u.route.length){u.route=[];u.path=[];u.pathIndex=0;changed=true;}
    }
    if(changed)updateUI();
  }
  function frame(now) {
    const dt=Math.min(.05,(now-state.lastTime)/1000||0);state.lastTime=now;update(dt);draw();requestAnimationFrame(frame);
  }
  function pointerDown(e) {
    if(e.button!==undefined&&e.button!==0)return;
    canvas.setPointerCapture?.(e.pointerId);state.pointer={x:e.clientX,y:e.clientY,moved:false};state.longPressed=false;
  }
  function pointerUp(e) {
    if(!state.pointer)return;
    const dx=e.clientX-state.pointer.x,dy=e.clientY-state.pointer.y;
    if(Math.hypot(dx,dy)<12) {
      const p=worldPoint(e);let hit=null,dist=20;
      for(const u of units){const d=Math.hypot(p.x-u.x,p.y-u.y);if(d<dist){dist=d;hit=u;}}
      if(hit)selectUnit(hit);else addWaypoint(p);
    }
    state.pointer=null;
  }
  canvas.addEventListener('pointerdown',pointerDown);
  canvas.addEventListener('pointerup',pointerUp);
  canvas.addEventListener('pointercancel',()=>state.pointer=null);
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('wheel',e=>{e.preventDefault();state.zoom=Math.max(.75,Math.min(1.7,state.zoom*(e.deltaY<0?1.08:.92)));draw();},{passive:false});
  document.querySelector('#runBtn').addEventListener('click',toggleRun);
  document.querySelector('#pauseBtn').addEventListener('click',()=>{if(state.running)toggleRun();});
  document.querySelector('#undoBtn').addEventListener('click',undoWaypoint);
  document.querySelector('#clearBtn').addEventListener('click',clearRoutes);
  window.addEventListener('keydown',e=>{
    if(e.code==='Space'){e.preventDefault();toggleRun();}
    if(e.key==='1'||e.key==='2'||e.key==='3')selectTeam(Number(e.key)-1);
    if(e.key==='Escape')clearRoutes();
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undoWaypoint();}
  });
  new ResizeObserver(resize).observe(canvas);
  updateUI();resize();requestAnimationFrame(frame);
})();
