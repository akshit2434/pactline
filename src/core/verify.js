import { normalizeContract, staticVerify } from './contract.js';
import { modelCheck } from './modelcheck.js';

/** Full verification: static checks, then (only if they pass) model checking of every execution path. */
export function verifyContract(raw) {
  const contract = normalizeContract(raw);
  const { errors, warnings } = staticVerify(contract);
  if (errors.length) return { ok: false, paths: 0, states: 0, invariants: [], errors, warnings };
  const mc = modelCheck(contract);
  const mcErrors = mc.problems.map((p) => ({ code: p.code, message: p.message, path: 'machine' }));
  return { ok: mcErrors.length === 0, paths: mc.paths, states: mc.states, invariants: mc.invariants, errors: mcErrors, warnings };
}
