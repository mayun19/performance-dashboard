import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Protected } from './Protected';

const useAuth = vi.fn();
vi.mock('../context/AuthContext', () => ({ useAuth: () => useAuth() }));

describe('Protected', () => {
  it('shows a loading state while authentication is being restored', () => {
    useAuth.mockReturnValue({ user: null, loading: true });
    render(<MemoryRouter><Protected><div>Private</div></Protected></MemoryRouter>);
    expect(screen.getByText('Memuat…')).toBeInTheDocument();
  });

  it('renders protected content for a permitted role', () => {
    useAuth.mockReturnValue({ user: { role: 'GM' }, loading: false });
    render(<MemoryRouter><Protected roles={['GM']}><div>Executive content</div></Protected></MemoryRouter>);
    expect(screen.getByText('Executive content')).toBeInTheDocument();
  });

  it('redirects a signed-out user to login', () => {
    useAuth.mockReturnValue({ user: null, loading: false });
    render(<MemoryRouter initialEntries={['/private']}><Protected><div>Private</div></Protected></MemoryRouter>);
    expect(screen.queryByText('Private')).not.toBeInTheDocument();
  });
});
