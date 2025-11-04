export interface PipelineExampleMeta {
  id: string;
  name: string;
  description: string;
  section: 'basics' | 'tokens' | 'nfts' | 'advanced';
}

export const pipelinesManifest: Array<PipelineExampleMeta> = [
  // Basics
  {
    id: 'simple-transfer',
    name: 'Simple Transfer',
    description: 'Single instruction, single transaction - baseline example',
    section: 'basics',
  },
  {
    id: 'batched-transfers',
    name: 'Batched Transfers',
    description: 'Multiple transfers batched into one atomic transaction',
    section: 'basics',
  },
  {
    id: 'mixed-pipeline',
    name: 'Mixed Pipeline',
    description: 'Instruction and transaction steps - shows when batching breaks',
    section: 'basics',
  },
];



