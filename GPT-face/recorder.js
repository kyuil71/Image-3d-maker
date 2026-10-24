// Accumulate native-rate input, box-filter and resample continuously to 16 kHz.
class PCMRecorder extends AudioWorkletProcessor {
 constructor(){super();this.sum=0;this.count=0;this.phase=0;this.ratio=sampleRate/16000;this.chunk=new Float32Array(640);this.index=0;}
 process(inputs){const input=inputs[0]?.[0];if(input)for(const sample of input){this.sum+=sample;this.count++;this.phase++;if(this.phase>=this.ratio){this.chunk[this.index++]=this.sum/this.count;this.sum=0;this.count=0;this.phase-=this.ratio;if(this.index===640){this.port.postMessage(this.chunk.buffer,[this.chunk.buffer]);this.chunk=new Float32Array(640);this.index=0;}}}return true;}
}
registerProcessor('pcm-recorder',PCMRecorder);
