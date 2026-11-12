// Pactline AI layer: the only module the backend imports. See README.md for the interface.
import { hasKey, DEFAULT_MODEL, AiInputError } from './client.js';

export { draftContract, fallbackDraft } from './contract.js';
export { checkProof, fallbackCheck, scanInjection, shapeVerdict } from './proof.js';
export { explainEvent, explainTemplate } from './explain.js';
export { validateContract, toContract, CONTRACT_SCHEMA, VERDICT_SCHEMA } from './schema.js';
export { AiInputError };

export function aiStatus() {
  const live = hasKey();
  return { compiler: live ? 'claude' : 'fallback', judge: live ? 'claude-vision' : 'heuristic', model: live ? DEFAULT_MODEL : null };
}
