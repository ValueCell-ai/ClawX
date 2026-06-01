import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
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

  it('keeps the active copy when cancel clears the owner state', () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      const [label, setLabel] = useState('Important chat');

      return (
        <ConfirmDialog
          open={open}
          title="Confirm"
          message={`Delete "${label}"?`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          variant="destructive"
          onConfirm={vi.fn()}
          onCancel={() => {
            setOpen(false);
            setLabel('');
          }}
        />
      );
    }

    render(<Harness />);

    fireEvent.click(screen.getByTestId('confirm-dialog-cancel-button'));

    expect(screen.getByText('Delete "Important chat"?')).toBeInTheDocument();
    expect(screen.queryByText('Delete ""?')).not.toBeInTheDocument();
  });

  it('keeps the active copy when confirm clears the owner state', () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      const [label, setLabel] = useState('Important chat');

      return (
        <ConfirmDialog
          open={open}
          title="Confirm"
          message={`Delete "${label}"?`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          variant="destructive"
          onConfirm={() => {
            setOpen(false);
            setLabel('');
          }}
          onCancel={vi.fn()}
        />
      );
    }

    render(<Harness />);

    fireEvent.click(screen.getByTestId('confirm-dialog-confirm-button'));

    expect(screen.getByText('Delete "Important chat"?')).toBeInTheDocument();
    expect(screen.queryByText('Delete ""?')).not.toBeInTheDocument();
  });
});
