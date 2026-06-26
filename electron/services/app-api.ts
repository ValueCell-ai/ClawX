import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { RuntimeManager } from '../runtime/manager';
import { runOpenClawDoctor, runOpenClawDoctorFix } from '../utils/openclaw-doctor';
import { isRecord } from './payload-utils';

type OpenClawDoctorPayload = {
  mode?: unknown;
};

export function createAppApi(runtimeManager?: RuntimeManager): CompleteHostServiceRegistry['app'] {
  return {
    openClawDoctor: async (payload) => {
      const body = isRecord(payload) ? payload as OpenClawDoctorPayload : {};
      const mode = body.mode === 'fix' ? 'fix' : 'diagnose';
      if (runtimeManager) {
        return runtimeManager.getActiveProvider().runDoctor(mode);
      }
      return mode === 'fix' ? runOpenClawDoctorFix() : runOpenClawDoctor();
    },
  };
}
