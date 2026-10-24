import * as THREE from 'three';
import {FBXLoader} from './vendor/FBXLoader.js';
import {retargetClip} from './vendor/SkeletonUtils.js';
export async function importMixamo(file,rig){
 if(!/\.fbx$/i.test(file.name))throw Error('FBX 파일을 선택해 주세요.');if(file.size>40*1024*1024)throw Error('40MB 이하의 Without Skin FBX를 사용해 주세요.');
 // Imported files are local only. No model, motion or credential is uploaded.
 const manager=new THREE.LoadingManager();manager.setURLModifier(()=> 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9X0AAAAASUVORK5CYII=');
 const source=new FBXLoader(manager).parse(await file.arrayBuffer(),'');const clip=source.animations[0];if(!clip||clip.duration<=0)throw Error('애니메이션이 포함된 FBX가 아닙니다.');if(clip.duration>120)throw Error('120초 이내의 동작을 사용해 주세요.');
 const bones=[];source.traverse(o=>{if(o.isBone)bones.push(o);});const find=s=>bones.find(b=>b.name.replace(/^mixamorig[:_]?/i,'')===s)?.name;
 const mapping={root:'Hips',spine:'Spine',neck:'Neck',head:'Head',upperArm_L:'LeftArm',forearm_L:'LeftForeArm',hand_L:'LeftHand',upperArm_R:'RightArm',forearm_R:'RightForeArm',hand_R:'RightHand',thigh_L:'LeftUpLeg',shin_L:'LeftLeg',foot_L:'LeftFoot',thigh_R:'RightUpLeg',shin_R:'RightLeg',foot_R:'RightFoot'},names={};for(const [target,src] of Object.entries(mapping)){const n=find(src);if(n)names[target]=n;}
 if(Object.keys(names).length<14)throw Error('Mixamo 사람형 골격을 확인할 수 없습니다.');source.skeleton=new THREE.Skeleton(bones);source.updateMatrixWorld(true);const target=rig.meshes[0],saved=target.skeleton.bones.map(b=>({b,p:b.position.clone(),q:b.quaternion.clone()}));
 try{const converted=retargetClip(target,source,clip,{names,hip:find('Hips'),fps:24,preserveBonePositions:true,useFirstFramePosition:true,hipInfluence:new THREE.Vector3(0,0,0)});converted.tracks=converted.tracks.filter(t=>!t.name.endsWith('.position'));if(!converted.tracks.length)throw Error('변환 가능한 관절 트랙이 없습니다.');rig.mixer?.stopAllAction();rig.mixer=new THREE.AnimationMixer(target);rig.mixamoClip=converted;}finally{for(const {b,p,q} of saved){b.position.copy(p);b.quaternion.copy(q);}rig.root.updateMatrixWorld(true);source.traverse(o=>{if(o.isMesh){o.geometry?.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});}
}
