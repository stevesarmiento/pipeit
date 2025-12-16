/**
 * Tests for parallel submission.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { submitParallel, submitToRpc, ParallelSubmitError } from '../parallel.js';

describe('submitParallel', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.stubGlobal('performance', {
      now: vi.fn(() => 1000),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  it('should throw error for empty endpoints', async () => {
    await expect(
      submitParallel({ endpoints: [], transaction: 'base64tx' })
    ).rejects.toThrow(ParallelSubmitError);
    await expect(
      submitParallel({ endpoints: [], transaction: 'base64tx' })
    ).rejects.toThrow('No endpoints provided');
  });

  it('should submit to single endpoint successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: 'signature123',
      }),
    });

    const result = await submitParallel({
      endpoints: ['https://rpc.example.com'],
      transaction: 'base64tx',
    });

    expect(result.signature).toBe('signature123');
    expect(result.endpoint).toBe('https://rpc.example.com');
  });

  it('should race multiple endpoints and return first success', async () => {
    // First endpoint is slow, second is fast
    mockFetch
      .mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return {
          ok: true,
          json: async () => ({
            jsonrpc: '2.0',
            id: 1,
            result: 'slow-signature',
          }),
        };
      })
      .mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: 'fast-signature',
        }),
      }));

    const result = await submitParallel({
      endpoints: ['https://slow.example.com', 'https://fast.example.com'],
      transaction: 'base64tx',
    });

    // Should return the fast one
    expect(result.signature).toBe('fast-signature');
    expect(result.endpoint).toBe('https://fast.example.com');
  });

  it('should throw ParallelSubmitError when all endpoints fail', async () => {
    // Mock all endpoints to fail immediately
    mockFetch.mockRejectedValue(new Error('Connection refused'));

    await expect(
      submitParallel({
        endpoints: ['https://rpc1.example.com', 'https://rpc2.example.com'],
        transaction: 'base64tx',
      })
    ).rejects.toThrow(ParallelSubmitError);
  }, 10000); // Increase timeout for this test

  it('should succeed if one endpoint fails but another succeeds', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Error',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: 'success-signature',
        }),
      });

    const result = await submitParallel({
      endpoints: ['https://failing.example.com', 'https://working.example.com'],
      transaction: 'base64tx',
    });

    expect(result.signature).toBe('success-signature');
  });

  it('should use skipPreflight option', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: 'signature123',
      }),
    });

    await submitParallel({
      endpoints: ['https://rpc.example.com'],
      transaction: 'base64tx',
      skipPreflight: false,
    });

    const fetchCall = mockFetch.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.params[1].skipPreflight).toBe(false);
  });

  it('should default skipPreflight to true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: 'signature123',
      }),
    });

    await submitParallel({
      endpoints: ['https://rpc.example.com'],
      transaction: 'base64tx',
    });

    const fetchCall = mockFetch.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.params[1].skipPreflight).toBe(true);
  });
});

describe('submitToRpc', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  it('should submit transaction and return signature', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: 'signature123',
      }),
    });

    const signature = await submitToRpc(
      'https://rpc.example.com',
      'base64tx'
    );

    expect(signature).toBe('signature123');
  });

  it('should throw on RPC error response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32000, message: 'Transaction simulation failed' },
      }),
    });

    await expect(
      submitToRpc('https://rpc.example.com', 'base64tx')
    ).rejects.toThrow('Transaction simulation failed');
  });

  it('should throw on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'Too Many Requests',
    });

    await expect(
      submitToRpc('https://rpc.example.com', 'base64tx')
    ).rejects.toThrow('429');
  });

  it('should include maxRetries when specified', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: 'signature123',
      }),
    });

    await submitToRpc('https://rpc.example.com', 'base64tx', { maxRetries: 5 });

    const fetchCall = mockFetch.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.params[1].maxRetries).toBe(5);
  });

  it('should include preflightCommitment when skipPreflight is false', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: 'signature123',
      }),
    });

    await submitToRpc('https://rpc.example.com', 'base64tx', {
      skipPreflight: false,
      preflightCommitment: 'finalized',
    });

    const fetchCall = mockFetch.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.params[1].preflightCommitment).toBe('finalized');
  });
});

describe('ParallelSubmitError', () => {
  it('should have correct name', () => {
    const error = new ParallelSubmitError('test error', []);
    expect(error.name).toBe('ParallelSubmitError');
  });

  it('should store endpoint errors', () => {
    const errors = [
      { endpoint: 'https://rpc1.example.com', error: new Error('Error 1') },
      { endpoint: 'https://rpc2.example.com', error: new Error('Error 2') },
    ];
    const error = new ParallelSubmitError('All endpoints failed', errors);

    expect(error.errors).toHaveLength(2);
    expect(error.errors[0].endpoint).toBe('https://rpc1.example.com');
    expect(error.errors[1].endpoint).toBe('https://rpc2.example.com');
  });
});




