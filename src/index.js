/**
 * willow-inference-server (wis) drop in replacement using Cloudflare Worker AI
 *
 * This worker accepts the PCM audio stream from a willow device, builds the WAV header,
 * and sends it through to OpenAI Whisper.
 * 
 * The response is then formatted and returned to the device.
 */

import { AutoRouter } from 'itty-router'

class CustomError extends Error {
 constructor(message, statusCode) {
  super(message)
  this.statusCode = statusCode
 }
}

const router = AutoRouter()

router.post('/api/willow', async (request, env) => {
	try{

		// Check for Willow user-agent amd required x-audio headers
		if (!request.headers.get('user-agent').includes('Willow')) {

			throw new CustomError("Bad user-agent received (not Willow).", '400');

		} else if (
					!request.headers.has('x-audio-channel') || 
					!request.headers.has('x-audio-sample-rate') ||
					!request.headers.has('x-audio-bits') ||
					!request.headers.has('x-audio-codec')
				) {

			throw new CustomError("Bad header data received.", '400');

		} else if (!request.headers.get('x-audio-codec').includes('pcm')) {

			throw new CustomError("Only PCM codec accepted.", '400');

		} else {

			function createWavHeader(numChannels, sampleRate, bitsPerSample, dataSize) {
				// RIFF Header
				const riff = 'RIFF';
				const wave = 'WAVE';
				
				// Format Chunk
				const fmt = 'fmt ';
				const fmtChunkSize = 16; // For PCM
				const audioFormat = 1; // PCM
				const byteRate = sampleRate * numChannels * bitsPerSample / 8; // Byte rate
				const blockAlign = numChannels * bitsPerSample / 8; // Block align
				
				// Data Chunk
				const data = 'data';
				
				// Create an ArrayBuffer to hold the WAV header
				const buffer = new ArrayBuffer(44); // Standard WAV header size
				const view = new DataView(buffer);
			
				// RIFF header
				writeString(view, 0, riff); // "RIFF"
				view.setUint32(4, 36 + dataSize, true); // File size minus 8
				writeString(view, 8, wave); // "WAVE"
			
				// Format chunk
				writeString(view, 12, fmt); // "fmt "
				view.setUint32(16, fmtChunkSize, true); // Chunk size
				view.setUint16(20, audioFormat, true); // Audio format
				view.setUint16(22, numChannels, true); // Number of channels
				view.setUint32(24, sampleRate, true); // Sample rate
				view.setUint32(28, byteRate, true); // Byte rate
				view.setUint16(32, blockAlign, true); // Block align
				view.setUint16(34, bitsPerSample, true); // Bits per sample
			
				// Data chunk
				writeString(view, 36, data); // "data"
				view.setUint32(40, dataSize, true); // Data size
			
				return buffer;
			}
			
			function writeString(view, offset, string) {
			for (let i = 0; i < string.length; i++) {
				view.setUint8(offset + i, string.charCodeAt(i));
			}
			}
			
			const numChannels = request.headers.get('x-audio-channel')
			const sampleRate = request.headers.get('x-audio-sample-rate')
			const bitsPerSample = request.headers.get('x-audio-bits')
			const dataSize = request.headers.get('content-length')
			
			// Create wav header from request headers
			const wavHeader = createWavHeader(numChannels, sampleRate, bitsPerSample, dataSize);
			
			// PCM data received
			const audioData = await request.arrayBuffer();
			
			// Create complete WAV PCM buffer
			const combinedBuffer = Buffer.concat([Buffer.from(wavHeader), Buffer.from(audioData)]);

			// Prepare the input for Whisper API
			const audioBytes = new Uint8Array(combinedBuffer);

			const input = {
				audio: [...audioBytes],  // The Whisper API expects an array of bytes
			};

			// Call the Whisper API using the Cloudflare Worker AI
			const response = await env.AI.run("@cf/openai/whisper", input);

			// Reference for response found at: willow-inference-server/main.py line:1403
			// Based on that code, the minimum response appears to be language and results
			const language = 'en';
			const final_response = {language: language, text: response.text};

			// Return the transcription response
			return new Response(JSON.stringify(final_response), { 
				headers: { 'Content-Type': 'application/json' },
				status: 200
			});

		}
	  } catch (error) {
		// Handle any errors during processing
		return new Response('Error processing the file. - ' + error.message, { status: error.statusCode });
	  }
});

export default router;