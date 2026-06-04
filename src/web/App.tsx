import { Welcome } from '@/web/routes/Welcome';
import { Route, Routes } from 'react-router';

/**
 * App router. Holds the `<Routes>` tree; the router provider and data/query
 * providers are mounted in `main.tsx`. New routes are added here.
 */
export function App() {
	return (
		<Routes>
			<Route path="/" element={<Welcome />} />
		</Routes>
	);
}
