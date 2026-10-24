import * as T from 'three';
const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z),clamp=T.MathUtils.clamp;
const smooth=(a,b,x)=>T.MathUtils.smoothstep(x,a,b);
export const ACTIONS={bow:'고개 숙이기',nod:'고개 끄덕이기',look_left:'왼쪽 보기',look_right:'오른쪽 보기',raise_left_arm:'왼팔 올리기',raise_right_arm:'오른팔 올리기',raise_both_arms:'양팔 올리기',wave:'손 흔들기',smile:'미소',laugh:'환한 웃음',sad:'슬픔',cry:'우는 표정',surprised:'놀람',thinking:'생각',neutral:'바로 서기',stop:'현재 자세 유지',switch_side:'반대쪽',mountain:'산 자세',tree:'나무 자세',warrior1:'전사 1',warrior2:'전사 2',chair:'의자 자세',downward_dog:'다운독',cobra:'코브라',child:'아기 자세',mixamo:'불러온 Mixamo 동작'};
export const YOGA=['mountain','tree','warrior1','warrior2','chair','downward_dog','cobra','child'];
export function parseCommand(text){const a=[];const names=[['산 자세','mountain'],['나무','tree'],['전사 1','warrior1'],['전사 일','warrior1'],['전사 2','warrior2'],['전사 이','warrior2'],['의자 자세','chair'],['다운독','downward_dog'],['다운 도그','downward_dog'],['코브라','cobra'],['아기 자세','child']];for(const [s,n] of names)if(text.includes(s))a.push(n);if(/반대쪽/.test(text))a.push('switch_side');if(/그만|바로 서|차렷|원래 자세/.test(text))a.push('neutral');else if(/멈춰|정지/.test(text))a.push('stop');if(/고개.*숙|인사해/.test(text))a.push('bow');if(/끄덕/.test(text))a.push('nod');if(/왼쪽.*(봐|보)|왼편/.test(text))a.push('look_left');if(/오른쪽.*(봐|보)|오른편/.test(text))a.push('look_right');if(/양팔|두 팔/.test(text))a.push('raise_both_arms');else{if(/왼팔|왼 팔/.test(text))a.push('raise_left_arm');if(/오른팔|오른 팔/.test(text))a.push('raise_right_arm');}if(/흔들/.test(text))a.push('wave');if(/크게 웃|활짝/.test(text))a.push('laugh');else if(/웃|미소/.test(text))a.push('smile');if(/슬프|슬픈/.test(text))a.push('sad');if(/울어|우는/.test(text))a.push('cry');if(/놀라|놀란/.test(text))a.push('surprised');if(/믹사모|mixamo/i.test(text))a.push('mixamo');const d=Number(/(\d+)\s*초/.exec(text)?.[1]||8);return {actions:[...new Set(a)],duration:d,side:/오른/.test(text)?'right':'left'};}
export class CharacterRig {
 constructor(root){this.root=root;this.bones={};this.meshes=[];this.rest={};this.now=0;this.pose='neutral';this.expression='neutral';this.strength=.6;this.side=1;this.expiry=0;this.exprExpiry=0;this.frozen=false;this.faceWeights={};this.nextBlink=2;this.blinkAt=-10;
  root.updateMatrixWorld(true);root.traverse(o=>{if(o.isBone)this.bones[o.name]=o;if(o.isSkinnedMesh)this.meshes.push(o);});
  this.addLegs();root.updateMatrixWorld(true);
  for(const [n,b] of Object.entries(this.bones))this.rest[n]={q:b.quaternion.clone(),wq:b.getWorldQuaternion(new T.Quaternion()),p:b.getWorldPosition(V()),local:b.position.clone()};
  this.rootRest=this.bones.root.position.clone();this.prepareFace();this.gaze=V();
 }
 addLegs(){const sk=this.meshes[0].skeleton;for(const side of ['L','R']){const x=side==='L'?.18:-.18;let parent=this.bones.root;for(const [name,pos] of [['thigh',V(x,-.06,-.03)],['shin',V(0,-.82,0)],['foot',V(0,-.75,0)]]){const b=new T.Bone();b.name=name+'_'+side;b.position.copy(pos);parent.add(b);this.bones[b.name]=b;sk.bones.push(b);parent=b;}}
  this.root.updateMatrixWorld(true);while(sk.boneInverses.length<sk.bones.length)sk.boneInverses.push(sk.bones[sk.boneInverses.length].matrixWorld.clone().invert());sk.boneMatrices=new Float32Array(sk.bones.length*16);if(sk.boneTexture){sk.boneTexture.dispose();sk.boneTexture=null;}
  const rootIndex=sk.bones.indexOf(this.bones.root);
  for(const mesh of this.meshes){mesh.skeleton=sk;const pos=mesh.geometry.attributes.position,joints=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight;if(!pos||!joints)continue;
   for(let i=0;i<pos.count;i++){const y=pos.getY(i),x=pos.getX(i);if(y>=1.78||!['body','sock','dress'].includes(mesh.name)||(mesh.name==='body'&&Math.abs(x)>.35))continue;const side=x>=0?'L':'R',thigh=sk.bones.indexOf(this.bones['thigh_'+side]),shin=sk.bones.indexOf(this.bones['shin_'+side]),foot=sk.bones.indexOf(this.bones['foot_'+side]);let wt=1-smooth(1.5,1.78,y),ws=1-smooth(.76,1.02,y),wf=1-smooth(.12,.28,y);if(mesh.name==='dress')wt*=.25;const vals=[1-wt,wt*(1-ws),wt*ws*(1-wf),wt*ws*wf];joints.setXYZW(i,rootIndex,thigh,shin,foot);weights.setXYZW(i,...vals);}joints.needsUpdate=true;weights.needsUpdate=true;
  }
 }
 prepareFace(){this.faces=[];
  for(const mesh of this.meshes){if(mesh.name==='eyes'){this.eye=mesh;this.eyeOriginal=mesh.geometry.attributes.position.array.slice();this.eyeNormals=mesh.geometry.attributes.normal.array.slice();mesh.morphTargetInfluences?.fill(0);continue;}if(!['body','eyelashes'].includes(mesh.name))continue;
   const geo=mesh.geometry,pos=geo.attributes.position;const existing=geo.morphAttributes.position||[],dict=mesh.morphTargetDictionary||{};const targets={};
   // Keep a limited jaw/round shape. Replace expression and eyelid deltas with bounded, independent shapes.
   for(const n of ['jawOpen','mouthRound']){if(dict[n]!==undefined)targets[n]=existing[dict[n]].clone();}
   for(const name of ['smile','cheek','frown','innerBrow','browUp','blink']){const arr=new Float32Array(pos.count*3);for(let i=0;i<pos.count;i++){const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i),ax=Math.abs(x),front=smooth(.025,.075,z),ga=(cx,cy,sx,sy)=>Math.exp(-(((ax-cx)/sx)**2)-(((y-cy)/sy)**2))*front;let dx=0,dy=0,dz=0;
    if(name==='smile'){const w=ga(.035,2.853,.025,.024);dx=Math.sign(x)*.004*w;dy=.006*w;dz=-.001*w;}
    if(name==='cheek'){const w=ga(.075,2.925,.037,.033);dy=.003*w;dz=.002*w;}
    if(name==='frown'){const w=ga(.035,2.853,.023,.021);dy=-.0045*w;dx=-Math.sign(x)*.0015*w;}
    if(name==='innerBrow'){const w=ga(.033,3.035,.023,.022);dy=.006*w;}
    if(name==='browUp'){dy=.006*ga(.06,3.035,.043,.025);}
    if(name==='blink'){const cx=.0595,cy=2.980,edge=1-smooth(.022,.042,Math.abs(ax-cx));const vertical=1-smooth(.022,.055,Math.abs(y-cy));const w=edge*vertical*front;dy=(cy-y)*w;dz=.003*w;if(mesh.name==='eyelashes'){const ew=edge*(1-smooth(.035,.06,Math.abs(y-cy)));dy=(cy-y)*ew;dz=.001*ew;}}
    arr[i*3]=dx;arr[i*3+1]=dy;arr[i*3+2]=dz;
   }targets[name]=new T.Float32BufferAttribute(arr,3);}
   geo.morphAttributes.position=Object.values(targets);delete geo.morphAttributes.normal;geo.morphTargetsRelative=true;mesh.updateMorphTargets();mesh.morphTargetDictionary=Object.fromEntries(Object.keys(targets).map((n,i)=>[n,i]));this.faces.push(mesh);
  }
 }
 action(name,duration=8,intensity=.6,side){if(!(name in ACTIONS))return {ok:false,message:'지원하지 않는 동작입니다.'};if(name==='mixamo'&&!this.mixamoClip)return {ok:false,message:'먼저 Mixamo FBX 파일을 불러와 주세요.'};duration=clamp(Number(duration)||8,1,120);this.strength=clamp(Number(intensity)||.6,.1,1);
  if(['smile','laugh','sad','cry','surprised','thinking'].includes(name)){this.expression=name;this.exprExpiry=this.now+duration;return {ok:true,action:name};}
  if(name==='stop'){this.frozen=true;this.expiry=Infinity;this.mixer?.timeScale&&(this.mixer.timeScale=0);return {ok:true,action:name};}
  if(name==='switch_side'){this.side*=-1;this.frozen=false;this.expiry=this.now+duration+1.8;return {ok:true,action:this.pose,side:this.side===1?'left':'right'};}
  this.frozen=false;this.pose=name;this.side=side==='right'?-1:1;this.started=this.now;this.expiry=this.now+duration+1.8;this.mixer?.stopAllAction();
  if(name==='mixamo'){this.mixer.timeScale=1;this.mixer.clipAction(this.mixamoClip).reset().play();}
  if(name==='neutral'){this.expression='neutral';this.exprExpiry=0;}
  return {ok:true,action:name,duration,source:YOGA.includes(name)?'직접 제작한 관절 애니메이션':'캐릭터 동작'};
 }
 rotateWorld(name,rotation,k){const b=this.bones[name],r=this.rest[name];if(!b)return;const world=new T.Quaternion().setFromEuler(new T.Euler(...rotation)).multiply(r.wq),parent=b.parent.getWorldQuaternion(new T.Quaternion()).invert();b.quaternion.slerp(parent.multiply(world),k);b.updateWorldMatrix(false,true);}
 aim(name,child,target,k){const b=this.bones[name],rest=this.rest[name],c=this.rest[child];if(!b||!c)return;const origin=b.getWorldPosition(V()),direction=target.clone().sub(origin).normalize(),original=c.p.clone().sub(rest.p).normalize();const q=new T.Quaternion().setFromUnitVectors(original,direction).multiply(rest.wq),parent=b.parent.getWorldQuaternion(new T.Quaternion()).invert();b.quaternion.slerp(parent.multiply(q),k);b.updateWorldMatrix(false,true);}
 limb(a,b,c,target,pole,k){const start=this.bones[a].getWorldPosition(V()),l1=this.rest[a].p.distanceTo(this.rest[b].p),l2=this.rest[b].p.distanceTo(this.rest[c].p),d=clamp(start.distanceTo(target),Math.abs(l1-l2)+.002,l1+l2-.002),axis=target.clone().sub(start).normalize(),along=(l1*l1-l2*l2+d*d)/(2*d),height=Math.sqrt(Math.max(0,l1*l1-along*along)),bend=pole.clone().sub(start);bend.addScaledVector(axis,-bend.dot(axis)).normalize();if(bend.lengthSq()<.01)bend.set(0,0,1);const elbow=start.clone().addScaledVector(axis,along).addScaledVector(bend,height);this.aim(a,b,elbow,k);this.aim(b,c,target,k);}
 update(dt,camera,audio={}){this.now+=dt;const t=this.now,k=1-Math.exp(-dt*7);if(t>this.expiry&&this.pose!=='neutral'){this.pose='neutral';this.mixer?.stopAllAction();}if(t>this.exprExpiry)this.expression='neutral';
  if(this.pose==='mixamo'&&this.mixer){if(!this.frozen)this.mixer.update(dt);}else if(!this.frozen)this.body(k,t,camera);
  this.face(dt,t,camera,audio);
 }
 body(k,t,camera){const root=this.bones.root,side=this.side,p=this.pose;let rp=V(0,1.75,0),rootRot=[0,0,0],spine=[0,0,0],head=[0,0,0],left=V(.47,1.8,.02),right=V(-.47,1.8,.02),lf=V(.18,.12,-.03),rf=V(-.18,.12,-.03),lp=V(.5,1,.7),rpol=V(-.5,1,.7),armPoleL=V(.8,2.1,.3),armPoleR=V(-.8,2.1,.3);
  if(p==='bow'){spine=[.2,0,0];head=[.35,0,0];}if(p==='nod')head=[Math.sin((t-this.started)*4)*.15,0,0];if(p==='look_left')head=[0,.5,0];if(p==='look_right')head=[0,-.5,0];
  if(['raise_left_arm','raise_both_arms'].includes(p))left=V(.32,3.45,.02);if(['raise_right_arm','raise_both_arms'].includes(p))right=V(-.32,3.45,.02);if(p==='wave'){right=V(-.6+Math.sin(t*6)*.08,3.02,.2);armPoleR=V(-1.1,2.4,0);}
  if(p==='tree'){rp.x=-.1*side;const foot=V(.07*side,.88,-.01);if(side===1){lf=foot;lp=V(1,1.3,.05);}else{rf=foot;rpol=V(-1,1.3,.05);}left=V(.035,2.45,.42);right=V(-.035,2.45,.42);armPoleL=V(.7,2.2,.2);armPoleR=V(-.7,2.2,.2);}
  if(p==='warrior1'){rp=V(0,1.4,.1);lf=V(.2,.12,.65*side);rf=V(-.2,.12,-.65*side);left=V(.28,3.08,.12);right=V(-.28,3.08,.12);lp=V(.25,.8,1);rpol=V(-.25,.8,1);}
  if(p==='warrior2'){rp=V(.18*side,1.4,0);lf=V(.8,.12,0);rf=V(-.8,.12,0);lp=V(1.3,.9,.1);rpol=V(-1.3,.9,.1);left=V(1.2,2.28,0);right=V(-1.2,2.28,0);head=[0,.45*side,0];}
  if(p==='chair'){rp=V(0,1.32,-.34);spine=[.22,0,0];left=V(.3,2.92,.55);right=V(-.3,2.92,.55);lp=V(.22,.7,.7);rpol=V(-.22,.7,.7);}
  if(p==='downward_dog'){rp=V(0,1.35,0);rootRot=[2.2,0,0];spine=[2.2,0,0];lf=V(.2,.12,-.72);rf=V(-.2,.12,-.72);left=V(.27,.16,1.1);right=V(-.27,.16,1.1);armPoleL=V(.4,.6,1);armPoleR=V(-.4,.6,1);lp=V(.2,.7,-.8);rpol=V(-.2,.7,-.8);head=[1.65,0,0];}
  if(p==='cobra'){rp=V(0,.33,-.15);rootRot=[1.05,0,0];spine=[.35,0,0];head=[0,0,0];lf=V(.18,.12,-1.55);rf=V(-.18,.12,-1.55);lp=V(.18,.3,-1);rpol=V(-.18,.3,-1);left=V(.32,.13,.67);right=V(-.32,.13,.67);armPoleL=V(.6,.6,.3);armPoleR=V(-.6,.6,.3);}
  if(p==='child'){rp=V(0,.52,-.3);rootRot=[1.75,0,0];spine=[1.8,0,0];head=[1.8,0,0];lf=V(.2,.12,-.65);rf=V(-.2,.12,-.65);lp=V(.35,.15,.6);rpol=V(-.35,.15,.6);left=V(.3,.15,1.35);right=V(-.3,.15,1.35);armPoleL=V(.4,.15,.9);armPoleR=V(-.4,.15,.9);}
  root.position.lerp(rp,k*.6);this.rotateWorld('root',rootRot,k);this.rotateWorld('spine',spine,k);
  const yoga=YOGA.includes(p);if(!yoga&&p==='neutral'){const pos=this.bones.head.getWorldPosition(V()),to=camera.position.clone().sub(pos);head=[clamp(-Math.atan2(to.y,Math.hypot(to.x,to.z)),-.12,.12),clamp(Math.atan2(to.x,to.z),-.22,.22),0];}
  this.rotateWorld('head',head,k*.6);this.limb('thigh_L','shin_L','foot_L',lf,lp,k);this.limb('thigh_R','shin_R','foot_R',rf,rpol,k);this.rotateWorld('foot_L',[0,0,0],k);this.rotateWorld('foot_R',[0,0,0],k);
  this.limb('upperArm_L','forearm_L','hand_L',left,armPoleL,k);this.limb('upperArm_R','forearm_R','hand_R',right,armPoleR,k);if(['downward_dog','child','cobra'].includes(p)){this.rotateWorld('hand_L',[Math.PI/2,0,Math.PI],k);this.rotateWorld('hand_R',[Math.PI/2,0,Math.PI],k);}
 }
 face(dt,t,camera,audio){if(t>this.nextBlink){this.blinkAt=t;this.nextBlink=t+2.6+Math.random()*4.7;}const phase=(t-this.blinkAt)/.23,blink=phase>=0&&phase<1?Math.sin(Math.PI*phase):0,e=this.expression,s=this.strength;
  const levels={smile:e==='smile'?.6*s:e==='laugh'?s:0,cheek:e==='smile'?.5*s:e==='laugh'?.9*s:0,frown:['sad','cry'].includes(e)?s:0,innerBrow:['sad','cry'].includes(e)?s:0,browUp:e==='surprised'?.8*s:e==='thinking'?.2:0,blink,jawOpen:Math.min(.45,(audio.open||0)+(e==='surprised'?.15:e==='laugh'?.08:0)),mouthRound:Math.min(.35,audio.round||0)};
  for(const [n,v] of Object.entries(levels)){this.faceWeights[n]=(this.faceWeights[n]||0)+(v-(this.faceWeights[n]||0))*(n==='blink'?1:1-Math.exp(-dt*(n==='jawOpen'?26:7)));for(const mesh of this.faces){const i=mesh.morphTargetDictionary[n];if(i!==undefined)mesh.morphTargetInfluences[i]=this.faceWeights[n];}}
  if(!this.eye)return;const head=this.bones.head,local=camera.position.clone().applyMatrix4(head.matrixWorld.clone().invert()),yaw=YOGA.includes(this.pose)?0:clamp(Math.atan2(local.x,local.z),-.3,.3),pitch=YOGA.includes(this.pose)?0:clamp(-Math.atan2(local.y-.22,Math.hypot(local.x,local.z)),-.16,.16);this.gaze.lerp(V(pitch,yaw,0),1-Math.exp(-dt*9));const q=new T.Quaternion().setFromEuler(new T.Euler(this.gaze.x,this.gaze.y,0)),pos=this.eye.geometry.attributes.position,norm=this.eye.geometry.attributes.normal;
  for(let i=0;i<pos.count;i++){const j=i*3,c=V(this.eyeOriginal[j]>=0?.0591:-.0598,2.9793,.0645),v=V(this.eyeOriginal[j],this.eyeOriginal[j+1],this.eyeOriginal[j+2]).sub(c).applyQuaternion(q).add(c),n=V(this.eyeNormals[j],this.eyeNormals[j+1],this.eyeNormals[j+2]).applyQuaternion(q);pos.setXYZ(i,v.x,v.y,v.z);norm.setXYZ(i,n.x,n.y,n.z);}pos.needsUpdate=true;norm.needsUpdate=true;
 }
}
