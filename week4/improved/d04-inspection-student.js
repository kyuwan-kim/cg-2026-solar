(() => {
  'use strict';
  const viewer=window.InspectionViewer;
  const {canvas,controls,model}=viewer;
  const overlay=document.querySelector('#grid-overlay');
  const grid=overlay.getContext('2d');
  const plaqueButtons=document.querySelector('#plaque-picker');
  const viewButtons=document.querySelector('#view-picker');
  const status=document.querySelector('#navigation-status');
  const plaqueSelect=document.querySelector('#plaque-select');
  const viewSelect=document.querySelector('#view-select');
  let selectedPlaque=model.poi[0],selectedView='front',activeView=null,move=null;
  let lastActionCount=controls.state.actions;

  function makePicker(host,items,onSelect){
    items.forEach(item=>{
      const button=document.createElement('button');
      button.type='button';
      button.className='segment';
      button.textContent=item.label;
      button.setAttribute('role','radio');
      button.setAttribute('aria-checked','false');
      button.addEventListener('click',()=>{
        host.querySelectorAll('button').forEach(el=>el.setAttribute('aria-checked','false'));
        button.setAttribute('aria-checked','true');
        controls.state.actions++;
        lastActionCount=controls.state.actions;
        onSelect(item.value);
      });
      host.append(button);
    });
  }

  function clearPicker(host){
    host.querySelectorAll('button').forEach(button=>button.setAttribute('aria-checked','false'));
  }

  makePicker(plaqueButtons,model.poi.map(p=>({label:p.id,value:p})),value=>{
    clearPicker(viewButtons);
    selectedPlaque=value;
    plaqueSelect.textContent=`${value.id} · ${value.name}`;
    plaqueSelect.hidden=false;
    viewSelect.hidden=true;
    navigate(signCamera(value),`${value.id} 명판`,value.id==='P5');
  });
  makePicker(viewButtons,[
    {label:'전면 직교',value:'front'},
    {label:'오른쪽 측면 직교',value:'right'}
  ],value=>{
    clearPicker(plaqueButtons);
    selectedView=value;
    viewSelect.textContent=value==='front'?'전면 구조':'오른쪽 측면 구조';
    viewSelect.hidden=false;
    plaqueSelect.hidden=true;
    navigate(comparisonCamera(value),value==='front'?'전면 직교':'오른쪽 측면 직교');
  });
  plaqueSelect.textContent=`${selectedPlaque.id} · ${selectedPlaque.name}`;
  viewSelect.textContent='전면 구조';
  plaqueSelect.hidden=true;
  viewSelect.hidden=true;

  function signCamera(sign){
    const rect=canvas.getBoundingClientRect();
    const aspect=Math.max(.1,rect.width/Math.max(rect.height,1));
    const verticalHalf=Math.tan(controls.state.fov*Math.PI/360);
    const horizontalHalf=verticalHalf*aspect;
    const distance=Math.max(
      sign.size[0]/(2*horizontalHalf*.42),
      sign.size[1]/(2*verticalHalf*.34)
    );
    const normal=[Math.sin(sign.yaw),0,Math.cos(sign.yaw)];
    const eye=sign.position.map((value,i)=>value+normal[i]*distance);
    return {
      eye,target:[...sign.position],up:[0,1,0],
      fov:controls.state.fov,halfHeight:distance*verticalHalf
    };
  }

  function comparisonCamera(kind){
    const comparison=model.comparisons[kind==='front'?0:1];
    const target=[...comparison.position];
    const aspect=Math.max(.1,canvas.clientWidth/Math.max(canvas.clientHeight,1));
    const halfHeight=kind==='front'?Math.max(1.7,2.25/aspect):Math.max(1.5,1.55/aspect);
    const distance=halfHeight/Math.tan(controls.state.fov*Math.PI/360);
    const eye=kind==='front'
      ?[target[0],target[1],target[2]+distance]
      :[target[0]+distance,target[1],target[2]];
    return {eye,target,up:[0,1,0],orthographic:true,halfHeight,gridAxis:kind,near:.02,far:180};
  }

  function overviewCamera(){
    const target=[3.25,4.4,0];
    const eye=[3.25,16.4,37].map((value,i)=>target[i]+(value-target[i])*.5);
    const distance=Math.hypot(...eye.map((value,i)=>value-target[i]));
    return {
      eye,target,up:[0,1,0],fov:controls.state.fov,
      halfHeight:distance*Math.tan(controls.state.fov*Math.PI/360)
    };
  }

  function cameraScale(camera){
    const distance=Math.hypot(...camera.eye.map((value,i)=>value-camera.target[i]));
    return camera.halfHeight||distance*Math.tan((camera.fov||controls.state.fov)*Math.PI/360);
  }

  function interpolateCamera(from,to,t){
    const eased=t*t*(3-2*t);
    const interpolate=(a,b)=>a.map((value,i)=>value+(b[i]-value)*eased);
    return {
      eye:interpolate(from.eye,to.eye),
      target:interpolate(from.target,to.target),
      up:interpolate(from.up||[0,1,0],to.up||[0,1,0]),
      fov:to.fov||controls.state.fov,
      orthographic:t===1?!!to.orthographic:!!from.orthographic,
      halfHeight:cameraScale(from)+(cameraScale(to)-cameraScale(from))*eased,
      gridAxis:to.gridAxis
    };
  }

  function orbitCamera(camera,progress){
    const eased=progress*progress*(3-2*progress);
    const angle=Math.PI*eased;
    const offset=camera.eye.map((value,i)=>value-camera.target[i]);
    const cosine=Math.cos(angle),sine=Math.sin(angle);
    const rotated=[
      offset[0]*cosine+offset[2]*sine,
      offset[1],
      -offset[0]*sine+offset[2]*cosine
    ];
    return {
      eye:camera.target.map((value,i)=>value+rotated[i]),
      target:[...camera.target],up:[...(camera.up||[0,1,0])],
      fov:camera.fov,halfHeight:cameraScale(camera)
    };
  }

  function navigate(destination,label,orbitBuilding=false){
    const from=activeView||controls.camera();
    move={
      from:{...from,eye:[...from.eye],target:[...from.target],up:[...(from.up||[0,1,0])]},
      overview:overviewCamera(),to:destination,label,phase:'outbound',
      orbitBuilding,start:performance.now(),duration:1000,hold:850,orbitDuration:2400
    };
    status.textContent=`카메라가 멀어져 전체 시설을 비춘 뒤 ${label}(으)로 이동합니다.`;
    canvas.focus({preventScroll:true});
  }

  function drawGrid(camera){
    const width=canvas.clientWidth,height=canvas.clientHeight;
    if(overlay.width!==canvas.width||overlay.height!==canvas.height){
      overlay.width=canvas.width;
      overlay.height=canvas.height;
    }
    overlay.style.width=`${width}px`;
    overlay.style.height=`${height}px`;
    grid.setTransform(
      overlay.width/Math.max(width,1),0,0,
      overlay.height/Math.max(height,1),0,0
    );
    grid.clearRect(0,0,width,height);
    if(!camera.orthographic||move)return;

    const scale=height/(2*camera.halfHeight);
    const side=camera.gridAxis==='right';
    const horizontalTarget=side?-camera.target[2]:camera.target[0];
    const xOrigin=width/2-horizontalTarget*scale;
    const yOrigin=height/2+camera.target[1]*scale;
    const firstX=Math.floor((-xOrigin/scale)*100);
    const lastX=Math.ceil(((width-xOrigin)/scale)*100);
    const firstY=Math.floor((-yOrigin/scale)*100);
    const lastY=Math.ceil(((height-yOrigin)/scale)*100);
    grid.lineWidth=1;
    [
      {modulus:100,color:'rgba(255,255,255,.88)'},
      {modulus:50,color:'rgba(255,255,255,.32)'},
      {modulus:10,color:'rgba(255,255,255,.06)'}
    ].forEach(({modulus,color})=>{
      grid.strokeStyle=color;
      grid.beginPath();
      for(let tick=firstX;tick<=lastX;tick++){
        if(tick%modulus!==0)continue;
        const px=xOrigin+(tick/100)*scale;
        grid.moveTo(px,0);
        grid.lineTo(px,height);
      }
      for(let tick=firstY;tick<=lastY;tick++){
        if(tick%modulus!==0)continue;
        const py=yOrigin+(tick/100)*scale;
        grid.moveTo(0,py);
        grid.lineTo(width,py);
      }
      grid.stroke();
    });
    grid.fillStyle='rgba(255,255,255,.96)';
    grid.font='11px sans-serif';
    grid.fillText('1m',10,18);
    grid.fillStyle='rgba(255,255,255,.52)';
    grid.fillText('50cm',38,18);
    grid.fillStyle='rgba(255,255,255,.2)';
    grid.fillText('10cm',80,18);
  }

  viewer.render=()=>{
    let camera=activeView||controls.camera();
    if(move){
      const now=performance.now();
      if(move.phase==='outbound'){
        const t=Math.min(1,(now-move.start)/move.duration);
        camera=interpolateCamera(move.from,move.overview,t);
        if(t===1){
          move.phase='hold';
          move.start=now;
          status.textContent='전체 시설을 확인한 뒤 선택한 위치로 이동합니다.';
        }
      }else if(move.phase==='hold'){
        camera=move.overview;
        if(now-move.start>=move.hold){
          move.phase=move.orbitBuilding?'orbit':'inbound';
          move.start=now;
          if(move.phase==='orbit'){
            status.textContent='건물 전체를 보여주며 카메라가 후면으로 회전합니다.';
          }else{
            move.inboundFrom=move.overview;
          }
        }
      }else if(move.phase==='orbit'){
        const t=Math.min(1,(now-move.start)/move.orbitDuration);
        camera=orbitCamera(move.overview,t);
        if(t===1){
          move.phase='inbound';
          move.start=now;
          move.inboundFrom=camera;
        }
      }else{
        const t=Math.min(1,(now-move.start)/move.duration);
        camera=interpolateCamera(move.inboundFrom||move.overview,move.to,t);
      }
      if(move.phase==='inbound'&&now-move.start>=move.duration){
        activeView=move.to;
        camera=activeView;
        move=null;
        status.textContent=`도착: ${activeView.orthographic
          ?(selectedView==='front'?'전면 직교':'오른쪽 측면 직교')
          :`${selectedPlaque.id} 명판`}`;
      }
      controls.setCamera(camera);
    }else if(controls.state.actions!==lastActionCount){
      lastActionCount=controls.state.actions;
      activeView=null;
      status.textContent='수동 탐색 중 · 직교 격자를 다시 보려면 직교 시점을 선택하세요.';
      camera=controls.camera();
    }
    viewer.drawView(camera);
    drawGrid(camera);
  };

  document.querySelector('#home').addEventListener('click',()=>{
    activeView=null;
    move=null;
    lastActionCount=controls.state.actions;
    status.textContent='전체 보기로 돌아왔습니다.';
    grid.clearRect(0,0,overlay.width,overlay.height);
  });
})();
