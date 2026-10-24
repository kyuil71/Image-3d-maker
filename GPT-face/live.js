// Gemini Live wire protocol; API key stays in this tab's memory.
export const DEFAULT_MODEL='gemini-3.8-live';
export function pcmBase64(samples){const bytes=new Uint8Array(samples.length*2),v=new DataView(bytes.buffer);for(let i=0;i<samples.length;i++)v.setInt16(i*2,Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),true);let s='';for(let i=0;i<bytes.length;i++)s+=String.fromCharCode(bytes[i]);return btoa(s);}
export function makeSetup(model,voice,actions){return {setup:{model:'models/'+model.replace(/^models\//,''),generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:voice}}}},systemInstruction:{parts:[{text:`당신은 3D 캐릭터 Tasha입니다. 한국어 존댓말로 간결하고 자연스럽게 대화하세요. 사용자가 끼어들면 이전 답을 멈추고 새 발언을 끝까지 듣고 답하세요. 사용자의 카메라는 사용하지 않습니다. 최신 정보, 날씨, 뉴스, 가격 또는 검색 요청에는 google_search를 사용하고 확인하지 않은 정보를 검색했다고 말하지 마세요. 검색할 때는 확인 중이라고 짧게 말하고 URL을 읽지 마세요. 신체 동작과 표정 요청에는 반드시 perform_action을 호출하고 성공 결과를 확인한 뒤 실행했다고 말하세요. 요가는 직접 제작한 참고 애니메이션이며 전문 지도나 Mixamo 원본 동작이라고 말하지 마세요. 왼쪽과 오른쪽은 캐릭터 기준입니다. duration은 자세가 완성된 뒤 유지할 초입니다. 반대쪽 요청에는 switch_side를 사용하세요. 중단은 stop, 다시 서기는 neutral입니다. 동작 중 끼어들어도 자세를 자동 해제하지 마세요. 지원하지 않는 동작은 실행했다고 말하지 마세요.`}]},inputAudioTranscription:{},outputAudioTranscription:{},realtimeInputConfig:{automaticActivityDetection:{disabled:true},activityHandling:'START_OF_ACTIVITY_INTERRUPTS',turnCoverage:'TURN_INCLUDES_ONLY_ACTIVITY'},contextWindowCompression:{slidingWindow:{}},sessionResumption:{},tools:[{googleSearch:{}},{functionDeclarations:[{name:'perform_action',description:'캐릭터의 동작 또는 표정 실행. 동작 실행 여부는 반환 결과를 따르세요.',parameters:{type:'OBJECT',properties:{actions:{type:'ARRAY',items:{type:'STRING',enum:actions}},duration:{type:'NUMBER',description:'유지 시간 1~120초'},intensity:{type:'NUMBER',description:'표정 강도 0.1~1'},side:{type:'STRING',enum:['left','right']}},required:['actions']}}]}]}};}
export class LiveVoice {
 constructor(hooks={}){this.h=hooks;this.nodes=new Set();this.calls=new Set();this.canceled=new Set();this.epoch=0;this.state='closed';this.muted=false;this.speaking=false;this.turn=0;this.messageChain=Promise.resolve();}
 emit(state){this.state=state;this.h.state?.(state);}
 send(value){if(this.ws?.readyState===1){this.ws.send(JSON.stringify(value));return true;}return false;}
 async connect({key,model=DEFAULT_MODEL,voice='Kore',actions,threshold=.025}){
  this.close();const epoch=++this.epoch;this.threshold=threshold;this.emit('connecting');this.closed=false;this.calls.clear();this.canceled.clear();this.inputText='';this.outputText='';this.blockOutput=false;this.userActive=false;this.pre=[];this.resumeHandle=null;
  this.timeout=setTimeout(()=>this.fail('연결 시간 초과: API 키, 모델 접근 권한과 네트워크를 확인해 주세요.'),30000);
  try{
   this.ctx=new AudioContext();await this.ctx.resume();const context=this.ctx;
   const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
   if(epoch!==this.epoch){stream.getTracks().forEach(t=>t.stop());return;}this.stream=stream;
   await context.audioWorklet.addModule(new URL('./recorder.js',import.meta.url));if(epoch!==this.epoch)return;
   this.analyser=context.createAnalyser();this.analyser.fftSize=1024;this.analyser.smoothingTimeConstant=.3;this.analyser.connect(context.destination);
   this.mic=context.createMediaStreamSource(stream);this.recorder=new AudioWorkletNode(context,'pcm-recorder');this.silence=context.createGain();this.silence.gain.value=0;this.mic.connect(this.recorder);this.recorder.connect(this.silence).connect(context.destination);this.recorder.port.onmessage=e=>{if(epoch===this.epoch)this.capture(new Float32Array(e.data));};
   const ws=new WebSocket('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key='+encodeURIComponent(key));this.ws=ws;
   ws.onopen=()=>{if(epoch===this.epoch)this.send(makeSetup(model,voice,actions));};
   ws.onmessage=e=>{this.messageChain=this.messageChain.then(async()=>{if(epoch!==this.epoch)return;const raw=typeof e.data==='string'?e.data:await e.data.text();if(epoch===this.epoch)await this.handle(JSON.parse(raw));}).catch(()=>{if(epoch===this.epoch)this.fail('음성 이벤트를 처리하지 못했습니다. 다시 연결해 주세요.');});};
   ws.onerror=()=>{if(epoch===this.epoch)this.fail('Gemini에 연결하지 못했습니다. API 키와 네트워크를 확인해 주세요.');};
   ws.onclose=e=>{if(epoch===this.epoch&&!this.closed)this.fail('Gemini 연결 종료'+(e.code?' ('+e.code+')':'')+'. API 키·모델 접근 권한·사용 한도를 확인해 주세요.');};
  }catch(e){if(epoch===this.epoch)this.fail(e.name==='NotAllowedError'?'마이크 권한을 허용해 주세요.':e.message);}
 }
 capture(samples){
  if(!this.ready||this.muted)return;
  let power=0;for(const v of samples)power+=v*v;const rms=Math.sqrt(power/samples.length),now=performance.now();
  const packet={audio:{data:pcmBase64(samples),mimeType:'audio/pcm;rate=16000'}};
  this.pre.push(packet);if(this.pre.length>8)this.pre.shift();
  if(rms>this.threshold){this.above=(this.above||0)+samples.length/16000;this.lastVoice=now;}else this.above=0;
  if(!this.userActive&&this.above>=.08){this.userActive=true;this.blockOutput=true;this.inputText='';this.turn++;this.clearAudio();this.h.interrupt?.();this.emit('listening');this.send({realtimeInput:{activityStart:{}}});for(const p of this.pre)this.send({realtimeInput:p});this.pre=[];return;}
  if(this.userActive){this.send({realtimeInput:packet});if(now-this.lastVoice>850){this.userActive=false;this.send({realtimeInput:{activityEnd:{}}});this.blockOutput=false;this.outputText='';this.emit('thinking');}}
 }
 async handle(e){
  if(e.error){this.fail(e.error.message||'Gemini API 오류');return;}
  if(e.setupComplete){clearTimeout(this.timeout);this.ready=true;this.emit('connected');return;}
  if(e.sessionResumptionUpdate?.resumable)this.resumeHandle=e.sessionResumptionUpdate.newHandle;
  if(e.goAway){this.h.notice?.('음성 세션이 곧 종료됩니다. 종료 후 다시 연결해 주세요.');}
  for(const id of e.toolCallCancellation?.ids||[])this.canceled.add(id);
  const s=e.serverContent;
  if(s){
   if(s.interrupted){this.clearAudio();this.h.interrupt?.();this.outputText='';if(this.userActive)this.emit('listening');}
   if(s.inputTranscription?.text){this.inputText+=s.inputTranscription.text;if(!this.userActive&&/검색|날씨|최신|뉴스|시세/.test(this.inputText))this.emit('searching');this.h.transcript?.('user',this.inputText,'u'+this.turn);}
   if(!this.userActive&&!this.blockOutput&&!s.interrupted){
    if(s.outputTranscription?.text){this.outputText+=s.outputTranscription.text;this.h.transcript?.('assistant',this.outputText,'a'+this.turn);}
    for(const p of s.modelTurn?.parts||[]){if(p.inlineData?.mimeType?.startsWith('audio/pcm'))this.enqueue(p.inlineData);if(p.executableCode)this.emit('searching');}
    if(s.groundingMetadata)this.h.sources?.(s.groundingMetadata,'a'+this.turn);
   }
   if(s.turnComplete){this.serverDone=true;if(!this.nodes.size&&!this.userActive)this.emit('connected');}
  }
  if(e.toolCall){const responses=[];for(const c of e.toolCall.functionCalls||[]){if(this.calls.has(c.id))continue;this.calls.add(c.id);let response={ok:false,message:'취소되었거나 지원하지 않는 요청입니다.'};if(!this.userActive&&!this.canceled.has(c.id)&&c.name==='perform_action'){try{response=this.h.action?.(c.args||{})||response;}catch{response={ok:false,message:'동작을 실행하지 못했습니다.'};}}responses.push({id:c.id,name:c.name,response});}if(responses.length)this.send({toolResponse:{functionResponses:responses}});}
 }
 enqueue(data){if(!this.ctx||this.userActive||this.blockOutput)return;const raw=atob(data.data),view=new DataView(new ArrayBuffer(raw.length));for(let i=0;i<raw.length;i++)view.setUint8(i,raw.charCodeAt(i));const rate=Number(/rate=(\d+)/.exec(data.mimeType)?.[1]||24000),buffer=this.ctx.createBuffer(1,Math.floor(raw.length/2),rate),out=buffer.getChannelData(0);for(let i=0;i<out.length;i++)out[i]=view.getInt16(i*2,true)/32768;
  const node=this.ctx.createBufferSource();node.buffer=buffer;node.connect(this.analyser);this.nextTime=Math.max(this.nextTime||0,this.ctx.currentTime+.025);node.start(this.nextTime);this.nextTime+=buffer.duration;this.nodes.add(node);this.speaking=true;this.serverDone=false;this.emit('speaking');node.onended=()=>{this.nodes.delete(node);node.disconnect();if(!this.nodes.size){this.speaking=false;if(this.ready&&!this.userActive)this.emit(this.serverDone?'connected':'thinking');}};
 }
 clearAudio(){for(const n of this.nodes){n.onended=null;try{n.stop();n.disconnect();}catch{}}this.nodes.clear();this.nextTime=0;this.speaking=false;}
 text(text){if(!this.ready)return false;this.clearAudio();this.userActive=false;this.blockOutput=false;this.turn++;this.outputText='';this.send({realtimeInput:{activityStart:{}}});this.send({realtimeInput:{text}});this.send({realtimeInput:{activityEnd:{}}});this.emit('thinking');return true;}
 mute(value){this.muted=value;this.stream?.getAudioTracks().forEach(t=>t.enabled=!value);if(value&&this.userActive){this.send({realtimeInput:{activityEnd:{}}});this.userActive=false;this.blockOutput=false;this.emit('thinking');}this.pre=[];this.above=0;}
 fail(message){this.close();this.emit('error');this.h.notice?.(String(message).replace(/AIza[\w-]+/g,'[키 숨김]'));}
 close(){this.closed=true;this.ready=false;this.epoch++;clearTimeout(this.timeout);if(this.ws){this.ws.onclose=null;this.ws.onerror=null;this.ws.close();this.ws=null;}this.clearAudio();if(this.recorder){this.recorder.port.onmessage=null;this.recorder.disconnect();this.recorder=null;}this.mic?.disconnect();this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.ctx?.close().catch(()=>{});this.ctx=null;this.analyser=null;this.muted=false;this.userActive=false;this.pre=[];this.emit('closed');}
}
