/**
 * Tests for Jito client.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { address } from '@solana/addresses';
import {
  JITO_BLOCK_ENGINES,
  JITO_TIP_ACCOUNTS,
  JITO_MIN_TIP_LAMPORTS,
  JITO_DEFAULT_TIP_LAMPORTS,
  getRandomTipAccount,
  resolveBlockEngineUrl,
  createTipInstruction,
  sendBundle,
  getBundleStatuses,
  JitoBundleError,
} from '../jito.js';

describe('Jito constants', () => {
  it('should have all expected block engine regions', () => {
    expect(JITO_BLOCK_ENGINES.mainnet).toBeDefined();
    expect(JITO_BLOCK_ENGINES.ny).toBeDefined();
    expect(JITO_BLOCK_ENGINES.amsterdam).toBeDefined();
    expect(JITO_BLOCK_ENGINES.frankfurt).toBeDefined();
    expect(JITO_BLOCK_ENGINES.tokyo).toBeDefined();
    expect(JITO_BLOCK_ENGINES.singapore).toBeDefined();
    expect(JITO_BLOCK_ENGINES.slc).toBeDefined();
  });

  it('should have 8 tip accounts', () => {
    expect(JITO_TIP_ACCOUNTS).toHaveLength(8);
  });

  it('should have valid tip account addresses', () => {
    for (const account of JITO_TIP_ACCOUNTS) {
      expect(typeof account).toBe('string');
      expect(account).toHaveLength(44); // Base58 Solana address length
    }
  });

  it('should have correct min tip amount', () => {
    expect(JITO_MIN_TIP_LAMPORTS).toBe(1_000n);
  });

  it('should have correct default tip amount', () => {
    expect(JITO_DEFAULT_TIP_LAMPORTS).toBe(10_000n);
  });
});

describe('getRandomTipAccount', () => {
  it('should return a valid tip account', () => {
    const account = getRandomTipAccount();
    expect(JITO_TIP_ACCOUNTS).toContain(account);
  });

  it('should return different accounts over multiple calls (probabilistically)', () => {
    const accounts = new Set<string>();
    for (let i = 0; i < 100; i++) {
      accounts.add(getRandomTipAccount());
    }
    // With 100 random selections from 8 accounts, we should see multiple unique values
    expect(accounts.size).toBeGreaterThan(1);
  });
});

describe('resolveBlockEngineUrl', () => {
  it('should return mainnet URL for undefined', () => {
    expect(resolveBlockEngineUrl()).toBe(JITO_BLOCK_ENGINES.mainnet);
  });

  it('should return mainnet URL for "mainnet"', () => {
    expect(resolveBlockEngineUrl('mainnet')).toBe(JITO_BLOCK_ENGINES.mainnet);
  });

  it('should resolve region keys to URLs', () => {
    expect(resolveBlockEngineUrl('ny')).toBe(JITO_BLOCK_ENGINES.ny);
    expect(resolveBlockEngineUrl('amsterdam')).toBe(JITO_BLOCK_ENGINES.amsterdam);
    expect(resolveBlockEngineUrl('tokyo')).toBe(JITO_BLOCK_ENGINES.tokyo);
  });

  it('should return custom URL as-is', () => {
    const customUrl = 'https://custom.block-engine.example.com';
    expect(resolveBlockEngineUrl(customUrl)).toBe(customUrl);
  });
});

describe('createTipInstruction', () => {
  const testSource = address('11111111111111111111111111111111');
  const testTipAccount = JITO_TIP_ACCOUNTS[0];

  it('should create a valid instruction', () => {
    const ix = createTipInstruction(testSource, 10_000n);

    expect(ix.programAddress).toBe('11111111111111111111111111111111');
    expect(ix.accounts).toHaveLength(2);
    expect(ix.data).toBeInstanceOf(Uint8Array);
  });

  it('should set source as first account with writable signer role', () => {
    const ix = createTipInstruction(testSource, 10_000n);

    expect(ix.accounts[0].address).toBe(testSource);
    expect(ix.accounts[0].role).toBe(3); // WRITABLE_SIGNER
  });

  it('should set tip account as second account with writable role', () => {
    const ix = createTipInstruction(testSource, 10_000n, testTipAccount);

    expect(ix.accounts[1].address).toBe(testTipAccount);
    expect(ix.accounts[1].role).toBe(1); // WRITABLE
  });

  it('should use random tip account when not specified', () => {
    const ix = createTipInstruction(testSource, 10_000n);
    expect(JITO_TIP_ACCOUNTS).toContain(ix.accounts[1].address);
  });

  it('should encode lamports correctly in instruction data', () => {
    const ix = createTipInstruction(testSource, 10_000n);

    // Data layout: [0-3] discriminator (2), [4-11] lamports as u64 LE
    const view = new DataView(ix.data.buffer);
    expect(view.getUint32(0, true)).toBe(2); // Transfer discriminator
    expect(view.getBigUint64(4, true)).toBe(10_000n);
  });

  it('should encode large lamport amounts correctly', () => {
    const largeTip = 1_000_000_000n; // 1 SOL
    const ix = createTipInstruction(testSource, largeTip);

    const view = new DataView(ix.data.buffer);
    expect(view.getBigUint64(4, true)).toBe(largeTip);
  });
});

describe('sendBundle', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  it('should throw error for empty bundle', async () => {
    await expect(sendBundle([])).rejects.toThrow(JitoBundleError);
    await expect(sendBundle([])).rejects.toThrow('at least one transaction');
  });

  it('should throw error for bundle with more than 5 transactions', async () => {
    const transactions = Array(6).fill('base64tx');
    await expect(sendBundle(transactions)).rejects.toThrow(JitoBundleError);
    await expect(sendBundle(transactions)).rejects.toThrow('more than 5 transactions');
  });

  it('should send bundle to correct endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: 'bundle-id-123' }),
    });

    await sendBundle(['tx1', 'tx2'], { blockEngineUrl: 'ny' });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('ny.mainnet.block-engine.jito.wtf'),
      expect.any(Object)
    );
  });

  it('should return bundle ID on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: 'bundle-id-123' }),
    });

    const bundleId = await sendBundle(['tx1']);
    expect(bundleId).toBe('bundle-id-123');
  });

  it('should throw JitoBundleError on API error', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32000, message: 'Bundle simulation failed' },
      }),
    });

    const error = await sendBundle(['tx1']).catch((e) => e);
    expect(error).toBeInstanceOf(JitoBundleError);
    expect(error.message).toContain('Bundle simulation failed');
  });

  it('should throw on HTTP error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const error = await sendBundle(['tx1']).catch((e) => e);
    expect(error).toBeInstanceOf(JitoBundleError);
    expect(error.message).toContain('500');
  });
});

describe('getBundleStatuses', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  it('should return empty array for empty input', async () => {
    const result = await getBundleStatuses([]);
    expect(result).toEqual([]);
  });

  it('should throw for more than 5 bundle IDs', async () => {
    const bundleIds = Array(6).fill('bundle-id');
    await expect(getBundleStatuses(bundleIds)).rejects.toThrow(JitoBundleError);
  });

  it('should return bundle status on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: {
          context: { slot: 12345 },
          value: [
            {
              bundle_id: 'bundle-123',
              transactions: ['sig1', 'sig2'],
              slot: 12340,
              confirmation_status: 'confirmed',
              err: { Ok: null },
            },
          ],
        },
      }),
    });

    const [status] = await getBundleStatuses(['bundle-123']);

    expect(status).not.toBeNull();
    expect(status?.bundleId).toBe('bundle-123');
    expect(status?.transactions).toEqual(['sig1', 'sig2']);
    expect(status?.confirmationStatus).toBe('confirmed');
  });

  it('should return null for not found bundle', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: {
          context: { slot: 12345 },
          value: [null],
        },
      }),
    });

    const [status] = await getBundleStatuses(['bundle-not-found']);
    expect(status).toBeNull();
  });
});

describe('JitoBundleError', () => {
  it('should have correct name', () => {
    const error = new JitoBundleError('test error');
    expect(error.name).toBe('JitoBundleError');
  });

  it('should store error code', () => {
    const error = new JitoBundleError('test error', { code: -32000 });
    expect(error.code).toBe(-32000);
  });

  it('should store bundle ID', () => {
    const error = new JitoBundleError('test error', { bundleId: 'bundle-123' });
    expect(error.bundleId).toBe('bundle-123');
  });
});




