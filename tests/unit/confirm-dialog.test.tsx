import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui/dialog', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  const DialogStateContext = React.createContext(true);

  return {
    Dialog: ({
      open,
      children,
    }: {
      open: boolean;
      children: React.ReactNode;
    }) => (
      <DialogStateContext.Provider value={open}>
        {children}
      </DialogStateContext.Provider>
    ),
    DialogContent: ({ children }: { children: React.ReactNode }) => {
      const open = React.useContext(DialogStateContext);
      return (
        <div data-state={open ? 'open' : 'closed'}>
          {children}
        </div>
      );
    },
    DialogDescription: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
      <p {...props}>{children}</p>
    ),
    DialogTitle: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h2 {...props}>{children}</h2>
    ),
  };
});

import { ConfirmDialog } from '@/components/ui/confirm-dialog';

describe('ConfirmDialog', () => {
  it('keeps the last open copy while the dialog is closing', () => {
    const { rerender } = render(
      <ConfirmDialog
        open
        title="Confirm"
        message={'Delete "Important chat"?'}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('Delete "Important chat"?')).toBeInTheDocument();

    rerender(
      <ConfirmDialog
        open={false}
        title="Confirm"
        message={'Delete ""?'}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('Delete "Important chat"?')).toBeInTheDocument();
  });
});
