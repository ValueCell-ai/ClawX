import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FeedbackState } from '@/components/common/FeedbackState';

describe('FeedbackState', () => {
  it('renders loading state content', () => {
    render(<FeedbackState state="loading" title="Loading data" description="Please wait" />);

    expect(screen.getByText('Loading data')).toBeInTheDocument();
    expect(screen.getByText('Please wait')).toBeInTheDocument();
  });

  it('renders action for empty state', () => {
    render(
      <FeedbackState
        state="empty"
        title="Nothing here"
        action={<button type="button">Create one</button>}
      />,
    );

    expect(screen.getByRole('button', { name: 'Create one' })).toBeInTheDocument();
  });

  it('renders error state title', () => {
    render(<FeedbackState state="error" title="Request failed" />);

    expect(screen.getByText('Request failed')).toBeInTheDocument();
  });
});
