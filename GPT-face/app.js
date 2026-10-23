import * as THREE from 'three';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {OrbitControls} from './vendor/OrbitControls.js';
const $=id=>document.getElementById(id);
const ui={state:'ready',connected:false,modelReady:false};
let avatar,bones={},base={},armAxes={},morphs=[],pose={headX:0,headY:0,spineX:0,left:0,right:0,leftElbow:0,rightElbow:0},poseUntil=0,waving=false,expression='neutral',expressionUntil=0;
let pc,dc,mic,ctx,analyser,source,audio,callAbort,connectionTimer,streamData,frequencyData,connecting=false,muted=false,userSpeaking=false,assistantSpeaking=false,activeResponse=null,toolFollowup=false;
let apiKey='',modelName='gpt-realtime',voice='marin';
const canceledResponses=new Set(),toolCalls=new Set();let clock=new THREE.Clock(),nextBlink=2.5,blinkStart=-10,smoothedMouth=0,roundMouth=0,viewGoal=null;
const viewport=$('viewport'),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(33,1,.01,100);
let renderer;try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});}catch{$('loading').textContent='이 브라우저에서 3D 가속을 사용할 수 없습니다. Chrome/Edge의 하드웨어 가속을 켜고 새로고침해 주세요.';viewport.style.background='url(./portrait.jpg) center 30% / auto 95% no-repeat';}
if(renderer){renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.setClearColor(0x000000,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;viewport.appendChild(renderer.domElement);}
camera.position.set(0,2.92,1.55);const controls=new OrbitControls(camera,renderer?.domElement||viewport);controls.target.set(0,2.83,0);controls.enableDamping=true;controls.minDistance=.48;controls.maxDistance=8;controls.maxPolarAngle=Math.PI*.82;
scene.add(new THREE.HemisphereLight(0xfff9ed,0x70826d,2));const keyLight=new THREE.DirectionalLight(0xfff6e9,3.2);keyLight.position.set(-2,4,4);scene.add(keyLight);const fill=new THREE.DirectionalLight(0xe1eaff,1.5);fill.position.set(2,3,2);scene.add(fill);const rim=new THREE.DirectionalLight(0xffdfb3,2);rim.position.set(1,4,-2);scene.add(rim);
const resize=new ResizeObserver(()=>{const w=viewport.clientWidth,h=viewport.clientHeight;renderer?.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();});resize.observe(viewport);
function setView(mode){viewGoal=mode==='body'?{p:new THREE.Vector3(0,1.85,6.5),t:new THREE.Vector3(0,1.75,0)}:{p:new THREE.Vector3(0,2.96,1.75),t:new THREE.Vector3(0,2.83,0)};}
$('faceView').onclick=()=>setView('face');$('bodyView').onclick=()=>setView('body');$('resetView').onclick=()=>setView('face');controls.addEventListener('start',()=>viewGoal=null);
async function loadAvatar(onLoad,onProgress,onError){try{const manifest=await (await fetch('./model.json')).json();const buffers=[];for(let i=0;i<manifest.parts.length;i++){const r=await fetch(manifest.parts[i]);if(!r.ok)throw new Error('Model part unavailable');buffers.push(await r.arrayBuffer());onProgress({loaded:i+1,total:manifest.parts.length});}const decoded=new Blob(buffers).stream().pipeThrough(new DecompressionStream('gzip'));const bytes=await new Response(decoded).arrayBuffer();if(bytes.byteLength!==manifest.byteLength)throw new Error('Model length mismatch');new GLTFLoader().parse(bytes,'./',onLoad,onError);}catch(e){onError(e);}}
loadAvatar(g=>{avatar=g.scene;scene.add(avatar);avatar.traverse(o=>{if(o.isBone){bones[o.name]=o;base[o.name]=o.quaternion.clone();armAxes[o.name]=new THREE.Vector3(0,0,1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()).invert());}if(o.morphTargetDictionary)morphs.push(o);if(o.isMesh){o.frustumCulled=false;for(const m of(Array.isArray(o.material)?o.material:[o.material])){m.side=THREE.DoubleSide;if(/hair|lash/i.test(m.name)){m.alphaTest=.4;m.transparent=false;m.depthWrite=true;}if(m.map)m.map.anisotropy=4;}}});if(renderer)$('loading').hidden=true;ui.modelReady=true;setView('face');},p=>{if(renderer&&p.total)$('loading').textContent=`Tasha를 준비하고 있습니다… ${Math.round(p.loaded/p.total*100)}%`;},()=>{$('loading').textContent='모델을 불러오지 못했습니다. 페이지를 새로고침해 주세요.';});
function rotArm(name,angle,k){if(!bones[name])return;const q=base[name].clone().multiply(new THREE.Quaternion().setFromAxisAngle(armAxes[name],angle));bones[name].quaternion.slerp(q,k);}
function blend(name,value){for(const o of morphs){const index=o.morphTargetDictionary[name];if(index!==undefined)o.morphTargetInfluences[index]=value;}}
function rot(name,x,y,z,k){if(!bones[name])return;const q=base[name].clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(x,y,z)));bones[name].quaternion.slerp(q,k);}
const labels={bow:'고개를 숙입니다',nod:'고개를 끄덕입니다',look_left:'왼쪽을 봅니다',look_right:'오른쪽을 봅니다',raise_left_arm:'왼팔을 올립니다',raise_right_arm:'오른팔을 올립니다',raise_both_arms:'두 팔을 올립니다',wave:'손을 흔듭니다',smile:'미소를 짓습니다',surprised:'놀란 표정을 짓습니다',sad:'슬픈 표정을 짓습니다',neutral:'편안한 자세로 돌아옵니다'};
function action(name,duration=4,intensity=1,append=false){if(!ui.modelReady){notice('모델을 불러온 뒤 동작을 사용할 수 있습니다.');return false;}if(!renderer){notice('현재 3D 가속을 사용할 수 없어 동작을 표시할 수 없습니다.');return false;}if(!(name in labels))return false;
 const a=Math.max(.1,Math.min(1,Number(intensity)||1));duration=Math.max(1,Math.min(12,Number(duration)||4));
 if(['smile','surprised','sad'].includes(name)){expression=name;expressionUntil=clock.elapsedTime+duration;}
 else {if(!append){pose={headX:0,headY:0,spineX:0,left:0,right:0,leftElbow:0,rightElbow:0};waving=false;}
 if(name==='bow'){pose.headX=.45*a;pose.spineX=.18*a;}
 if(name==='nod')pose.headX=.18*a;
 if(name==='look_left')pose.headY=.65*a;if(name==='look_right')pose.headY=-.65*a;
 if(name==='raise_left_arm'||name==='raise_both_arms')pose.left=1.5*a;
 if(name==='raise_right_arm'||name==='raise_both_arms')pose.right=-1.5*a;
 if(name==='wave'){pose.right=-1.65*a;pose.rightElbow=-.55*a;waving=true;}
 if(name==='neutral'){expression='neutral';expressionUntil=0;}
 poseUntil=clock.elapsedTime+duration;}
 notice(labels[name]);return true;
}
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>action(b.dataset.action));
function notice(text){$('notice').textContent=text;}
function setState(state){ui.state=state;const map={ready:['READY TO MEET','눈을 맞추고,<br>이야기를 나눠 보세요.','말씀하시면 듣고, 대답하며 움직이는 Tasha'],connecting:['CONNECTING','목소리를 연결하고 있어요.','마이크 사용을 허용해 주세요.'],listening:['I’M LISTENING','말씀을 듣고 있어요.','편하게 끝까지 말씀해 주세요.'],thinking:['THINKING','이야기를 생각하고 있어요.','잠시만 기다려 주세요.'],speaking:['TASHA IS SPEAKING','함께 이야기해요.','말씀을 시작하시면 멈추고 듣겠습니다.'],connected:['CONNECTED','안녕하세요, Tasha입니다.','이제 편하게 말을 걸어 주세요.']};const v=map[state]||map.ready;$('state').textContent=v[0];$('headline').innerHTML=v[1];$('subtitle').textContent=v[2];}
function message(role,text,id){const chat=$('chat');chat.querySelector('.welcome')?.remove();let div=id?chat.querySelector(`[data-item="${CSS.escape(id)}"]`):null;if(!div){div=document.createElement('div');div.className='message '+role;if(id)div.dataset.item=id;const b=document.createElement('b');b.textContent=role==='user'?'YOU':role==='assistant'?'TASHA':'안내';const span=document.createElement('span');div.append(b,span);chat.append(div);}div.querySelector('span').textContent=text;chat.scrollTop=chat.scrollHeight;return div;}
function send(event){if(dc?.readyState==='open'){dc.send(JSON.stringify(event));return true;}return false;}
function sessionConfig(){return {type:'realtime',model:modelName,output_modalities:['audio'],instructions:'당신은 화면의 3D 캐릭터 Tasha입니다. 한국어 존댓말로 따뜻하고 자연스럽게 짧게 대화하세요. 사용자가 끼어들면 이전 답을 계속하지 말고 마지막 말을 끝까지 듣고 맥락을 반영해 답하세요. 실제 사람이 아닌 AI 캐릭터이며 사용자를 카메라로 보고 있지는 않습니다. 신체 행동이나 표정 요청에는 반드시 perform_action 도구를 호출하여 실행한 뒤 간결히 답하세요. 왼쪽과 오른쪽은 캐릭터 본인의 기준입니다. 일반 대화에서도 적절할 때 가벼운 미소나 고개 끄덕임을 사용할 수 있지만 지나치게 동작하지 마세요. 도구로 제공된 동작만 실행 가능하며 임의의 동작을 했다고 말하지 마세요.',audio:{input:{noise_reduction:{type:'near_field'},transcription:{model:'gpt-4o-mini-transcribe',language:'ko'},turn_detection:{type:'server_vad',threshold:Number($('sensitivity').value),prefix_padding_ms:350,silence_duration_ms:850,interrupt_response:true,create_response:true}},output:{voice}},tools:[{type:'function',name:'perform_action',description:'Tasha의 관절과 표정을 실제로 움직입니다. 동작이나 표정 요청을 받으면 사용하세요.',parameters:{type:'object',properties:{actions:{type:'array',items:{type:'string',enum:Object.keys(labels)},maxItems:5},duration:{type:'number',description:'지속시간, 1~12초'},intensity:{type:'number',description:'강도 0.1~1'}},required:['actions'],additionalProperties:false}}],tool_choice:'auto'};}
async function start(){if(connecting||ui.connected)return;if(!ui.modelReady){notice('캐릭터가 준비될 때까지 잠시 기다려 주세요.');return;}if(!apiKey){$('settings').showModal();return;}if(!window.isSecureContext||!navigator.mediaDevices){notice('마이크 대화는 HTTPS 주소 또는 localhost에서 열어 주세요.');return;}
 connecting=true;$('connect').disabled=true;setState('connecting');callAbort=new AbortController();connectionTimer=setTimeout(()=>{if(connecting){stop();notice('연결 시간이 초과됐습니다. 네트워크와 API 설정을 확인해 주세요.');}},35000);
 const signal=callAbort.signal;
 try{
  ctx=new AudioContext();await ctx.resume();
  const localStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
  if(signal.aborted){localStream.getTracks().forEach(t=>t.stop());return;}mic=localStream;
  pc=new RTCPeerConnection();audio=document.createElement('audio');audio.autoplay=true;audio.playsInline=true;
  pc.ontrack=e=>{if(signal.aborted)return;const remote=e.streams[0]||new MediaStream([e.track]);audio.srcObject=remote;audio.play().catch(()=>notice('음성 재생을 허용하려면 화면을 눌러 주세요.'));source=ctx.createMediaStreamSource(remote);analyser=ctx.createAnalyser();analyser.fftSize=512;analyser.smoothingTimeConstant=.45;source.connect(analyser);streamData=new Float32Array(analyser.fftSize);frequencyData=new Uint8Array(analyser.frequencyBinCount);};
  mic.getTracks().forEach(t=>pc.addTrack(t,mic));dc=pc.createDataChannel('oai-events');dc.onmessage=e=>{try{handleEvent(JSON.parse(e.data));}catch{notice('음성 이벤트를 처리하지 못했습니다.');}};
  dc.onopen=()=>{if(signal.aborted)return;clearTimeout(connectionTimer);connecting=false;ui.connected=true;document.body.classList.add('connected');$('connection').textContent='대화 중';$('connect').textContent='연결됨';$('connect').disabled=true;$('disconnect').disabled=false;$('mute').disabled=false;setState('connected');notice('마이크가 켜져 있습니다. 말씀을 시작해 주세요.');};
  dc.onclose=()=>{if(!signal.aborted){stop();notice('음성 연결이 종료됐습니다. 다시 연결해 주세요.');}};
  pc.onconnectionstatechange=()=>{if(pc?.connectionState==='failed'){stop();notice('연결이 끊겼습니다. 다시 시작해 주세요.');}};
  const offer=await pc.createOffer();await pc.setLocalDescription(offer);
  const tokenResponse=await fetch('https://api.openai.com/v1/realtime/client_secrets',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},body:JSON.stringify({session:sessionConfig()}),signal});
  const token=await tokenResponse.json();if(!tokenResponse.ok)throw new Error(token.error?.message||'API 키 또는 사용 한도를 확인해 주세요.');if(!token.value)throw new Error('임시 음성 연결 키를 받지 못했습니다.');
  const answer=await fetch('https://api.openai.com/v1/realtime/calls',{method:'POST',headers:{Authorization:`Bearer ${token.value}`,'Content-Type':'application/sdp'},body:offer.sdp,signal});
  if(!answer.ok){let reason;try{reason=JSON.parse(await answer.text()).error?.message;}catch{}throw new Error(reason||'실시간 음성 연결에 실패했습니다.');}
  await pc.setRemoteDescription({type:'answer',sdp:await answer.text()});
 }catch(e){if(signal.aborted)return;stop();notice(e.name==='NotAllowedError'?'마이크 권한을 허용한 뒤 다시 시작해 주세요.':e.message||'연결하지 못했습니다.');message('system',$('notice').textContent);}
}
function stop(){callAbort?.abort();clearTimeout(connectionTimer);const channel=dc;dc=null;if(channel){channel.onclose=null;channel.close();}const peer=pc;pc=null;if(peer){peer.onconnectionstatechange=null;peer.ontrack=null;peer.close();}mic?.getTracks().forEach(t=>t.stop());mic=null;if(audio){audio.pause();audio.srcObject=null;audio=null;}source?.disconnect();source=null;ctx?.close().catch(()=>{});ctx=null;analyser=null;streamData=null;frequencyData=null;connecting=false;muted=false;userSpeaking=false;assistantSpeaking=false;activeResponse=null;toolFollowup=false;toolCalls.clear();canceledResponses.clear();ui.connected=false;document.body.classList.remove('connected');$('connection').textContent='연결 전';$('connect').textContent='마이크로 대화 시작';$('connect').disabled=false;$('disconnect').disabled=true;$('mute').disabled=true;$('mute').textContent='마이크 끄기';setState('ready');}
$('connect').onclick=start;$('disconnect').onclick=()=>{stop();notice('대화를 종료했습니다. 마이크 사용도 중지했습니다.');};$('mute').onclick=()=>{muted=!muted;mic?.getAudioTracks().forEach(t=>t.enabled=!muted);$('mute').textContent=muted?'마이크 켜기':'마이크 끄기';notice(muted?'마이크가 꺼져 있습니다.':'마이크가 켜져 있습니다.');};
function interrupt(){if(activeResponse)canceledResponses.add(activeResponse);assistantSpeaking=false;userSpeaking=true;if(audio)audio.volume=0;smoothedMouth=0;setState('listening');}
function handleEvent(e){
 if(e.type==='error'){if(e.error?.code!=='response_cancel_not_active'){notice(e.error?.message||'음성 서버 오류가 발생했습니다.');}return;}
 if(e.type==='input_audio_buffer.speech_started'){interrupt();return;}
 if(e.type==='input_audio_buffer.speech_stopped'){userSpeaking=false;setState('thinking');return;}
 if(e.type==='conversation.item.input_audio_transcription.completed'){message('user',e.transcript,e.item_id);return;}
 if(e.type==='conversation.item.input_audio_transcription.failed'){notice('자막 변환에 실패했습니다. 음성 대화는 계속할 수 있습니다.');return;}
 if(e.type==='response.created'){activeResponse=e.response.id;return;}
 if(e.type==='output_audio_buffer.started'){if(!userSpeaking){assistantSpeaking=true;if(audio)audio.volume=1;setState('speaking');}return;}
 if(['output_audio_buffer.stopped','output_audio_buffer.cleared'].includes(e.type)){assistantSpeaking=false;if(!userSpeaking&&ui.connected)setState('connected');return;}
 if(e.type==='response.output_audio_transcript.delta'||e.type==='response.audio_transcript.delta'){if(canceledResponses.has(e.response_id))return;const old=$('chat').querySelector(`[data-item="${CSS.escape(e.item_id)}"] span`)?.textContent||'';message('assistant',old+e.delta,e.item_id);return;}
 if(e.type==='response.output_audio_transcript.done'||e.type==='response.audio_transcript.done'){if(!canceledResponses.has(e.response_id))message('assistant',e.transcript,e.item_id);return;}
 if(e.type==='response.function_call_arguments.done'){
  if(toolCalls.has(e.call_id))return;toolCalls.add(e.call_id);let result={ok:false,message:'지원하지 않는 동작입니다.'};
  if(e.name==='perform_action'){
   if(userSpeaking||canceledResponses.has(e.response_id))result={ok:false,message:'사용자가 말씀 중이어서 이전 동작 요청을 취소했습니다.'};
   else try{const args=JSON.parse(e.arguments);const done=[];for(const a of(args.actions||[]).slice(0,5))if(action(a,args.duration,args.intensity,done.length>0))done.push(a);result={ok:done.length>0,actions:done,message:done.length?'동작을 실행했습니다.':'실행할 수 있는 동작이 없습니다.'};}catch{result={ok:false,message:'동작 인수가 올바르지 않습니다.'};}
  }
  send({type:'conversation.item.create',item:{type:'function_call_output',call_id:e.call_id,output:JSON.stringify(result)}});toolFollowup=true;return;
 }
 if(e.type==='response.done'){
  activeResponse=null;if(e.response?.status==='failed'){notice(e.response.status_details?.error?.message||'답변을 생성하지 못했습니다. API 사용 한도를 확인해 주세요.');if(!userSpeaking)setState('connected');}
  if(toolFollowup){toolFollowup=false;if(!userSpeaking&&e.response.status!=='cancelled')send({type:'response.create'});}return;
 }
}
function localCommand(text){const actions=[];if(/고개.*숙|인사해|인사 해|절해/.test(text))actions.push('bow');else if(/끄덕/.test(text))actions.push('nod');if(/왼쪽|왼편/.test(text)&&!/팔/.test(text))actions.push('look_left');if(/오른쪽|오른편/.test(text)&&!/팔/.test(text))actions.push('look_right');if(/두 팔|양팔|양 팔/.test(text))actions.push('raise_both_arms');else{if(/왼팔|왼 팔/.test(text))actions.push('raise_left_arm');if(/오른팔|오른 팔/.test(text))actions.push('raise_right_arm');}if(/흔들/.test(text))actions.push('wave');if(/웃|미소/.test(text))actions.push('smile');if(/놀라/.test(text))actions.push('surprised');if(/원래|바로 서|정면/.test(text))actions.push('neutral');return actions;}
$('textForm').onsubmit=e=>{e.preventDefault();const input=$('textInput'),text=input.value.trim();if(!text)return;input.value='';message('user',text);
 if(ui.connected){if(activeResponse){canceledResponses.add(activeResponse);send({type:'response.cancel'});}send({type:'output_audio_buffer.clear'});if(audio)audio.volume=0;send({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text}]}});send({type:'response.create'});setState('thinking');}
 else{const actions=localCommand(text);if(actions.length){for(const a of actions)action(a);message('system','동작을 미리 보기로 실행했습니다. AI와 대화하려면 API 키를 설정하고 대화를 시작해 주세요.');}else{notice('AI 대화는 API 키를 입력하고 마이크로 대화 시작을 눌러 주세요.');$('settings').showModal();}}};
$('settingsBtn').onclick=()=>$('settings').showModal();$('sensitivity').oninput=()=>$('sensitivityValue').textContent=$('sensitivity').value;
$('saveSettings').onclick=()=>{if(ui.connected||connecting){notice('설정을 바꾸려면 대화를 종료해 주세요.');$('settings').close();return;}if($('key').value.trim())apiKey=$('key').value.trim();modelName=$('model').value.trim()||'gpt-realtime';voice=$('voice').value;$('key').value='';$('key').placeholder=apiKey?'키가 메모리에 설정되어 있습니다':'sk-…';$('settings').close();notice(apiKey?'설정을 적용했습니다. 마이크로 대화 시작을 눌러 주세요.':'API 키를 입력해 주세요.');};
window.addEventListener('pagehide',()=>{stop();apiKey='';});
function animate(){requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.05),t=clock.elapsedTime,k=1-Math.exp(-dt*8);
 if(viewGoal){camera.position.lerp(viewGoal.p,k*.7);controls.target.lerp(viewGoal.t,k*.7);if(camera.position.distanceTo(viewGoal.p)<.001)viewGoal=null;}
 let volume=0,round=0;if(analyser&&streamData&&frequencyData&&assistantSpeaking&&!userSpeaking){analyser.getFloatTimeDomainData(streamData);volume=Math.sqrt(streamData.reduce((a,b)=>a+b*b,0)/streamData.length);analyser.getByteFrequencyData(frequencyData);let low=0,high=0;for(let i=2;i<9;i++)low+=frequencyData[i];for(let i=12;i<40;i++)high+=frequencyData[i];round=low/(low+high+1);}
 const target=Math.min(.65,Math.max(0,volume-.006)*7);smoothedMouth+=(target-smoothedMouth)*(1-Math.exp(-dt*22));roundMouth+=(round*target-roundMouth)*k;
 if(t>nextBlink){blinkStart=t;nextBlink=t+2.8+Math.random()*4.2;}const phase=(t-blinkStart)/.19;const blink=phase>=0&&phase<=1?Math.sin(phase*Math.PI):0;
 if(expressionUntil&&t>expressionUntil){expression='neutral';expressionUntil=0;}
 blend('jawOpen',Math.min(1,smoothedMouth+(expression==='surprised'?.35:0)));blend('mouthRound',roundMouth*.7);blend('blink',blink);blend('smile',expression==='smile'?.8:expression==='sad'?-.25:0);blend('browUp',expression==='surprised'?.8:expression==='sad'?.3:0);
 const hold=t<poseUntil?1:0;rot('head',pose.headX*hold+Math.sin(t*.9)*.013+(assistantSpeaking?Math.sin(t*3)*.018:0),pose.headY*hold+Math.sin(t*.42)*.018,Math.sin(t*.6)*.008,k);rot('spine',pose.spineX*hold,0,Math.sin(t*.7)*.003,k);
 rotArm('upperArm_L',pose.left*hold,k);rotArm('upperArm_R',pose.right*hold,k);rotArm('forearm_L',pose.leftElbow*hold,k);rotArm('forearm_R',(pose.rightElbow+(waving?Math.sin(t*7)*.2:0))*hold,k);
 document.querySelectorAll('#wave i').forEach((el,i)=>el.style.height=(4+(assistantSpeaking?volume*150*(.5+Math.sin(t*12+i)*.5):userSpeaking?6+Math.sin(t*8+i)*5:0))+'px');controls.update();renderer?.render(scene,camera);
}
animate();
