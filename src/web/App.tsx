import { Home } from '@/web/routes/Home';
import { Login } from '@/web/routes/Login';
import { Welcome } from '@/web/routes/Welcome';
import { Route, Routes } from 'react-router';

/**
 * App router. Holds the `<Routes>` tree; the router provider and data/query
 * providers are mounted in `main.tsx`. New routes are added here.
 *
 * `/` is the public Welcome page; `/login` is the magic-link sign-in; `/app` is
 * the authed home a successful login redirects to.
 */
export function App() {
	return (
		<Routes>
			<Route path="/" element={<Welcome />} />
			<Route path="/app" element={<Home />} />
			<Route path="/login" element={<Login />} />
		</Routes>
	);
}
