import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelDefaultSummary } from '@/components/settings/ModelDefaultSummary';

const listMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/host-api', () => ({ hostApi: { agents: { list: listMock } } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/providers', () => ({ useProviderStore: (selector: (state: unknown) => unknown) => selector({ setDefaultModel: vi.fn() }) }));

describe('actual runtime default model summary', () => {
  beforeEach(() => listMock.mockReset());
  it('keeps an unset runtime default explicit instead of selecting an account default', async () => {
    listMock.mockResolvedValue({ success: true, defaultModelRef: null });
    const loaded = vi.fn();
    render(<ModelDefaultSummary accounts={[]} statuses={[]} vendors={[]} defaultAccountId="saved-credential-account" onModelLoaded={loaded} />);
    await waitFor(() => expect(screen.getByTestId('models-default-value')).toHaveTextContent('modelManagement.defaultUnset'));
    expect(screen.getByTestId('global-model-picker-button')).toBeDisabled();
    expect(loaded).toHaveBeenCalledWith(null);
  });
  it('distinguishes an unavailable default from an unset one and retains unknown model refs', async () => {
    listMock.mockRejectedValueOnce(new Error('Unavailable'));
    const loaded = vi.fn();
    const first = render(<ModelDefaultSummary accounts={[]} statuses={[]} vendors={[]} defaultAccountId={null} onModelLoaded={loaded} />);
    await waitFor(() => expect(screen.getByTestId('models-default-value')).toHaveTextContent('modelManagement.defaultUnavailable'));
    expect(loaded).not.toHaveBeenCalled();
    first.unmount();
    listMock.mockResolvedValueOnce({ success: true, defaultModelRef: 'unknown-service/model-exact' });
    render(<ModelDefaultSummary accounts={[]} statuses={[]} vendors={[]} defaultAccountId={null} onModelLoaded={loaded} />);
    await waitFor(() => expect(screen.getByTestId('models-default-value')).toHaveTextContent('unknown-service/model-exact'));
    expect(screen.getByTestId('global-model-picker-button')).toBeDisabled();
    expect(loaded).toHaveBeenCalledWith('unknown-service/model-exact');
  });
});
