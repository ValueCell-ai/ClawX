import type { HostApiContract } from '@shared/host-api/contract';
import { runOpenClawDoctor, runOpenClawDoctorFix } from '../utils/openclaw-doctor';
import { isRecord } from './payload-utils';

type OpenClawDoctorPayload = {
  mode?: unknown;
};

export function createAppApi(): HostApiContract['app'] {
  return {
    openClawDoctor: async (payload) => {
      const body = isRecord(payload) ? payload as OpenClawDoctorPayload : {};
      return body.mode === 'fix' ? runOpenClawDoctorFix() : runOpenClawDoctor();
    },
  };
}
