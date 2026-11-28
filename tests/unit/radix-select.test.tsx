import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Select, SelectItem } from '@/components/ui/select';

it('preserves empty values and disabled choices through Radix keyboard selection', async () => {
  const onChange = vi.fn();
  function Field() {
    const [value, setValue] = useState('');
    return <Select value={value} onValueChange={next => { onChange(next); setValue(next); }}>
      <SelectItem value="">Automatic</SelectItem>
      <SelectItem value="chosen">Chosen</SelectItem>
      <SelectItem value="disabled" disabled>Disabled</SelectItem>
    </Select>;
  }
  render(<Field />);
  const trigger = screen.getByRole('combobox');
  expect(trigger).toHaveValue('');
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const options = await screen.findAllByRole('option');
  expect(options[2]).toHaveAttribute('aria-disabled', 'true');
  fireEvent.keyDown(options[1], { key: 'Enter' });
  expect(onChange).toHaveBeenLastCalledWith('chosen');
  expect(trigger).toHaveValue('chosen');
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  fireEvent.keyDown((await screen.findAllByRole('option'))[0], { key: 'Enter' });
  expect(onChange).toHaveBeenLastCalledWith('');
  expect(trigger).toHaveValue('');
});
