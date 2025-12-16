/**
 * Browser stub for @pipeit/fastlane.
 * 
 * This module provides empty exports for browser environments
 * where the native QUIC client cannot run.
 * 
 * In the browser, TPU submission routes through the /api/tpu endpoint
 * which uses the real native client on the server.
 */

// Stub TpuClient that throws helpful error if accidentally used in browser
export class TpuClient {
  constructor() {
    throw new Error(
      '@pipeit/fastlane cannot be used in the browser. ' +
      'TPU submission should route through the API endpoint. ' +
      'Configure tpu.apiRoute in your execution config.'
    );
  }
}

export default { TpuClient };

